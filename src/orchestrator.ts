import chalk from "chalk";
import ora from "ora";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, relative, normalize } from "node:path";
import type {
  RoundtableConfig,
  KnightConfig,
  RoundEntry,
  ConsensusBlock,
  DiagnosticBlock,
  DiagnosisResult,
  SessionResult,
} from "./types.js";
import { BaseAdapter, classifyError, AdapterError } from "./adapters/base.js";
import { checkConsensus, summarizeConsensus, parseDiagnosticFromResponse, checkDiagnosticConvergence, warnMissingScopeAtConsensus } from "./consensus.js";
import { buildSystemPrompt, buildDiagnosticPrompt } from "./utils/prompt.js";
import { buildContext, getProjectFiles, readSourceFiles } from "./utils/context.js";
import { readManifest, getManifestSummary } from "./utils/manifest.js";
import {
  createSession,
  writeDiscussion,
  writeDecisions,
  updateStatus,
} from "./utils/session.js";
import { appendToChronicle } from "./utils/chronicle.js";
import { readErrorLog } from "./utils/error-log.js";
import { readDecreeLog, getActiveDecrees, formatDecreesForPrompt } from "./utils/decree-log.js";

/**
 * Strip JSON blocks containing a specific key from a response string.
 * Handles both fenced code blocks and bare JSON with balanced braces.
 */
function stripConsensusJson(text: string, key: string): string {
  // First: strip fenced ```json ... ``` blocks
  let result = text.replace(/```json[\s\S]*?```/g, "");

  // Second: strip bare JSON containing the key using balanced brace matching
  const keyIdx = result.indexOf(`"${key}"`);
  if (keyIdx === -1) return result;

  // Find the opening brace before the key
  let openIdx = -1;
  for (let i = keyIdx - 1; i >= 0; i--) {
    if (result[i] === "{") { openIdx = i; break; }
  }
  if (openIdx === -1) return result;

  // Walk forward with balanced braces
  let depth = 0;
  for (let i = openIdx; i < result.length; i++) {
    if (result[i] === "{") depth++;
    else if (result[i] === "}") {
      depth--;
      if (depth === 0) {
        result = result.slice(0, openIdx) + result.slice(i + 1);
        break;
      }
    }
  }

  return result;
}

/**
 * Select the Lead Knight based on capabilities matching the topic.
 * Falls back to highest priority knight.
 */
export function selectLeadKnight(
  knights: KnightConfig[],
  blocks: ConsensusBlock[]
): KnightConfig {
  // The knight with the highest consensus_score in the last round is the lead
  const lastRoundBlocks = blocks.filter(
    (b) => b.round === Math.max(...blocks.map((x) => x.round))
  );

  if (lastRoundBlocks.length > 0) {
    const best = lastRoundBlocks.reduce((a, b) =>
      a.consensus_score >= b.consensus_score ? a : b
    );
    const lead = knights.find((k) => k.name === best.knight);
    if (lead) return lead;
  }

  // Fallback: highest priority (lowest number)
  return [...knights].sort((a, b) => a.priority - b.priority)[0];
}

/**
 * Compute the union of all knights' files_to_modify at consensus.
 * Returns deduplicated list of allowed file paths.
 */
export function computeAllowedFiles(blocks: ConsensusBlock[]): string[] {
  const seen = new Set<string>();

  for (const block of blocks) {
    if (block.files_to_modify) {
      for (const file of block.files_to_modify) {
        seen.add(file);
      }
    }
  }

  return Array.from(seen);
}

/** Thinking messages per knight — shown while waiting for response */
const THINKING_MESSAGES: Record<string, string[]> = {
  Claude: [
    "sharpens their arguments...",
    "is architecting a rebuttal...",
    "considers the elegant solution...",
    "mutters about clean code...",
  ],
  Gemini: [
    "drafts a 12-step plan...",
    "sees the bigger picture...",
    "is planning the plan...",
    "prepares a strategic response...",
  ],
  GPT: [
    "just wants to ship it...",
    "prepares a practical take...",
    "cuts through the noise...",
    "is getting impatient...",
  ],
};

function getThinkingMessage(knightName: string): string {
  const messages = THINKING_MESSAGES[knightName] || [
    "is thinking...",
    "prepares their response...",
  ];
  return messages[Math.floor(Math.random() * messages.length)];
}

/** Round headers with personality */
function roundHeader(round: number, maxRounds: number): string {
  const headers = [
    `ROUND ${round} — KNIGHTS! DRAW YOUR KEYBOARDS!`,
    `ROUND ${round} — KNIGHTS! SPEAK NOW OR CODE SUFFERS! FOR KING AND KONG!`,
    `ROUND ${round} — EGOS CLASH, CODE SUFFERS!`,
    `ROUND ${round} — ONE LAST PLEA FOR SANITY!`,
    `ROUND ${round} — SPEAK NOW OR FOREVER HOLD YOUR MERGE CONFLICTS!`,
  ];
  const idx = Math.min(round - 1, headers.length - 1);
  return round <= headers.length ? headers[idx] : `ROUND ${round} — FOR KING AND CODE!`;
}

/**
 * Run a full discussion between knights until consensus or max rounds.
 */
export async function runDiscussion(
  topic: string,
  config: RoundtableConfig,
  adapters: Map<string, BaseAdapter>,
  projectRoot: string,
  readSourceCode = false
): Promise<SessionResult> {
  const { max_rounds, consensus_threshold } = config.rules;

  // Build project context (optionally including source files)
  const contextSpinner = ora("  Gathering intel from the codebase...").start();
  const context = await buildContext(projectRoot, config, readSourceCode);

  // Load manifest for implementation status
  const manifest = await readManifest(projectRoot);
  const manifestSummary = getManifestSummary(manifest);

  // Load decree log for rejected decisions
  const decreeLog = await readDecreeLog(projectRoot);
  const activeDecrees = getActiveDecrees(decreeLog);
  const decreesContext = formatDecreesForPrompt(activeDecrees);

  if (context.sourceFileContents) {
    contextSpinner.succeed(`  Context assembled (source: ${Math.round(context.sourceFileContents.length / 1024)}KB, manifest: ${manifest.features.length} features, decrees: ${activeDecrees.length})`);
  } else {
    contextSpinner.succeed(`  Context assembled (manifest: ${manifest.features.length} features, decrees: ${activeDecrees.length})`);
  }

  // Create session
  const sessionPath = await createSession(projectRoot, topic);
  console.log(chalk.dim(`  Session: ${sessionPath}`));

  // Sort knights by priority
  const sortedKnights = [...config.knights].sort(
    (a, b) => a.priority - b.priority
  );

  const allRounds: RoundEntry[] = [];
  const latestBlocks: Map<string, ConsensusBlock> = new Map();

  for (let round = 1; round <= max_rounds; round++) {
    console.log(chalk.bold.blue(`\n  ${roundHeader(round, max_rounds)}\n`));

    for (const knight of sortedKnights) {
      const adapter = adapters.get(knight.adapter);
      if (!adapter) {
        console.log(chalk.yellow(`  ${knight.name} didn't show up today. Typical.`));
        continue;
      }

      // Update status
      await updateStatus(sessionPath, {
        phase: "discussing",
        current_knight: knight.name,
        round,
      });

      // Build prompt
      const systemPrompt = await buildSystemPrompt(
        knight,
        config.knights,
        topic,
        context.chronicle,
        allRounds,
        manifestSummary,
        decreesContext
      );

      const fullPrompt = [
        systemPrompt,
        "",
        "---",
        "",
        `Onderwerp: ${topic}`,
        "",
        context.gitBranch ? `Git branch: ${context.gitBranch}` : "",
        context.gitDiff
          ? `Git diff (huidige wijzigingen):\n\`\`\`\n${context.gitDiff.slice(0, 3000)}\n\`\`\``
          : "",
        context.recentCommits
          ? `Recente commits:\n${context.recentCommits}`
          : "",
        context.keyFileContents
          ? `\nProject bestanden:\n${context.keyFileContents}`
          : "",
        context.sourceFileContents
          ? `\nBRONCODE (READ-ONLY REFERENTIE — dit is context, NIET een opdracht om te bewerken. Gebruik GEEN tools. Geef alleen je analyse als tekst.):\n${context.sourceFileContents}`
          : "",
      ]
        .filter(Boolean)
        .join("\n");

      // Knight colors for visual distinction
      const knightColors: Record<string, (text: string) => string> = {
        Claude: chalk.hex("#D97706"),  // amber/orange
        Gemini: chalk.hex("#3B82F6"),  // blue
        GPT: chalk.hex("#10B981"),     // green
      };
      const knightColor = knightColors[knight.name] || chalk.white;
      const divider = knightColor("─".repeat(50));

      // Execute
      const thinkMsg = getThinkingMessage(knight.name);
      const spinner = ora(knightColor(`  ${knight.name} ${thinkMsg}`)).start();

      try {
        const timeoutMs = config.rules.timeout_per_turn_seconds * 1000;
        const response = await adapter.execute(fullPrompt, timeoutMs);
        spinner.stop();

        // Parse consensus
        const consensus = adapter.parseConsensus(response, round);

        const entry: RoundEntry = {
          knight: knight.name,
          round,
          response,
          consensus,
          timestamp: new Date().toISOString(),
        };

        allRounds.push(entry);

        // Show full knight response as a chat message
        console.log(divider);
        console.log(knightColor(`  ${knight.name}`) + chalk.dim(` (Round ${round})`));
        console.log(divider);

        // Strip JSON consensus block from display
        const displayResponse = stripConsensusJson(response, "consensus_score")
          .trim();

        // Indent each line for readability
        const indented = displayResponse
          .split("\n")
          .map((line) => `  ${line}`)
          .join("\n");
        console.log(chalk.white(indented));

        // Score bar
        if (consensus) {
          latestBlocks.set(knight.name, consensus);
          const score = consensus.consensus_score;
          const filled = "\u2588".repeat(score);
          const empty = "\u2591".repeat(10 - score);
          const scoreColor = score >= 9 ? chalk.green : score >= 6 ? chalk.yellow : chalk.red;

          console.log("");
          console.log(
            `  ${knightColor(knight.name)} score: ${scoreColor(`${filled}${empty} ${score}/10`)}`
          );
          if (consensus.agrees_with.length > 0) {
            console.log(chalk.dim(`  Agrees with: ${consensus.agrees_with.join(", ")}`));
          }
          if (consensus.pending_issues.length > 0) {
            console.log(chalk.yellow(`  Open issues: ${consensus.pending_issues.join(", ")}`));
          }
        } else {
          console.log(chalk.yellow(`\n  (no consensus block found — the knight forgot the rules)`));
        }

        console.log("");
      } catch (error) {
        spinner.fail(`  ${knight.name} crashed and burned`);
        const classified = classifyError(error, knight.name);
        const hint: Record<string, string> = {
          not_installed: `Is "${knight.adapter}" installed and in PATH?`,
          timeout: "Consider increasing timeout_per_turn_seconds in config.",
          auth: "Check your API key or subscription status.",
          api: "The API returned an error. Try again later.",
          unknown: "",
        };
        console.log(chalk.red(`  Error (${classified.kind}): ${classified.message}`));
        if (hint[classified.kind]) {
          console.log(chalk.dim(`  Hint: ${hint[classified.kind]}`));
        }
      }
    }

    // Write discussion so far
    await writeDiscussion(sessionPath, allRounds);

    // Check consensus after each complete round
    const currentBlocks = Array.from(latestBlocks.values());
    if (checkConsensus(currentBlocks, consensus_threshold)) {
      console.log(chalk.bold.green("\n  Against all odds... they actually agree."));
      console.log(summarizeConsensus(currentBlocks));

      // Warn about missing scope for agreeing knights
      for (const block of currentBlocks) {
        warnMissingScopeAtConsensus(block);
      }

      // Compute allowed files from all knights' scopes
      const allowedFiles = computeAllowedFiles(currentBlocks);
      if (allowedFiles.length > 0) {
        console.log(chalk.cyan(`\n  Scope: ${allowedFiles.length} file(s) in modification scope:`));
        for (const f of allowedFiles) {
          const isNew = f.toUpperCase().startsWith("NEW:");
          const display = isNew ? f.slice(4) : f;
          console.log(isNew ? chalk.green(`    + ${display} (new)`) : chalk.dim(`    ~ ${display}`));
        }
      }

      // Find the proposal from the last round
      const lastProposal =
        allRounds
          .slice()
          .reverse()
          .find((r) => r.consensus?.proposal)?.consensus?.proposal ||
        allRounds[allRounds.length - 1]?.response ||
        "No proposal text available.";

      // Write decisions
      await writeDecisions(sessionPath, topic, lastProposal, allRounds);
      await updateStatus(sessionPath, {
        phase: "consensus_reached",
        consensus_reached: true,
        round,
        allowed_files: allowedFiles.length > 0 ? allowedFiles : undefined,
      });

      // Update chronicle
      const leadKnight = selectLeadKnight(config.knights, currentBlocks);
      await appendToChronicle(projectRoot, config.chronicle, {
        topic,
        outcome: `Consensus in ${round} round(s). Lead Knight: ${leadKnight.name}.\n\n${lastProposal}`,
        knights: currentBlocks.map((b) => b.knight),
        date: new Date().toISOString().slice(0, 10),
      });

      return {
        sessionPath,
        consensus: true,
        rounds: round,
        decision: lastProposal,
        blocks: currentBlocks,
        allRounds,
      };
    }

    // Escalation warning
    if (round >= config.rules.escalate_to_user_after && round < max_rounds) {
      console.log(
        chalk.yellow(
          `\n  Round ${round}: Still no consensus. ${max_rounds - round} round(s) left before escalation.`
        )
      );
    }
  }

  // Max rounds reached without consensus
  console.log(chalk.bold.yellow("\n  The knights have agreed to disagree. Your move."));
  console.log(summarizeConsensus(Array.from(latestBlocks.values())));

  await updateStatus(sessionPath, {
    phase: "escalated",
    consensus_reached: false,
    round: max_rounds,
  });

  return {
    sessionPath,
    consensus: false,
    rounds: max_rounds,
    decision: null,
    blocks: Array.from(latestBlocks.values()),
    allRounds,
  };
}

// --- Diagnostic orchestration for code-red mode ---

/** Thinking messages per knight in diagnostic mode */
const DIAGNOSTIC_THINKING: Record<string, string[]> = {
  Claude: [
    "examines the patient's vitals...",
    "reviews the pathology report...",
    "checks for edge cases in the bloodwork...",
    "mutters about insufficient test coverage...",
  ],
  Gemini: [
    "looks at the bigger picture...",
    "checks the system interactions...",
    "orders a full body scan...",
    "considers environmental factors...",
  ],
  GPT: [
    "checks the pulse...",
    "reaches for the defibrillator...",
    "wants to stabilize first...",
    "skims the chart impatiently...",
  ],
};

function getDiagnosticThinking(knightName: string): string {
  const messages = DIAGNOSTIC_THINKING[knightName] || [
    "is diagnosing...",
    "examines the symptoms...",
  ];
  return messages[Math.floor(Math.random() * messages.length)];
}

/** Diagnostic round headers */
function diagnosticRoundHeader(round: number): string {
  const headers = [
    `TRIAGE — INITIAL ASSESSMENT`,
    `BLIND ROUND — INDEPENDENT DIAGNOSIS`,
    `CONVERGENCE ROUND ${round} — COMPARING DIAGNOSES`,
    `CONVERGENCE ROUND ${round} — NARROWING DOWN`,
    `DEEP DIVE ROUND ${round} — NEW EVIDENCE ONLY`,
    `FINAL ROUND ${round} — LAST CHANCE TO CONVERGE`,
  ];
  const idx = Math.min(round, headers.length - 1);
  return headers[idx];
}

/**
 * Resolve file requests from knights: read files with security checks.
 * Paths must be workspace-relative, no "..", must not match ignore patterns.
 * Supports range notation: "path/to/file.ts:10-50"
 */
export async function resolveFileRequests(
  fileRequests: string[],
  projectRoot: string,
  ignorePatterns: string[]
): Promise<string> {
  const results: string[] = [];

  for (const req of fileRequests.slice(0, 4)) {
    // Parse optional line range
    const rangeMatch = req.match(/^(.+?):(\d+)-(\d+)$/);
    const filePath = rangeMatch ? rangeMatch[1] : req;
    const startLine = rangeMatch ? parseInt(rangeMatch[2]) : undefined;
    const endLine = rangeMatch ? parseInt(rangeMatch[3]) : undefined;

    // Security: normalize and check
    const normalized = normalize(filePath).replace(/\\/g, "/");
    if (normalized.includes("..") || normalized.startsWith("/")) {
      results.push(`[DENIED] ${req} — path traversal not allowed`);
      continue;
    }

    // Check ignore patterns
    const shouldIgnore = ignorePatterns.some(
      (pattern) =>
        normalized.startsWith(pattern) ||
        normalized.includes(`/${pattern}/`)
    );
    if (shouldIgnore) {
      results.push(`[DENIED] ${req} — matches ignore pattern`);
      continue;
    }

    const fullPath = join(projectRoot, normalized);
    if (!existsSync(fullPath)) {
      results.push(`[NOT FOUND] ${req}`);
      continue;
    }

    try {
      const content = await readFile(fullPath, "utf-8");
      const lines = content.split("\n");

      let excerpt: string;
      if (startLine !== undefined && endLine !== undefined) {
        const start = Math.max(0, startLine - 1);
        const end = Math.min(lines.length, endLine);
        excerpt = lines.slice(start, end).join("\n");
      } else {
        // Limit to 200 lines
        excerpt = lines.slice(0, 200).join("\n");
        if (lines.length > 200) {
          excerpt += `\n...(${lines.length - 200} more lines)`;
        }
      }

      results.push(`### ${req}\n\`\`\`\n${excerpt}\n\`\`\``);
    } catch {
      results.push(`[ERROR] ${req} — could not read file`);
    }
  }

  return results.join("\n\n");
}

/**
 * Check if a knight's diagnostic round passes the progress gate (rounds 5-6).
 * Must have: new evidence OR rules_out OR file_requests OR confidence +2.
 */
export function passesProgressGate(
  current: DiagnosticBlock,
  previousByKnight: DiagnosticBlock[]
): boolean {
  if (previousByKnight.length === 0) return true;
  const last = previousByKnight[previousByKnight.length - 1];

  // New evidence?
  const newEvidence = current.evidence.some((e) => !last.evidence.includes(e));
  if (newEvidence) return true;

  // New rules_out?
  const newRulesOut = current.rules_out.some((r) => !last.rules_out.includes(r));
  if (newRulesOut) return true;

  // New file requests?
  if (current.file_requests.length > 0) return true;

  // Confidence jump >= 2?
  if (current.confidence_score - last.confidence_score >= 2) return true;

  return false;
}

/**
 * Run a full diagnostic session between knights (code-red mode).
 */
export async function runDiagnosis(
  symptoms: string,
  config: RoundtableConfig,
  adapters: Map<string, BaseAdapter>,
  projectRoot: string,
  readCodebase: boolean
): Promise<DiagnosisResult> {
  const maxRounds = config.rules.max_rounds + 1; // +1 for triage round (round 0)

  // Create session
  const sessionPath = await createSession(projectRoot, `CODE-RED: ${symptoms}`);
  console.log(chalk.dim(`  Session: ${sessionPath}`));

  // Read error log for triage context
  const errorLog = await readErrorLog(projectRoot);
  const errorLogContext = errorLog.length > 0
    ? errorLog.map((e) => `- ${e.id}: ${e.symptoms} [${e.status}]`).join("\n")
    : "";

  // Optionally read codebase
  let codebaseContext = "";
  if (readCodebase) {
    const codeSpinner = ora("  Reading the patient's full medical history (codebase)...").start();
    codebaseContext = await readSourceFiles(projectRoot, config.rules.ignore);
    codeSpinner.succeed(`  Codebase loaded (${Math.round(codebaseContext.length / 1024)}KB)`);
  }

  // Sort knights by priority
  const sortedKnights = [...config.knights].sort((a, b) => a.priority - b.priority);

  const allRounds: RoundEntry[] = [];
  const latestDiagnostics: Map<string, DiagnosticBlock> = new Map();
  const knightFailures: Map<string, number> = new Map();
  let resolvedFiles = codebaseContext; // Start with optional codebase context

  for (let round = 0; round < maxRounds; round++) {
    console.log(chalk.bold.red(`\n  ${diagnosticRoundHeader(round)}\n`));

    for (const knight of sortedKnights) {
      // Knight health: 2+ parse failures → excluded
      const failures = knightFailures.get(knight.name) || 0;
      if (failures >= 2) {
        console.log(chalk.dim(`  Dr. ${knight.name} has been removed from the operating room. (${failures} parse failures)`));
        continue;
      }

      const adapter = adapters.get(knight.adapter);
      if (!adapter) {
        console.log(chalk.yellow(`  Dr. ${knight.name} is not on call today.`));
        continue;
      }

      // Progress gate for rounds 5+
      if (round >= 5) {
        const previousByKnight = allRounds
          .filter((r) => r.knight === knight.name && r.diagnostic)
          .map((r) => r.diagnostic!);
        const lastDiag = latestDiagnostics.get(knight.name);
        if (lastDiag && !passesProgressGate(lastDiag, previousByKnight.slice(0, -1))) {
          console.log(chalk.dim(`  Dr. ${knight.name} has nothing new to add. Sitting out.`));
          continue;
        }
      }

      await updateStatus(sessionPath, {
        phase: round === 0 ? "triaging" : "diagnosing",
        current_knight: knight.name,
        round,
      });

      // Build diagnostic prompt
      const prompt = await buildDiagnosticPrompt(
        knight,
        config.knights,
        symptoms,
        round,
        allRounds,
        errorLogContext,
        resolvedFiles
      );

      // Knight colors
      const knightColors: Record<string, (text: string) => string> = {
        Claude: chalk.hex("#D97706"),
        Gemini: chalk.hex("#3B82F6"),
        GPT: chalk.hex("#10B981"),
      };
      const knightColor = knightColors[knight.name] || chalk.white;
      const divider = chalk.red("─".repeat(50));

      const thinkMsg = getDiagnosticThinking(knight.name);
      const spinner = ora(knightColor(`  Dr. ${knight.name} ${thinkMsg}`)).start();

      try {
        const timeoutMs = config.rules.timeout_per_turn_seconds * 1000;
        const response = await adapter.execute(prompt, timeoutMs);
        spinner.stop();

        // Parse diagnostic block
        const diagnostic = parseDiagnosticFromResponse(response, knight.name, round);

        const entry: RoundEntry = {
          knight: knight.name,
          round,
          response,
          consensus: null,
          diagnostic,
          timestamp: new Date().toISOString(),
        };

        allRounds.push(entry);

        // Display
        console.log(divider);
        console.log(chalk.red(`  Dr. ${knight.name}`) + chalk.dim(` (Round ${round})`));
        console.log(divider);

        const displayResponse = stripConsensusJson(response, "confidence_score")
          .trim();

        const indented = displayResponse
          .split("\n")
          .map((line) => `  ${line}`)
          .join("\n");
        console.log(chalk.white(indented));

        if (diagnostic) {
          latestDiagnostics.set(knight.name, diagnostic);
          const score = diagnostic.confidence_score;
          const filled = "\u2588".repeat(score);
          const empty = "\u2591".repeat(10 - score);
          const scoreColor = score >= 8 ? chalk.green : score >= 5 ? chalk.yellow : chalk.red;

          console.log("");
          console.log(
            `  ${chalk.red("Dr. " + knight.name)} confidence: ${scoreColor(`${filled}${empty} ${score}/10`)}`
          );
          console.log(chalk.dim(`  Root cause: ${diagnostic.root_cause_key}`));
          if (diagnostic.evidence.length > 0) {
            console.log(chalk.dim(`  Evidence: ${diagnostic.evidence.join(", ")}`));
          }
          if (diagnostic.rules_out.length > 0) {
            console.log(chalk.dim(`  Rules out: ${diagnostic.rules_out.join(", ")}`));
          }

          // Resolve file requests for next round
          if (diagnostic.file_requests.length > 0) {
            console.log(chalk.dim(`  Requesting files: ${diagnostic.file_requests.join(", ")}`));
            const newFiles = await resolveFileRequests(
              diagnostic.file_requests,
              projectRoot,
              config.rules.ignore
            );
            if (newFiles) {
              resolvedFiles += "\n\n" + newFiles;
            }
          }
        } else {
          console.log(chalk.yellow(`\n  (no diagnostic block found — Dr. ${knight.name} forgot the protocol)`));
          knightFailures.set(knight.name, failures + 1);
        }

        console.log("");
      } catch (error) {
        spinner.fail(`  Dr. ${knight.name} collapsed in the OR`);
        const classified = classifyError(error, knight.name);
        console.log(chalk.red(`  Error (${classified.kind}): ${classified.message}`));
      }
    }

    // Write discussion so far
    await writeDiscussion(sessionPath, allRounds);

    // Check diagnostic convergence
    const currentDiags = Array.from(latestDiagnostics.values());
    const { converged, rootCauseKey } = checkDiagnosticConvergence(currentDiags);

    if (converged && rootCauseKey) {
      console.log(chalk.bold.green("\n  DIAGNOSIS CONVERGED. The doctors agree."));
      console.log(chalk.green(`  Root cause: ${rootCauseKey}`));

      // Get the best description from the highest confidence knight
      const bestDiag = currentDiags
        .filter((d) => d.root_cause_key === rootCauseKey || d.confidence_score >= 8)
        .sort((a, b) => b.confidence_score - a.confidence_score)[0];

      const rootCauseDescription = allRounds
        .filter((r) => r.knight === bestDiag?.knight)
        .pop()?.response || "No detailed description available.";

      // Collect allowed files from all diagnostic file_requests
      const diagAllowedFiles = new Set<string>();
      for (const r of allRounds) {
        if (r.diagnostic?.file_requests) {
          for (const f of r.diagnostic.file_requests) {
            // Strip line ranges (e.g. "src/server.js:10-50" → "src/server.js")
            diagAllowedFiles.add(f.split(":")[0]);
          }
        }
      }

      await writeDecisions(sessionPath, `CODE-RED: ${symptoms}`, rootCauseDescription, allRounds);
      await updateStatus(sessionPath, {
        phase: "diagnosis_converged",
        consensus_reached: true,
        round,
        allowed_files: diagAllowedFiles.size > 0 ? [...diagAllowedFiles] : undefined,
      });

      return {
        sessionPath,
        converged: true,
        rootCauseKey,
        rootCause: rootCauseDescription,
        codeRedId: "", // Will be set by the command
        rounds: round + 1,
        allRounds,
      };
    }

    // Show current state
    if (currentDiags.length > 0 && round < maxRounds - 1) {
      console.log(chalk.dim("\n  Current diagnoses:"));
      for (const d of currentDiags) {
        const scoreColor = d.confidence_score >= 8 ? chalk.green : d.confidence_score >= 5 ? chalk.yellow : chalk.red;
        console.log(
          chalk.dim(`    Dr. ${d.knight}: `) +
          scoreColor(`${d.root_cause_key} (${d.confidence_score}/10)`)
        );
      }
    }
  }

  // Max rounds reached without convergence
  console.log(chalk.bold.yellow("\n  DIAGNOSIS INCONCLUSIVE. The doctors could not agree."));

  // Show suspects
  const finalDiags = Array.from(latestDiagnostics.values());
  if (finalDiags.length > 0) {
    console.log(chalk.yellow("\n  Suspects:"));
    for (const d of finalDiags.sort((a, b) => b.confidence_score - a.confidence_score)) {
      const scoreColor = d.confidence_score >= 8 ? chalk.green : d.confidence_score >= 5 ? chalk.yellow : chalk.red;
      console.log(
        `    Dr. ${d.knight}: ` +
        scoreColor(`${d.root_cause_key} (${d.confidence_score}/10)`)
      );
    }
  }

  await updateStatus(sessionPath, {
    phase: "diagnosis_parked",
    consensus_reached: false,
    round: maxRounds,
  });

  return {
    sessionPath,
    converged: false,
    rootCauseKey: finalDiags[0]?.root_cause_key || null,
    rootCause: null,
    codeRedId: "",
    rounds: maxRounds,
    allRounds,
  };
}
