import chalk from "chalk";
import ora from "ora";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, normalize } from "node:path";
import type {
  RoundtableConfig,
  KnightConfig,
  RoundEntry,
  ConsensusBlock,
  SessionResult,
  ContinueOptions,
} from "./types.js";
import { BaseAdapter, classifyError, AdapterError } from "./adapters/base.js";
import { checkConsensus, checkNegativeConsensus, summarizeConsensus, warnMissingScopeAtConsensus } from "./consensus.js";
import { buildSystemPrompt } from "./utils/prompt.js";
import { buildContext } from "./utils/context.js";
import { readManifest, getManifestSummary } from "./utils/manifest.js";
import {
  createSession,
  writeDiscussion,
  writeDecisions,
  updateStatus,
} from "./utils/session.js";
import { appendToChronicle } from "./utils/chronicle.js";
import { readDecreeLog, getActiveDecrees, formatDecreesForPrompt } from "./utils/decree-log.js";
import { resolveVerifyCommands } from "./utils/verify.js";
import { createAdapter } from "./utils/adapters.js";

/**
 * Fisher-Yates shuffle — randomize array order in-place.
 */
function shuffleArray<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Try executing a prompt with the primary adapter, falling back to a
 * secondary adapter at runtime if the primary fails (e.g. usage limit).
 */
export async function executeWithFallback(
  primary: BaseAdapter,
  knight: KnightConfig,
  config: RoundtableConfig,
  prompt: string,
  timeoutMs: number,
  adapters: Map<string, BaseAdapter>
): Promise<string> {
  try {
    return await primary.execute(prompt, timeoutMs);
  } catch (primaryError) {
    if (!knight.fallback) throw primaryError;

    // Try runtime fallback
    let fallback = adapters.get(`__fallback_${knight.name}`);
    if (!fallback) {
      const created = createAdapter(knight.fallback, config, timeoutMs);
      if (created && (await created.isAvailable())) {
        adapters.set(`__fallback_${knight.name}`, created);
        fallback = created;
      }
    }

    if (!fallback) throw primaryError;

    console.log(chalk.yellow(`  ${knight.name} primary adapter failed, switching to fallback (${knight.fallback})...`));
    return await fallback.execute(prompt, timeoutMs);
  }
}

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
  // Find the highest score in the last round
  const lastRoundBlocks = blocks.filter(
    (b) => b.round === Math.max(...blocks.map((x) => x.round))
  );

  if (lastRoundBlocks.length > 0) {
    const maxScore = Math.max(...lastRoundBlocks.map((b) => b.consensus_score));
    const topScorers = lastRoundBlocks.filter((b) => b.consensus_score === maxScore);

    // If tie: pick the knight with the highest priority (lowest number)
    // This ensures the most capable knight leads, not a random one
    const sorted = topScorers
      .map((b) => knights.find((k) => k.name === b.knight))
      .filter((k): k is KnightConfig => k !== undefined)
      .sort((a, b) => a.priority - b.priority);

    if (sorted.length > 0) return sorted[0];
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
    const rangeMatch = req.match(/^(.+?):(\d+)-(\d+)$/);
    const filePath = rangeMatch ? rangeMatch[1] : req;
    const startLine = rangeMatch ? parseInt(rangeMatch[2]) : undefined;
    const endLine = rangeMatch ? parseInt(rangeMatch[3]) : undefined;

    const normalized = normalize(filePath).replace(/\\/g, "/");
    if (normalized.includes("..") || normalized.startsWith("/")) {
      results.push(`[DENIED] ${req} — path traversal not allowed`);
      continue;
    }

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
 * When `continueFrom` is provided, resumes an existing session instead of starting fresh.
 */
export async function runDiscussion(
  topic: string,
  config: RoundtableConfig,
  adapters: Map<string, BaseAdapter>,
  projectRoot: string,
  readSourceCode = false,
  continueFrom?: ContinueOptions
): Promise<SessionResult> {
  const { max_rounds, consensus_threshold } = config.rules;

  // Calculate source context budget — use the smallest budget across all adapters
  // so all knights see the same context (fairness)
  let maxSourceChars = 200_000;
  for (const knight of config.knights) {
    const adapter = adapters.get(knight.adapter);
    if (adapter) {
      const budget = adapter.getMaxSourceChars();
      if (budget !== undefined && budget < maxSourceChars) {
        maxSourceChars = budget;
      }
    }
  }

  // Build project context (optionally including source files)
  const contextSpinner = ora("  Gathering intel from the codebase...").start();
  const context = await buildContext(projectRoot, config, readSourceCode, maxSourceChars);

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

  // Reuse existing session or create new one
  const sessionPath = continueFrom
    ? continueFrom.sessionPath
    : await createSession(projectRoot, topic);

  if (continueFrom) {
    console.log(chalk.bold.yellow("\n  The King has spoken. Back to the table, knights!\n"));
  } else {
    console.log(chalk.dim(`  Session: ${sessionPath}`));
  }

  // First round: sort by priority. Later rounds: shuffle to prevent yes-man behavior.
  const sortedKnights = [...config.knights].sort(
    (a, b) => a.priority - b.priority
  );

  // Restore state from previous run or start fresh
  const allRounds: RoundEntry[] = continueFrom ? [...continueFrom.allRounds] : [];
  const latestBlocks: Map<string, ConsensusBlock> = new Map();
  let resolvedFiles = continueFrom?.resolvedFiles || "";
  let resolvedCommands = continueFrom?.resolvedCommands || "";

  // Rebuild latestBlocks from previous rounds
  if (continueFrom) {
    for (const entry of continueFrom.allRounds) {
      if (entry.consensus) {
        latestBlocks.set(entry.knight, entry.consensus);
      }
    }
  }

  const startRound = continueFrom?.startRound || 1;
  const endRound = startRound + max_rounds - 1;

  for (let round = startRound; round <= endRound; round++) {
    // First round of this run: priority order. Later rounds: shuffled to prevent yes-man behavior.
    const isFirstRound = round === startRound && !continueFrom;
    const roundOrder = isFirstRound
      ? sortedKnights
      : shuffleArray([...sortedKnights]);

    if (!isFirstRound) {
      const orderStr = roundOrder.map((k) => k.name).join(" → ");
      console.log(chalk.dim(`  Speaking order: ${orderStr}`));
    }

    console.log(chalk.bold.blue(`\n  ${roundHeader(round, max_rounds)}\n`));

    for (const knight of roundOrder) {
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

      const kingDemand = continueFrom
        ? [
            "",
            "⚠️ THE KING HAS SENT YOU BACK TO THE TABLE.",
            "The King demands unanimity. You MUST reach consensus this time.",
            "Address ALL pending_issues from previous rounds. If you mostly agree, RAISE your score to 9+.",
            "Do NOT repeat your previous arguments — build on them and CONVERGE.",
            "",
          ].join("\n")
        : "";

      const fullPrompt = [
        systemPrompt,
        "",
        "---",
        "",
        `Onderwerp: ${topic}`,
        kingDemand,
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
        resolvedFiles
          ? `\nOPGEVRAAGDE BESTANDEN (via file_requests van vorige rondes):\n${resolvedFiles}`
          : "",
        resolvedCommands
          ? `\nVERIFICATIE RESULTATEN (via verify_commands van vorige rondes):\n${resolvedCommands}`
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
        const response = await executeWithFallback(adapter, knight, config, fullPrompt, timeoutMs, adapters);
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
          // Resolve file_requests for next round
          if (consensus.file_requests && consensus.file_requests.length > 0) {
            console.log(chalk.dim(`  Requesting files: ${consensus.file_requests.join(", ")}`));
            const newFiles = await resolveFileRequests(
              consensus.file_requests,
              projectRoot,
              config.rules.ignore
            );
            if (newFiles) {
              resolvedFiles += (resolvedFiles ? "\n\n" : "") + newFiles;
            }
          }

          // Resolve verify_commands for next round
          if (consensus.verify_commands && consensus.verify_commands.length > 0) {
            console.log(chalk.dim(`  Verification commands:`));
            const newCommands = await resolveVerifyCommands(
              consensus.verify_commands,
              projectRoot
            );
            if (newCommands) {
              resolvedCommands += (resolvedCommands ? "\n\n" : "") + newCommands;
            }
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
        resolvedFiles,
        resolvedCommands,
      };
    }

    // Check negative consensus (unanimous rejection — all scores <= 3)
    if (checkNegativeConsensus(currentBlocks)) {
      console.log(chalk.bold.red("\n  A rare sight — the knights actually agree on something."));
      console.log(chalk.bold.red("  Unfortunately, they agree that your idea is terrible.\n"));
      console.log(summarizeConsensus(currentBlocks));

      // Collect the rejection reasoning from this round
      const rejectionSummary = allRounds
        .filter((r) => r.round === round)
        .map((r) => `## ${r.knight}\n\n${r.response}`)
        .join("\n\n---\n\n");

      await writeDecisions(sessionPath, topic, rejectionSummary, allRounds);
      await updateStatus(sessionPath, {
        phase: "consensus_reached",
        consensus_reached: true,
        round,
      });

      // Update chronicle with rejection
      await appendToChronicle(projectRoot, config.chronicle, {
        topic,
        outcome: `Unanimous rejection in ${round} round(s). All knights advise against this.`,
        knights: currentBlocks.map((b) => b.knight),
        date: new Date().toISOString().slice(0, 10),
      });

      return {
        sessionPath,
        consensus: true,
        unanimousRejection: true,
        rounds: round,
        decision: rejectionSummary,
        blocks: currentBlocks,
        allRounds,
        resolvedFiles,
        resolvedCommands,
      };
    }

    // Escalation warning
    if (round >= config.rules.escalate_to_user_after && round < endRound) {
      console.log(
        chalk.yellow(
          `\n  Round ${round}: Still no consensus. ${endRound - round} round(s) left before escalation.`
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
    round: endRound,
  });

  return {
    sessionPath,
    consensus: false,
    rounds: endRound,
    decision: null,
    blocks: Array.from(latestBlocks.values()),
    allRounds,
    resolvedFiles,
    resolvedCommands,
  };
}

