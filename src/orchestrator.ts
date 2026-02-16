import chalk from "chalk";
import ora from "ora";
import type {
  RoundtableConfig,
  KnightConfig,
  RoundEntry,
  ConsensusBlock,
  SessionResult,
} from "./types.js";
import { BaseAdapter, classifyError, AdapterError } from "./adapters/base.js";
import { checkConsensus, summarizeConsensus } from "./consensus.js";
import { buildSystemPrompt } from "./utils/prompt.js";
import { buildContext } from "./utils/context.js";
import {
  createSession,
  writeDiscussion,
  writeDecisions,
  updateStatus,
} from "./utils/session.js";
import { appendToChronicle } from "./utils/chronicle.js";

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
  projectRoot: string
): Promise<SessionResult> {
  const { max_rounds, consensus_threshold } = config.rules;

  // Build project context
  const contextSpinner = ora("  Gathering intel from the codebase...").start();
  const context = await buildContext(projectRoot, config);
  contextSpinner.succeed("  Context assembled");

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
        allRounds
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
        const displayResponse = response
          .replace(/```json[\s\S]*?```/g, "")
          .replace(/\{[^{}]*"consensus_score"[^{}]*\}/g, "")
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
  };
}
