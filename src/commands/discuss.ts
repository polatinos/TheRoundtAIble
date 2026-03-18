import { createInterface } from "node:readline/promises";
import chalk from "chalk";
import { loadConfig, ConfigError } from "../utils/config.js";
import { initializeAdapters } from "../utils/adapters.js";
import { runDiscussion } from "../orchestrator.js";
import { writeDecisions, updateStatus } from "../utils/session.js";
import { addDecreeEntry } from "../utils/decree-log.js";
import type { SessionResult, RoundEntry, ContinueOptions } from "../types.js";

const rl = () =>
  createInterface({ input: process.stdin, output: process.stdout });

/**
 * Ask if the knights should read the codebase before discussing.
 */
async function askReadCodebase(): Promise<boolean> {
  console.log(chalk.bold("  Shall the knights read the codebase first?\n"));
  console.log(`  ${chalk.bold("Y.")} ${chalk.cyan("Yes")} — full codebase scan (more context, better proposals)`);
  console.log(`  ${chalk.bold("N.")} ${chalk.dim("No")} — topic only (faster, cheaper)\n`);

  const r = rl();
  const answer = await r.question(chalk.bold.yellow("  Read codebase? [Y/N] "));
  r.close();

  const choice = answer.trim().toLowerCase();
  if (choice === "y" || choice === "yes") {
    console.log(chalk.cyan("\n  The knights will study the codebase before debating.\n"));
    return true;
  }

  console.log(chalk.dim("\n  Topic only. The knights go in blind.\n"));
  return false;
}

/**
 * The `roundtable discuss` command.
 * Loops when the King sends knights back for another attempt.
 */
export async function discussCommand(topic: string): Promise<void> {
  const projectRoot = process.cwd();

  // Load and validate config — errors propagate to index.ts
  const config = await loadConfig(projectRoot);

  console.log(chalk.bold(`\n  Topic: "${topic}"\n`));
  console.log(chalk.dim("  Summoning the knights to the table...\n"));

  // Initialize adapters
  const adapters = await initializeAdapters(config);

  if (adapters.size === 0) {
    throw new ConfigError(
      "A roundtable with no knights is just a table.",
      { hint: "Install at least one AI CLI tool: claude, gemini, or codex" }
    );
  }

  const knightNames = Array.from(adapters.keys())
    .map((a) => config.knights.find((k) => k.adapter === a)?.name || a);
  console.log(
    chalk.dim(`  ${knightNames.join(", ")} ${knightNames.length === 1 ? "takes" : "take"} their seat${knightNames.length === 1 ? "" : "s"}.\n`)
  );

  // Ask if knights should read the codebase
  const readCodebase = await askReadCodebase();

  // Discussion loop — continues when King sends knights back
  let result = await runDiscussion(topic, config, adapters, projectRoot, readCodebase);

  while (true) {
    console.log(chalk.bold("\n" + "=".repeat(50)));

    if (result.consensus) {
      if (result.unanimousRejection) {
        handleRejection(result);
      } else {
        await handleConsensus(result);
      }
      break;
    }

    const action = await handleNoConsensus(result, topic);

    if (action !== "send_back") {
      break;
    }

    // King demands unanimity — continue the discussion in the same session
    console.log(chalk.bold("=".repeat(50)));

    const continueFrom: ContinueOptions = {
      sessionPath: result.sessionPath,
      allRounds: result.allRounds,
      startRound: result.rounds + 1,
      resolvedFiles: result.resolvedFiles || "",
      resolvedCommands: result.resolvedCommands || "",
    };

    result = await runDiscussion(topic, config, adapters, projectRoot, readCodebase, continueFrom);
  }

  console.log(chalk.bold("=".repeat(50) + "\n"));
}

/**
 * Consensus reached — show the King the result.
 */
async function handleConsensus(result: SessionResult): Promise<void> {
  console.log(chalk.bold.green("  A miracle has occurred. The knights actually agree."));
  console.log(chalk.dim(`  Rounds: ${result.rounds}`));
  console.log(chalk.dim(`  Session: ${result.sessionPath}`));
  console.log(chalk.bold("\n  The advice has been recorded."));
  console.log(chalk.dim(`  Read the decision: ${result.sessionPath}/decisions.md\n`));
}

/**
 * Unanimous rejection — all knights agree the idea is bad.
 * No apply needed, just inform the King.
 */
function handleRejection(result: SessionResult): void {
  console.log(chalk.bold.red("  The knights unanimously reject this proposal."));
  console.log(chalk.dim(`  Rounds: ${result.rounds}`));
  console.log(chalk.dim(`  Session: ${result.sessionPath}`));
  console.log(chalk.dim(`\n  Their reasoning has been recorded in decisions.md.`));
  console.log(chalk.dim("  Perhaps a wiser question next time, Your Majesty.\n"));
}

/**
 * No consensus — let the King choose a knight's proposal or send them back.
 * Returns "send_back" if the King wants another round, "done" otherwise.
 */
async function handleNoConsensus(
  result: SessionResult,
  topic: string
): Promise<"send_back" | "done"> {
  const projectRoot = process.cwd();

  console.log(chalk.bold.yellow("  The knights have agreed to disagree. As usual."));
  console.log(chalk.dim(`  Rounds: ${result.rounds}`));
  console.log(chalk.dim(`  Session: ${result.sessionPath}`));

  // Get the last response from each knight
  const knightProposals = getLastProposals(result.allRounds);

  if (knightProposals.length === 0) {
    console.log(chalk.dim("\n  No proposals to choose from. The knights were useless today."));
    return "done";
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
    return "done";
  }

  if (choice === knightProposals.length + 1) {
    // King sends them back — signal the loop to continue
    return "send_back";
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
    chalk.bold(`\n  The King has chosen ${color(chosen.knight)}'s advice. So it shall be.`)
  );

  // Write decisions.md with the chosen knight's full response
  await writeDecisions(result.sessionPath, topic, chosen.fullResponse, result.allRounds);
  await updateStatus(result.sessionPath, {
    phase: "consensus_reached",
    consensus_reached: true,
  });

  console.log(chalk.bold("\n  The advice has been recorded."));
  console.log(chalk.dim(`  Read the decision: ${result.sessionPath}/decisions.md\n`));

  return "done";
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
