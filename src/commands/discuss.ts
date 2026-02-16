import { createInterface } from "node:readline/promises";
import chalk from "chalk";
import { loadConfig, ConfigError } from "../utils/config.js";
import { initializeAdapters } from "../utils/adapters.js";
import { runDiscussion } from "../orchestrator.js";
import { writeDecisions, updateStatus } from "../utils/session.js";
import { applyCommand } from "./apply.js";
import type { SessionResult, RoundEntry } from "../types.js";

const rl = () =>
  createInterface({ input: process.stdin, output: process.stdout });

/**
 * The `roundtable discuss` command.
 */
export async function discussCommand(topic: string): Promise<void> {
  const projectRoot = process.cwd();

  // Load and validate config
  let config;
  try {
    config = await loadConfig(projectRoot);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.log(chalk.red(error.message));
      process.exit(1);
    }
    throw error;
  }

  console.log(chalk.bold(`\n  Topic: "${topic}"\n`));
  console.log(chalk.dim("  Summoning the knights to the table...\n"));

  // Initialize adapters
  const adapters = await initializeAdapters(config);

  if (adapters.size === 0) {
    console.log(
      chalk.red(
        "\n  A roundtable with no knights is just a table."
      )
    );
    console.log(
      chalk.dim(
        "  Install at least one AI CLI tool: claude, gemini, or codex"
      )
    );
    process.exit(1);
  }

  const knightNames = Array.from(adapters.keys())
    .map((a) => config.knights.find((k) => k.adapter === a)?.name || a);
  console.log(
    chalk.dim(`  ${knightNames.join(", ")} ${knightNames.length === 1 ? "takes" : "take"} their seat${knightNames.length === 1 ? "" : "s"}.\n`)
  );

  // Run the discussion
  const result = await runDiscussion(topic, config, adapters, projectRoot);

  // Final output
  console.log(chalk.bold("\n" + "=".repeat(50)));

  if (result.consensus) {
    await handleConsensus(result);
  } else {
    await handleNoConsensus(result, topic);
  }

  console.log(chalk.bold("=".repeat(50) + "\n"));
}

/**
 * Consensus reached — ask the King if they want to apply now.
 */
async function handleConsensus(result: SessionResult): Promise<void> {
  console.log(chalk.bold.green("  A miracle has occurred. The knights actually agree."));
  console.log(chalk.dim(`  Rounds: ${result.rounds}`));
  console.log(chalk.dim(`  Session: ${result.sessionPath}`));

  console.log("");
  const r = rl();
  const answer = await r.question(
    chalk.bold.yellow("  Shall we forge this into code, Your Majesty? [Y/n] ")
  );
  r.close();

  const confirmed =
    answer.trim() === "" ||
    answer.trim().toLowerCase() === "y" ||
    answer.trim().toLowerCase() === "yes" ||
    answer.trim().toLowerCase() === "ja";

  if (confirmed) {
    console.log(chalk.dim("\n  The King has spoken. Executing...\n"));
    await applyCommand(false);
  } else {
    console.log(chalk.dim('  The decision awaits. Run `roundtable apply` when ready.'));
  }
}

/**
 * No consensus — let the King choose a knight's proposal or send them back.
 */
async function handleNoConsensus(
  result: SessionResult,
  topic: string
): Promise<void> {
  console.log(chalk.bold.yellow("  The knights have agreed to disagree. As usual."));
  console.log(chalk.dim(`  Rounds: ${result.rounds}`));
  console.log(chalk.dim(`  Session: ${result.sessionPath}`));

  // Get the last response from each knight
  const knightProposals = getLastProposals(result.allRounds);

  if (knightProposals.length === 0) {
    console.log(chalk.dim("\n  No proposals to choose from. The knights were useless today."));
    return;
  }

  // Show each knight's position
  console.log(chalk.bold("\n  But YOU are the King. The final word is yours.\n"));

  for (let i = 0; i < knightProposals.length; i++) {
    const { knight, score, summary } = knightProposals[i];

    const knightColors: Record<string, (text: string) => string> = {
      Claude: chalk.hex("#D97706"),
      Gemini: chalk.hex("#3B82F6"),
      GPT: chalk.hex("#10B981"),
    };
    const color = knightColors[knight] || chalk.white;
    const scoreColor = score >= 9 ? chalk.green : score >= 6 ? chalk.yellow : chalk.red;

    console.log(
      `  ${chalk.bold(`${i + 1}.`)} ${color(knight)} ${scoreColor(`(${score}/10)`)} — ${chalk.dim(summary)}`
    );
  }

  console.log(
    `  ${chalk.bold(`${knightProposals.length + 1}.`)} ${chalk.dim("Send them back — they must reach unanimity!")}`
  );

  // Ask the King
  console.log("");
  const r = rl();
  const answer = await r.question(
    chalk.bold.yellow(`  What say you, Your Majesty? [1-${knightProposals.length + 1}] `)
  );
  r.close();

  const choice = parseInt(answer.trim());

  if (isNaN(choice) || choice < 1 || choice > knightProposals.length + 1) {
    console.log(chalk.dim("  The King waves dismissively. Perhaps another time."));
    return;
  }

  if (choice === knightProposals.length + 1) {
    console.log(chalk.dim("  Back to the table! The King demands unanimity."));
    console.log(chalk.dim('  Run `roundtable discuss` again when the knights have cooled down.'));
    return;
  }

  // King chose a knight
  const chosen = knightProposals[choice - 1];
  const knightColors: Record<string, (text: string) => string> = {
    Claude: chalk.hex("#D97706"),
    Gemini: chalk.hex("#3B82F6"),
    GPT: chalk.hex("#10B981"),
  };
  const color = knightColors[chosen.knight] || chalk.white;

  console.log(
    chalk.bold(`\n  The King has chosen ${color(chosen.knight)}'s plan. So it shall be.`)
  );

  // Write decisions.md with the chosen knight's full response
  await writeDecisions(result.sessionPath, topic, chosen.fullResponse, result.allRounds);
  await updateStatus(result.sessionPath, {
    phase: "consensus_reached",
    consensus_reached: true,
  });

  // Apply immediately
  console.log(chalk.dim("  Executing the King's decree...\n"));
  await applyCommand(false);
}

interface KnightProposal {
  knight: string;
  score: number;
  summary: string;
  fullResponse: string;
}

/**
 * Get the last response from each knight with a brief summary.
 */
function getLastProposals(allRounds: RoundEntry[]): KnightProposal[] {
  const lastByKnight = new Map<string, RoundEntry>();

  // Keep only the last entry per knight
  for (const entry of allRounds) {
    lastByKnight.set(entry.knight, entry);
  }

  return Array.from(lastByKnight.values()).map((entry) => {
    const score = entry.consensus?.consensus_score ?? 0;

    // Strip JSON blocks for summary
    const cleaned = entry.response
      .replace(/```json[\s\S]*?```/g, "")
      .replace(/\{[^{}]*"consensus_score"[^{}]*\}/g, "")
      .trim();

    // Take first meaningful line as summary
    const lines = cleaned.split("\n").filter((l) => l.trim().length > 10);
    let summary = lines[0]?.trim() || "No summary available";
    if (summary.length > 80) {
      summary = summary.slice(0, 77) + "...";
    }

    return {
      knight: entry.knight,
      score,
      summary,
      fullResponse: entry.response,
    };
  });
}
