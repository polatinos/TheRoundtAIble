import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import chalk from "chalk";
import ora from "ora";
import { loadConfig, ConfigError } from "../utils/config.js";
import { initializeAdapters, createAdapter } from "../utils/adapters.js";
import { findLatestSession, readStatus, updateStatus } from "../utils/session.js";
import { selectLeadKnight } from "../orchestrator.js";
import type { ConsensusBlock } from "../types.js";

/**
 * The `roundtable apply` command.
 * Reads the latest session's decision and executes it via the Lead Knight.
 */
export async function applyCommand(): Promise<void> {
  const projectRoot = process.cwd();

  // Load config
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

  // Find latest session
  const session = await findLatestSession(projectRoot);
  if (!session) {
    console.log(chalk.red("No sessions found. Run a discussion first."));
    process.exit(1);
  }

  // Check status
  const status = session.status;
  if (!status?.consensus_reached) {
    console.log(chalk.yellow("Latest session has no consensus. Nothing to apply."));
    console.log(chalk.dim(`  Session: ${session.name}`));
    console.log(chalk.dim(`  Phase: ${status?.phase || "unknown"}`));
    return;
  }

  if (status.phase === "completed") {
    console.log(chalk.yellow("Decision already applied."));
    console.log(chalk.dim(`  Session: ${session.name}`));
    return;
  }

  // Read decisions.md
  const decisionsPath = join(session.path, "decisions.md");
  if (!existsSync(decisionsPath)) {
    console.log(chalk.red("No decisions.md found in latest session."));
    process.exit(1);
  }

  const decision = await readFile(decisionsPath, "utf-8");

  // Read discussion to get consensus blocks for Lead Knight selection
  const discussionPath = join(session.path, "discussion.md");
  let blocks: ConsensusBlock[] = [];
  if (existsSync(discussionPath)) {
    const discussion = await readFile(discussionPath, "utf-8");
    // Extract consensus scores from discussion to determine lead knight
    const scoreMatches = discussion.matchAll(/## Round (\d+) — (\w+)[\s\S]*?Score: (\d+)\/10/g);
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
  console.log(chalk.bold("\n  Decision to apply:\n"));
  console.log(chalk.dim(`  Session: ${session.name}`));
  console.log(chalk.dim(`  Topic: ${session.topic || "unknown"}`));
  console.log(chalk.cyan(`  Lead Knight: ${leadKnight.name}\n`));

  // Show a preview of the decision (first few lines)
  const preview = decision.split("\n").slice(0, 15).join("\n");
  console.log(chalk.dim(preview));
  if (decision.split("\n").length > 15) {
    console.log(chalk.dim("  ...(truncated)"));
  }

  // Ask for confirmation
  console.log("");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    chalk.bold.yellow("  Apply this decision? [y/N] ")
  );
  rl.close();

  const confirmed = answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
  if (!confirmed) {
    console.log(chalk.dim("  Aborted."));
    return;
  }

  // Update status to applying
  await updateStatus(session.path, { phase: "applying" });

  // Initialize adapters and find the lead knight's adapter
  console.log(chalk.dim("\n  Initializing Lead Knight...\n"));
  const adapters = await initializeAdapters(config);

  const adapter = adapters.get(leadKnight.adapter);
  if (!adapter) {
    console.log(chalk.red(`  Lead Knight "${leadKnight.name}" adapter not available.`));
    console.log(chalk.dim("  Try installing the required CLI tool or configuring an API key."));
    await updateStatus(session.path, { phase: "consensus_reached" });
    process.exit(1);
  }

  // Build execution prompt
  const executionPrompt = [
    `You are ${leadKnight.name}, the Lead Knight chosen to execute the following decision.`,
    `Your capabilities: ${leadKnight.capabilities.join(", ")}`,
    "",
    "DECISION TO IMPLEMENT:",
    "---",
    decision,
    "---",
    "",
    "Execute this decision. Write the code changes, create files, or perform the actions described.",
    "Be precise and complete. Follow the decision exactly as agreed.",
  ].join("\n");

  // Execute
  const spinner = ora(chalk.cyan(`  ${leadKnight.name} is executing...`)).start();

  try {
    const timeoutMs = config.rules.timeout_per_turn_seconds * 1000 * 2; // Double timeout for execution
    const result = await adapter.execute(executionPrompt, timeoutMs);
    spinner.succeed(`  ${leadKnight.name} completed execution`);

    console.log(chalk.bold("\n  Execution result:\n"));
    const indented = result
      .split("\n")
      .map((line) => `  ${line}`)
      .join("\n");
    console.log(indented);

    // Update status to completed
    await updateStatus(session.path, { phase: "completed" });

    console.log(chalk.bold.green("\n  Decision applied successfully!"));
    console.log(chalk.dim("  Review the changes before committing.\n"));
  } catch (error) {
    spinner.fail(`  ${leadKnight.name} execution failed`);
    const errMsg = error instanceof Error ? error.message : String(error);
    console.log(chalk.red(`  Error: ${errMsg}`));
    await updateStatus(session.path, { phase: "consensus_reached" }); // Reset so user can retry
    process.exit(1);
  }
}
