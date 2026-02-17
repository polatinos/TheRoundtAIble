import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import ora from "ora";
import { loadConfig } from "../utils/config.js";
import { ConfigError, SessionError, AdapterError as AdapterErr } from "../utils/errors.js";
import { initializeAdapters } from "../utils/adapters.js";
import { findLatestSession, updateStatus } from "../utils/session.js";
import { selectLeadKnight } from "../orchestrator.js";
import {
  parseCodeBlocks,
  writeFilesDirect,
  writeFilesWithConfirmation,
  filterByScope,
} from "../utils/file-writer.js";
import { askParleyMode } from "../utils/decree.js";
import { addManifestEntry, topicToFeatureId, getFeatureSummary } from "../utils/manifest.js";
import type { ConsensusBlock, ManifestFeatureStatus } from "../types.js";
import { createInterface } from "node:readline/promises";

/**
 * The `roundtable apply` command.
 * Reads the latest session's decision and executes it via the Lead Knight.
 * Now actually writes files to disk instead of just printing text.
 *
 * Modes:
 *   --parley (default) — shows each file, asks for confirmation
 *   --noparley — writes everything directly ("dangerous mode")
 */
export async function applyCommand(initialNoparley = false, overrideScope = false): Promise<void> {
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
    return;
  }

  if (status.phase === "completed") {
    console.log(chalk.yellow("\n  Already applied. The deed is done."));
    console.log(chalk.dim(`  Session: ${session.name}\n`));
    return;
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
  let blocks: ConsensusBlock[] = [];
  if (existsSync(discussionPath)) {
    const discussion = await readFile(discussionPath, "utf-8");
    const scoreMatches = discussion.matchAll(
      /## Round (\d+) — (\w+)[\s\S]*?Score: (\d+)\/10/g
    );
    for (const match of scoreMatches) {
      blocks.push({
        knight: match[2],
        round: parseInt(match[1]),
        consensus_score: parseInt(match[3]),
        agrees_with: [],
        pending_issues: [],
      });
    }
  }

  // Select Lead Knight
  const leadKnight = selectLeadKnight(config.knights, blocks);

  // Show decision summary
  console.log(chalk.bold("\n  The council has spoken.\n"));
  console.log(chalk.dim(`  Session:     ${session.name}`));
  console.log(chalk.dim(`  Topic:       ${session.topic || "unknown"}`));
  console.log(chalk.cyan(`  Lead Knight: ${leadKnight.name}\n`));

  // If noparley wasn't set via --noparley flag, ask the user
  if (!noparley) {
    noparley = await askParleyMode();
  }

  if (noparley) {
    console.log(chalk.red.bold(`  Mode:        NO PARLEY`));
    console.log(chalk.dim(`  No questions asked. Bold move.\n`));
  } else {
    console.log(chalk.green(`  Mode:        PARLEY`));
    console.log(chalk.dim(`  Each file will be shown for approval.\n`));
  }

  // Update status to applying
  await updateStatus(session.path, { phase: "applying" });

  // Initialize adapters and find the lead knight's adapter
  const adapters = await initializeAdapters(config);
  const adapter = adapters.get(leadKnight.adapter);

  if (!adapter) {
    await updateStatus(session.path, { phase: "consensus_reached" });
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

  // Override scope flow: require explicit confirmation with reason
  if (overrideScope && allowedFiles && allowedFiles.length > 0) {
    console.log(chalk.red.bold("  SCOPE OVERRIDE requested."));
    console.log(chalk.yellow("  This bypasses the agreed file scope. All files will be written.\n"));

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const confirm = await rl.question(chalk.red('  Type "YES" to confirm override: '));

    if (confirm.trim() !== "YES") {
      rl.close();
      console.log(chalk.dim("  Override cancelled. Scope enforcement remains active."));
      return;
    }

    const reason = await rl.question(chalk.yellow("  Reason for override: "));
    rl.close();

    if (!reason.trim()) {
      console.log(chalk.red("  A reason is required for scope override. Cancelled."));
      return;
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
  }

  // Build execution prompt with file format instructions
  const scopeLines = scopeActive
    ? [
        "",
        "SCOPE RESTRICTION — You may ONLY modify these files:",
        ...allowedFiles!.map((f) => `  - ${f}`),
        "Do NOT create or modify files outside this list.",
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
    "DECISION TO IMPLEMENT:",
    "---",
    decision,
    "---",
    "",
    "OUTPUT FORMAT — follow this EXACTLY:",
    "For EACH file, output this pattern:",
    "",
    "FILE: path/to/file.ts",
    "```typescript",
    "// complete file content here",
    "```",
    "",
    "Rules:",
    "- Start each file with FILE: followed by the relative path",
    "- Then a fenced code block with the COMPLETE file content",
    "- Do NOT use partial snippets or diffs — give the FULL file",
    "- Include ALL files needed to implement the decision",
    "- Do NOT ask for permission — just output the text",
    "- Do NOT explain anything — ONLY output FILE: blocks",
    "- No commentary, no questions, no tool usage — just the files",
  ].join("\n");

  // Execute
  const spinner = ora(
    chalk.cyan(`  ${leadKnight.name} unsheathes their keyboard...`)
  ).start();

  try {
    const timeoutMs = config.rules.timeout_per_turn_seconds * 1000 * 3; // Triple timeout for execution
    const result = await adapter.execute(executionPrompt, timeoutMs);
    spinner.succeed(chalk.cyan(`  ${leadKnight.name} has forged the code`));

    // Parse code blocks from response
    const allFiles = parseCodeBlocks(result);

    if (allFiles.length === 0) {
      console.log(
        chalk.yellow(
          "\n  The knight returned... but brought no files. Just words."
        )
      );
      console.log(chalk.dim("  Raw response:"));
      const indented = result
        .split("\n")
        .slice(0, 30)
        .map((line) => `  ${line}`)
        .join("\n");
      console.log(chalk.dim(indented));
      if (result.split("\n").length > 30) {
        console.log(chalk.dim("  ...(truncated)"));
      }
      await updateStatus(session.path, { phase: "consensus_reached" });
      return;
    }

    // Apply scope filtering
    const { allowed: files, rejected } = filterByScope(allFiles, scopeActive ? allowedFiles : undefined);

    if (rejected.length > 0) {
      console.log(chalk.red.bold(`\n  SCOPE VIOLATION — ${rejected.length} file(s) blocked:`));
      for (const f of rejected) {
        console.log(chalk.red(`    ${f.path}`));
      }
      console.log(chalk.dim(`\n  These files were not in the agreed scope.`));
      console.log(chalk.dim(`  Use ${chalk.bold("roundtable apply --override-scope")} to bypass.\n`));
    }

    if (files.length === 0) {
      console.log(chalk.yellow("\n  All files were outside scope. Nothing to write."));
      await updateStatus(session.path, { phase: "consensus_reached" });
      return;
    }

    console.log(
      chalk.bold(`\n  ${files.length} file(s) forged by ${leadKnight.name}:\n`)
    );

    // Write files based on mode
    let writeResult;
    if (noparley) {
      console.log(chalk.red("  No parley mode — writing all files directly.\n"));
      writeResult = await writeFilesDirect(files, projectRoot);
    } else {
      console.log(chalk.dim("  Let's review what the knight proposes:\n"));
      writeResult = await writeFilesWithConfirmation(files, projectRoot);
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
      console.log(chalk.dim("  Review the changes before committing.\n"));
    } else {
      console.log(chalk.yellow("\n  No files were written. The decision remains unexecuted."));
      await updateStatus(session.path, { phase: "consensus_reached" });
    }
  } catch (error) {
    spinner.fail(chalk.red(`  ${leadKnight.name} dropped their sword`));
    await updateStatus(session.path, { phase: "consensus_reached" });
    throw error; // Propagate to central handler in index.ts
  }
}
