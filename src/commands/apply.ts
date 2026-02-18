import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import chalk from "chalk";
import ora from "ora";
import { loadConfig } from "../utils/config.js";
import { SessionError, AdapterError as AdapterErr } from "../utils/errors.js";
import { initializeAdapters } from "../utils/adapters.js";
import { findLatestSession, updateStatus } from "../utils/session.js";
import { selectLeadKnight } from "../orchestrator.js";
import {
  filterByScope,
  normalizeScopePath,
  writeStagedFiles,
  writeStagedFilesWithConfirmation,
} from "../utils/file-writer.js";
import { scanBlocks, generateBlockMap } from "../utils/block-scanner.js";
import { parseRtdiff, applyBlockOperations, isRtdiffResponse, isLegacyEditResponse } from "../utils/diff-parser.js";
import { parseKnightOutput } from "../utils/edit-parser.js";
import { applyEdits } from "../utils/edit-parser.js";
import { validateAll, formatValidationReport } from "../utils/validation.js";
import { askParleyMode } from "../utils/decree.js";
import { addManifestEntry, topicToFeatureId, getFeatureSummary } from "../utils/manifest.js";
import { addDecreeEntry } from "../utils/decree-log.js";
import { hashContent } from "../utils/hash.js";
import type { ConsensusBlock, ManifestFeatureStatus, SegmentInfo } from "../types.js";
import { createInterface } from "node:readline/promises";

/**
 * Maximum total characters of source context to inject.
 */
const MAX_SOURCE_CONTEXT_CHARS = 500_000;

/**
 * Maximum characters per single source file before truncation.
 */
const MAX_SINGLE_FILE_CHARS = 80_000;

/**
 * Read all existing allowed_files, build source context, and scan for blocks.
 * Returns source context string + per-file block maps.
 */
async function buildSourceContextWithBlockMaps(
  allowedFiles: string[],
  projectRoot: string
): Promise<{
  context: string;
  blockMaps: string;
  totalChars: number;
  fileCount: number;
  fileSegments: Map<string, SegmentInfo[]>;
}> {
  const blocks: string[] = [];
  const mapBlocks: string[] = [];
  const fileSegments = new Map<string, SegmentInfo[]>();
  let totalChars = 0;
  let fileCount = 0;

  for (const entry of allowedFiles) {
    // NEW: files don't exist yet — skip
    if (entry.toUpperCase().startsWith("NEW:")) continue;

    const normalized = normalizeScopePath(entry);
    const fullPath = resolve(projectRoot, normalized);

    if (!existsSync(fullPath)) {
      blocks.push(
        `=== SOURCE: ${normalized} (NOT FOUND — file does not exist yet) ===\n=== END SOURCE ===`
      );
      continue;
    }

    try {
      let content = await readFile(fullPath, "utf-8");
      const hash = hashContent(content);
      let truncNote = "";

      if (content.length > MAX_SINGLE_FILE_CHARS) {
        const originalKB = Math.round(content.length / 1024);
        const limitKB = Math.round(MAX_SINGLE_FILE_CHARS / 1024);
        content = content.slice(0, MAX_SINGLE_FILE_CHARS);
        truncNote = ` (TRUNCATED: ${originalKB}KB -> ${limitKB}KB)`;
      }

      // Scan for blocks
      const scanResult = scanBlocks(content);
      fileSegments.set(normalized, scanResult.segments);

      // Generate block map
      const blockMap = generateBlockMap(normalized, scanResult.segments);
      mapBlocks.push(blockMap);

      const block = [
        `=== SOURCE: ${normalized} (hash: ${hash})${truncNote} ===`,
        content,
        truncNote ? `... (rest truncated) ...` : "",
        `=== END SOURCE ===`,
      ].filter(Boolean).join("\n");

      blocks.push(block);
      totalChars += content.length;
      fileCount++;
    } catch {
      blocks.push(
        `=== SOURCE: ${normalized} (READ ERROR — could not read file) ===\n=== END SOURCE ===`
      );
    }
  }

  return {
    context: blocks.join("\n\n"),
    blockMaps: mapBlocks.join("\n\n"),
    totalChars,
    fileCount,
    fileSegments,
  };
}

/**
 * The `roundtable apply` command.
 * Reads the latest session's decision and executes it via the Lead Knight.
 *
 * Pipeline (v1.1 — block-level operations):
 *   1. Scan source files → segment map
 *   2. Build BLOCK_MAP + source context for knight prompt
 *   3. Knight produces RTDIFF/1 BLOCK_* operations
 *   4. Parse → resolve segment keys → patch atomically
 *   5. Validate (bracket balance, artifacts, duplicate imports)
 *   6. Backup → write (all-or-nothing)
 *
 * No retry loop — if the knight fails, it fails. Hard fail > infinite retry.
 *
 * Modes:
 *   --parley (default) — shows each file, asks for confirmation
 *   --noparley — writes everything directly ("dangerous mode")
 *   --dry-run — runs entire pipeline (including knight execution, parse,
 *               stage, validate) but writes NOTHING to disk. Shows what
 *               WOULD be written. Non-zero exit on validation/scope failures.
 */
export async function applyCommand(initialNoparley = false, overrideScope = false, dryRun = false, skipParleyPrompt = false): Promise<number> {
  let noparley = initialNoparley;
  const projectRoot = process.cwd();

  // Load config — ConfigError propagates to index.ts
  const config = await loadConfig(projectRoot);

  // Find latest session
  const session = await findLatestSession(projectRoot);
  if (!session) {
    throw new SessionError("No sessions found. The knights have nothing to execute.", {
      hint: 'Run `roundtable discuss "topic"` first.',
    });
  }

  // Check status
  const status = session.status;
  if (!status?.consensus_reached) {
    console.log(chalk.yellow("\n  No consensus in the latest session. The knights can't agree — what else is new."));
    console.log(chalk.dim(`  Session: ${session.name}`));
    console.log(chalk.dim(`  Phase: ${status?.phase || "unknown"}\n`));
    return 0;
  }

  if (status.phase === "completed" && !dryRun) {
    console.log(chalk.yellow("\n  Already applied. The deed is done."));
    console.log(chalk.dim(`  Session: ${session.name}\n`));
    return 0;
  }

  // Read decisions.md
  const decisionsPath = join(session.path, "decisions.md");
  if (!existsSync(decisionsPath)) {
    throw new SessionError("No decisions.md found. Consensus without a decision? Impressive.", {
      hint: `Check session: ${session.name}`,
    });
  }

  const decision = await readFile(decisionsPath, "utf-8");

  // Read discussion to get consensus blocks for Lead Knight selection
  const discussionPath = join(session.path, "discussion.md");
  let consensusBlocks: ConsensusBlock[] = [];
  if (existsSync(discussionPath)) {
    const discussion = await readFile(discussionPath, "utf-8");
    const scoreMatches = discussion.matchAll(
      /## Round (\d+) — (\w+)[\s\S]*?Score: (\d+)\/10/g
    );
    for (const match of scoreMatches) {
      consensusBlocks.push({
        knight: match[2],
        round: parseInt(match[1]),
        consensus_score: parseInt(match[3]),
        agrees_with: [],
        pending_issues: [],
      });
    }
  }

  // Select Lead Knight
  const leadKnight = selectLeadKnight(config.knights, consensusBlocks);

  // Show decision summary
  if (dryRun) {
    console.log(chalk.bold.magenta("\n  DRY RUN — no files will be written.\n"));
  }
  console.log(chalk.bold("\n  The council has spoken.\n"));
  console.log(chalk.dim(`  Session:     ${session.name}`));
  console.log(chalk.dim(`  Topic:       ${session.topic || "unknown"}`));
  console.log(chalk.cyan(`  Lead Knight: ${leadKnight.name}\n`));

  // If noparley wasn't set via flag/caller, ask the user (skip in dry-run, skip if caller already asked)
  if (!noparley && !dryRun && !skipParleyPrompt) {
    noparley = await askParleyMode();
  }

  if (dryRun) {
    console.log(chalk.magenta(`  Mode:        DRY RUN`));
    console.log(chalk.dim(`  Full pipeline, zero disk writes.\n`));
  } else if (noparley) {
    console.log(chalk.red.bold(`  Mode:        NO PARLEY`));
    console.log(chalk.dim(`  No questions asked. Bold move.\n`));
  } else {
    console.log(chalk.green(`  Mode:        PARLEY`));
    console.log(chalk.dim(`  Each file will be shown for approval.\n`));
  }

  // Update status to applying (skip in dry-run)
  if (!dryRun) {
    await updateStatus(session.path, { phase: "applying" });
  }

  // Initialize adapters and find the lead knight's adapter
  const adapters = await initializeAdapters(config);
  const adapter = adapters.get(leadKnight.adapter);

  if (!adapter) {
    if (!dryRun) {
      await updateStatus(session.path, { phase: "consensus_reached" });
    }
    throw new AdapterErr(leadKnight.adapter,
      `${leadKnight.name} didn't show up. Adapter "${leadKnight.adapter}" not available.`,
      { hint: "Install the required CLI tool or configure an API key." }
    );
  }

  // Read allowed_files from session status for scope enforcement
  const allowedFiles = status.allowed_files;
  const scopeActive = allowedFiles && allowedFiles.length > 0 && !overrideScope;

  // Show scope info
  if (allowedFiles && allowedFiles.length > 0) {
    console.log(chalk.cyan(`  Scope: ${allowedFiles.length} file(s) allowed:`));
    for (const f of allowedFiles) {
      const isNew = f.toUpperCase().startsWith("NEW:");
      const display = isNew ? f.slice(4) : f;
      console.log(isNew ? chalk.green(`    + ${display} (new)`) : chalk.dim(`    ~ ${display}`));
    }
    console.log("");
  }

  // Override scope flow: require explicit confirmation with reason (skip in dry-run)
  if (overrideScope && allowedFiles && allowedFiles.length > 0 && !dryRun) {
    console.log(chalk.red.bold("  SCOPE OVERRIDE requested."));
    console.log(chalk.yellow("  This bypasses the agreed file scope. All files will be written.\n"));

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const confirm = await rl.question(chalk.red('  Type "YES" to confirm override: '));

    if (confirm.trim() !== "YES") {
      rl.close();
      console.log(chalk.dim("  Override cancelled. Scope enforcement remains active."));
      return 0;
    }

    const reason = await rl.question(chalk.yellow("  Reason for override: "));
    rl.close();

    if (!reason.trim()) {
      console.log(chalk.red("  A reason is required for scope override. Cancelled."));
      return 0;
    }

    console.log(chalk.dim(`\n  Override logged: "${reason.trim()}"\n`));

    // Log override to session
    const { writeFile: writeFileFs } = await import("node:fs/promises");
    const overrideLog = [
      `## Scope Override`,
      `**Date:** ${new Date().toISOString()}`,
      `**Reason:** ${reason.trim()}`,
      `**Original scope:** ${allowedFiles.join(", ")}`,
      "",
    ].join("\n");
    const overridePath = join(session.path, "scope-override.md");
    await writeFileFs(overridePath, overrideLog, "utf-8");

    // Log to decree log
    await addDecreeEntry(
      projectRoot,
      "override_scope",
      session.name,
      session.topic || "unknown",
      reason.trim()
    );
  }

  // Build source context with block maps
  let sourceContextBlock = "";
  let blockMapsBlock = "";
  let fileSegments = new Map<string, SegmentInfo[]>();

  if (allowedFiles && allowedFiles.length > 0) {
    const spinner2 = ora(chalk.dim("  Scanning source files + building block maps...")).start();
    const result = await buildSourceContextWithBlockMaps(allowedFiles, projectRoot);
    sourceContextBlock = result.context;
    blockMapsBlock = result.blockMaps;
    fileSegments = result.fileSegments;
    spinner2.succeed(chalk.dim(`  ${result.fileCount} file(s) scanned (${Math.round(result.totalChars / 1024)}KB, ${fileSegments.size} block map(s))`));

    // Hard fail on token overflow
    if (result.totalChars > MAX_SOURCE_CONTEXT_CHARS) {
      throw new SessionError(
        `Source context too large: ${Math.round(result.totalChars / 1024)}KB exceeds ${Math.round(MAX_SOURCE_CONTEXT_CHARS / 1024)}KB limit.`,
        { hint: "Reduce the scope (fewer allowed_files) or split into smaller apply sessions." }
      );
    }
  }

  // Build execution prompt with BLOCK_* format instructions
  const scopeLines = scopeActive
    ? [
        "",
        "SCOPE RESTRICTION — You may ONLY modify these files:",
        ...allowedFiles!.map((f) => `  - ${f}`),
        "Do NOT create or modify files outside this list.",
        "",
      ]
    : [];

  const blockMapLines = blockMapsBlock
    ? [
        "",
        "=== BLOCK MAPS (file structure — use these segment keys in your operations) ===",
        "",
        blockMapsBlock,
        "",
        "=== END BLOCK MAPS ===",
        "",
      ]
    : [];

  const sourceContextLines = sourceContextBlock
    ? [
        "",
        "=== CURRENT SOURCE CODE ===",
        "",
        sourceContextBlock,
        "",
        "=== END SOURCE CODE ===",
        "",
      ]
    : [];

  const executionPrompt = [
    "CRITICAL: You are running in TEXT-ONLY output mode.",
    "You CANNOT write files, use tools, or edit anything.",
    "You can ONLY output plain text. That is your sole capability.",
    "",
    `You are ${leadKnight.name}, the Lead Knight chosen to implement the following decision.`,
    `Your capabilities: ${leadKnight.capabilities.join(", ")}`,
    ...scopeLines,
    "",
    "=== OUTPUT FORMAT (MANDATORY — READ THIS FIRST) ===",
    "",
    "Use BLOCK operations to modify existing files. Each operation targets a named segment",
    "from the BLOCK MAP below. Do NOT use EDIT: search-and-replace blocks.",
    "",
    "OPERATIONS:",
    "",
    "1. BLOCK_REPLACE — replace an entire segment with new content:",
    "",
    "   BLOCK_REPLACE: src/utils/file-writer.ts :: fn:writeFiles",
    "   ---",
    "   export async function writeFiles(staged: Map<string, string>): Promise<void> {",
    "     // new implementation here",
    "   }",
    "   ---",
    "",
    "2. BLOCK_INSERT_AFTER — insert new code after a segment:",
    "",
    "   BLOCK_INSERT_AFTER: src/orchestrator.ts :: fn:runDiscussion",
    "   ---",
    "   function newHelper(): void {",
    "     // new function",
    "   }",
    "   ---",
    "",
    "3. BLOCK_DELETE — remove an entire segment:",
    "",
    "   BLOCK_DELETE: src/utils/old.ts :: fn:deprecatedFunction",
    "",
    "4. PREAMBLE_REPLACE — replace imports and top-level code before first function/class:",
    "",
    "   PREAMBLE_REPLACE: src/types.ts",
    "   ---",
    "   import { Something } from './new-thing.js';",
    "   import { Other } from './other.js';",
    "   ---",
    "",
    "5. FILE: — create entirely NEW files (not for modifying existing files):",
    "",
    "   FILE: src/utils/new-helper.ts",
    "   ```typescript",
    "   // complete new file content",
    "   ```",
    "",
    "RULES:",
    "- Target segments by their KEY from the BLOCK MAP below (e.g., fn:writeFiles, class:Orchestrator#run, gap:1, preamble)",
    "- Content between --- delimiters replaces the ENTIRE segment — include ALL code for that block",
    "- Only modify segments that the decision requires — leave everything else untouched",
    "- If you need to add a new function, use BLOCK_INSERT_AFTER with an existing segment as anchor",
    "- For new files, use FILE: blocks with complete content",
    "- Do NOT output explanations, commentary, or markdown headers — ONLY operations",
    "- Do NOT use EDIT: search-and-replace blocks — they are deprecated",
    "- Do NOT use plain ``` code blocks — ONLY BLOCK_*, PREAMBLE_REPLACE, and FILE: operations",
    "",
    "=== END OUTPUT FORMAT ===",
    ...blockMapLines,
    ...sourceContextLines,
    "DECISION TO IMPLEMENT:",
    "---",
    decision,
    "---",
    "",
    "REMINDER: Output ONLY BLOCK_REPLACE/BLOCK_INSERT_AFTER/BLOCK_DELETE/PREAMBLE_REPLACE and FILE: operations.",
    "Target segments by their KEY from the BLOCK MAP. No explanations. Start immediately.",
  ].join("\n");

  // Execute — single attempt, no retry loop
  const timeoutMs = config.rules.timeout_per_turn_seconds * 1000 * 3; // Triple timeout for execution

  const spinner = ora(
    chalk.cyan(`  ${leadKnight.name} unsheathes their keyboard...`)
  ).start();

  let result: string;
  try {
    result = await adapter.execute(executionPrompt, timeoutMs);
    spinner.succeed(chalk.cyan(`  ${leadKnight.name} has forged the code`));
  } catch (error) {
    spinner.fail(chalk.red(`  ${leadKnight.name} dropped their sword`));
    if (!dryRun) {
      await updateStatus(session.path, { phase: "consensus_reached" });
    }
    throw error;
  }

  // --- DETECT FORMAT: RTDIFF block ops vs legacy EDIT: vs FILE: only ---
  const hasRtdiff = isRtdiffResponse(result);
  const hasLegacyEdit = isLegacyEditResponse(result);

  if (hasLegacyEdit && !hasRtdiff) {
    console.log(chalk.yellow("\n  ⚠ Legacy EDIT: format detected — the knight used the old format."));
    console.log(chalk.dim("  Processing with legacy parser. Consider re-running for better results.\n"));
  }

  // --- PARSE + STAGE ---
  const staged = new Map<string, string>();
  const stageErrors: string[] = [];
  let scopeViolationCount = 0;

  if (hasRtdiff) {
    // === NEW PATH: RTDIFF block operations ===
    const rtdiff = parseRtdiff(result);

    if (rtdiff.operations.length === 0 && rtdiff.newFiles.length === 0) {
      console.log(chalk.yellow("\n  The knight returned... but brought no operations. Just words."));
      console.log(chalk.dim("  Raw response (first 30 lines):"));
      const indented = result.split("\n").slice(0, 30).map(l => `  ${l}`).join("\n");
      console.log(chalk.dim(indented));
      if (!dryRun) {
        await updateStatus(session.path, { phase: "consensus_reached" });
      }
      return 0;
    }

    // Group operations by file
    const opsByFile = new Map<string, typeof rtdiff.operations>();
    for (const op of rtdiff.operations) {
      const normalized = normalizeScopePath(op.filePath);
      if (!opsByFile.has(normalized)) opsByFile.set(normalized, []);
      opsByFile.get(normalized)!.push({ ...op, filePath: normalized });
    }

    // Scope filter for operations
    if (scopeActive) {
      for (const filePath of opsByFile.keys()) {
        const inScope = allowedFiles!.some(af => {
          const clean = af.toUpperCase().startsWith("NEW:") ? normalizeScopePath(af.slice(4)) : normalizeScopePath(af);
          return normalizeScopePath(filePath) === clean;
        });
        if (!inScope) {
          console.log(chalk.red(`  SCOPE VIOLATION: ${filePath} — blocked`));
          scopeViolationCount++;
          opsByFile.delete(filePath);
        }
      }
    }

    // Apply block operations per file
    for (const [filePath, ops] of opsByFile) {
      let resolvedPath = filePath;
      let fullPath = resolve(projectRoot, filePath);

      // Path matching: if file not found, try to match against allowed_files
      // Knights sometimes abbreviate paths (e.g. "server.js" instead of "src/server.js")
      if (!existsSync(fullPath) && allowedFiles && allowedFiles.length > 0) {
        const match = allowedFiles.find((af) => {
          const norm = normalizeScopePath(af.replace(/^NEW:/i, ""));
          return norm.endsWith(`/${filePath}`) || norm.endsWith(`\\${filePath}`);
        });
        if (match) {
          resolvedPath = normalizeScopePath(match.replace(/^NEW:/i, ""));
          fullPath = resolve(projectRoot, resolvedPath);
          console.log(chalk.dim(`  Path resolved: ${filePath} → ${resolvedPath}`));
        }
      }

      if (!existsSync(fullPath)) {
        stageErrors.push(`${filePath}: file not found (use FILE: for new files)`);
        continue;
      }

      const originalContent = await readFile(fullPath, "utf-8");
      const segments = fileSegments.get(resolvedPath) || fileSegments.get(filePath);

      if (!segments || segments.length === 0) {
        // Re-scan if not in cache (path was resolved or not scanned originally)
        const scanResult = scanBlocks(originalContent);
        fileSegments.set(resolvedPath, scanResult.segments);
      }

      const patchResult = applyBlockOperations(
        originalContent,
        ops.map(op => ({ ...op, filePath: resolvedPath })),
        fileSegments.get(resolvedPath) || fileSegments.get(filePath)!
      );

      if (!patchResult.success) {
        stageErrors.push(patchResult.error || `${filePath}: patch failed`);
        continue;
      }

      if (patchResult.content && patchResult.content !== originalContent) {
        staged.set(resolvedPath, patchResult.content);
      }
    }

    // Stage new FILE: blocks
    const scopeFilter = scopeActive ? allowedFiles : undefined;
    const { allowed: newFilesAllowed, rejected: newFilesRejected } = filterByScope(
      rtdiff.newFiles.map(f => ({ path: normalizeScopePath(f.path), content: f.content })),
      scopeFilter
    );

    for (const rej of newFilesRejected) {
      console.log(chalk.red(`  SCOPE VIOLATION: ${rej.path} — blocked`));
      scopeViolationCount++;
    }

    for (const nf of newFilesAllowed) {
      staged.set(nf.path, nf.content);
    }

  } else {
    // === LEGACY PATH: EDIT: and FILE: blocks ===
    const { files: allFiles, edits: allEdits } = parseKnightOutput(result);

    if (allFiles.length === 0 && allEdits.length === 0) {
      console.log(chalk.yellow("\n  The knight returned... but brought no files. Just words."));
      console.log(chalk.dim("  Raw response (first 30 lines):"));
      const indented = result.split("\n").slice(0, 30).map(l => `  ${l}`).join("\n");
      console.log(chalk.dim(indented));
      if (!dryRun) {
        await updateStatus(session.path, { phase: "consensus_reached" });
      }
      return 0;
    }

    // Scope filter
    const scopeFilter = scopeActive ? allowedFiles : undefined;
    const { allowed: files, rejected: rejFiles } = filterByScope(allFiles, scopeFilter);
    const { allowed: edits, rejected: rejEdits } = filterByScope(allEdits, scopeFilter);

    const totalRejected = rejFiles.length + rejEdits.length;
    if (totalRejected > 0) {
      scopeViolationCount += totalRejected;
      console.log(chalk.red.bold(`\n  SCOPE VIOLATION — ${totalRejected} file(s) blocked:`));
      for (const f of rejFiles) console.log(chalk.red(`    ${f.path}`));
      for (const e of rejEdits) console.log(chalk.red(`    ${e.path}`));
      console.log(chalk.dim(`  Use ${chalk.bold("roundtable apply --override-scope")} to bypass.\n`));
    }

    if (files.length === 0 && edits.length === 0) {
      console.log(chalk.yellow("\n  All files were outside scope. Nothing to write."));
      if (!dryRun) {
        await updateStatus(session.path, { phase: "consensus_reached" });
      }
      return 0;
    }

    // Stage FILE: blocks
    for (const file of files) {
      staged.set(file.path, file.content);
    }

    // Stage EDIT: blocks
    for (const edit of edits) {
      let editPath = edit.path;
      let fullPath = resolve(projectRoot, editPath);

      // Path matching for legacy edits too
      if (!existsSync(fullPath) && allowedFiles && allowedFiles.length > 0) {
        const match = allowedFiles.find((af) => {
          const norm = normalizeScopePath(af.replace(/^NEW:/i, ""));
          return norm.endsWith(`/${editPath}`) || norm.endsWith(`\\${editPath}`);
        });
        if (match) {
          editPath = normalizeScopePath(match.replace(/^NEW:/i, ""));
          fullPath = resolve(projectRoot, editPath);
          console.log(chalk.dim(`  Path resolved: ${edit.path} → ${editPath}`));
        }
      }

      if (!existsSync(fullPath)) {
        stageErrors.push(`${edit.path}: file not found (use FILE: for new files)`);
        continue;
      }

      const originalContent = await readFile(fullPath, "utf-8");
      const editResult = applyEdits(originalContent, edit.edits, edit.path);

      if (editResult.failedEdits && editResult.failedEdits.length > 0) {
        for (const err of editResult.errors || []) stageErrors.push(err);
        continue;
      }

      if (!editResult.content || editResult.content === originalContent) continue;

      staged.set(edit.path, editResult.content);
    }
  }

  // Show staging errors
  if (stageErrors.length > 0) {
    console.log(chalk.red.bold(`\n  STAGING ERRORS — ${stageErrors.length} issue(s):`));
    for (const err of stageErrors) {
      console.log(chalk.yellow(`    ${err}`));
    }
  }

  if (staged.size === 0) {
    console.log(chalk.yellow("\n  Nothing to stage. All operations failed or no changes detected."));
    if (!dryRun) {
      await updateStatus(session.path, { phase: "consensus_reached" });
    }
    return 0;
  }

  // --- VALIDATE: run all checks on staged content ---
  const spinnerVal = ora(chalk.dim("  Validating staged output...")).start();
  const reports = validateAll(staged);
  const failedReports = reports.filter((r) => !r.passed);

  if (failedReports.length > 0) {
    spinnerVal.fail(chalk.red("  Validation FAILED"));
    const reportText = formatValidationReport(reports);
    console.log(reportText);

    if (dryRun) {
      console.log(chalk.red.bold("  DRY RUN — validation failed. Would NOT write any files."));
      throw new SessionError("Dry run failed: validation errors detected.", {
        hint: "Fix the decision or knight output and re-run.",
      });
    }

    console.log(chalk.red.bold("  The knight's output has validation errors. 0 files written."));
    console.log(chalk.dim("  Read the decision in .roundtable/sessions/*/decisions.md and apply manually,"));
    console.log(chalk.dim("  or re-run `roundtable apply` to try again.\n"));
    await updateStatus(session.path, { phase: "consensus_reached" });
    return 0;
  }

  spinnerVal.succeed(chalk.dim(`  ${staged.size} file(s) passed validation`));

  // --- DRY RUN REPORT: show what would be written, then exit ---
  if (dryRun) {
    console.log(chalk.bold.magenta(`\n  DRY RUN REPORT — ${staged.size} file(s) would be written:\n`));

    for (const [filePath, content] of staged) {
      const lines = content.split("\n").length;
      const sizeKB = Math.round(content.length / 1024);
      const isNewFile = !existsSync(resolve(projectRoot, filePath));

      if (isNewFile) {
        console.log(chalk.green(`    + ${filePath} (new, ${lines} lines, ${sizeKB}KB)`));
      } else {
        console.log(chalk.cyan(`    ~ ${filePath} (modified, ${lines} lines, ${sizeKB}KB)`));
      }
    }

    console.log("");

    // Gate summary
    console.log(chalk.bold("  Gate results:"));
    console.log(chalk.green(`    Validation:      PASSED (${staged.size} file(s))`));
    if (scopeActive) {
      if (scopeViolationCount > 0) {
        console.log(chalk.red(`    Scope:           ${scopeViolationCount} violation(s) blocked`));
      } else {
        console.log(chalk.green(`    Scope:           PASSED (all files in scope)`));
      }
    } else {
      console.log(chalk.dim(`    Scope:           disabled`));
    }
    if (stageErrors.length > 0) {
      console.log(chalk.yellow(`    Staging:         ${stageErrors.length} error(s)`));
    } else {
      console.log(chalk.green(`    Staging:         PASSED (0 errors)`));
    }

    console.log(chalk.bold.magenta("\n  No files written. No backups. No manifest updates."));
    console.log(chalk.dim("  Run without --dry-run to apply for real.\n"));

    // Non-zero exit if there were scope violations or staging errors
    if (scopeViolationCount > 0 || stageErrors.length > 0) {
      throw new SessionError("Dry run completed with issues: scope violations or staging errors.", {
        hint: `${scopeViolationCount} scope violation(s), ${stageErrors.length} staging error(s).`,
      });
    }

    return 0;
  }

  // --- WRITE: backup + atomic write ---
  const totalCount = staged.size;
  console.log(chalk.bold(`\n  ${totalCount} file(s) ready to write:\n`));

  let writeResult;
  if (noparley) {
    console.log(chalk.red("  No parley mode — writing all files directly.\n"));
    writeResult = await writeStagedFiles(staged, projectRoot, session.name);
  } else {
    console.log(chalk.dim("  Let's review what the knight proposes:\n"));
    writeResult = await writeStagedFilesWithConfirmation(staged, projectRoot, session.name);
  }

  // Update status + write manifest entry
  if (writeResult.count > 0) {
    await updateStatus(session.path, { phase: "completed" });

    // Write manifest entry
    const topic = session.topic || "unknown";
    const featureId = topicToFeatureId(topic);
    const featureSummary = await getFeatureSummary(session.path, topic);
    const featureStatus: ManifestFeatureStatus =
      writeResult.skippedPaths.length > 0 ? "partial" : "implemented";

    await addManifestEntry(projectRoot, {
      id: featureId,
      session: session.name,
      status: featureStatus,
      files: writeResult.writtenPaths,
      files_skipped: writeResult.skippedPaths.length > 0 ? writeResult.skippedPaths : undefined,
      summary: featureSummary,
      applied_at: new Date().toISOString(),
      lead_knight: leadKnight.name,
    });

    console.log(
      chalk.bold.green(`\n  ${writeResult.count} file(s) written. The decision has been executed.`)
    );
    console.log(chalk.dim(`  Manifest updated: ${featureId} [${featureStatus}]`));
    console.log(chalk.dim(`  Backups saved to .roundtable/backups/${session.name}/`));
    console.log(chalk.dim("  Review the changes before committing.\n"));
    return writeResult.count;
  } else {
    console.log(chalk.yellow("\n  No files were written. The decision remains unexecuted."));
    await updateStatus(session.path, { phase: "consensus_reached" });
    return 0;
  }
}
