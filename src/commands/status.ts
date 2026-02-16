import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { findLatestSession } from "../utils/session.js";

/**
 * The `roundtable status` command.
 * Shows detailed status of the latest session.
 */
export async function statusCommand(): Promise<void> {
  const projectRoot = process.cwd();
  const session = await findLatestSession(projectRoot);

  if (!session) {
    console.log(chalk.yellow("\n  No sessions found."));
    console.log(chalk.dim('  Run `roundtable discuss "topic"` to start one.\n'));
    return;
  }

  const status = session.status;

  console.log(chalk.bold("\n  Latest Session\n"));
  console.log(`  Name:      ${chalk.cyan(session.name)}`);
  console.log(`  Topic:     ${chalk.white(session.topic || "—")}`);
  console.log(`  Phase:     ${phaseDisplay(status?.phase || "unknown")}`);
  console.log(`  Round:     ${status?.round || 0}`);
  console.log(`  Consensus: ${status?.consensus_reached ? chalk.green("Yes") : chalk.yellow("No")}`);

  if (status?.current_knight) {
    console.log(`  Knight:    ${chalk.cyan(status.current_knight)}`);
  }
  if (status?.started_at) {
    console.log(`  Started:   ${chalk.dim(status.started_at)}`);
  }
  if (status?.updated_at) {
    console.log(`  Updated:   ${chalk.dim(status.updated_at)}`);
  }

  // Show decisions.md preview if available
  const decisionsPath = join(session.path, "decisions.md");
  if (existsSync(decisionsPath)) {
    const content = await readFile(decisionsPath, "utf-8");
    const preview = content.split("\n").slice(0, 10).join("\n");
    console.log(chalk.bold("\n  Decision preview:\n"));
    console.log(chalk.dim(indent(preview)));
    if (content.split("\n").length > 10) {
      console.log(chalk.dim("  ...(see full file)"));
    }
  }

  console.log(chalk.dim(`\n  Path: ${session.path}\n`));
}

function phaseDisplay(phase: string): string {
  switch (phase) {
    case "discussing":
      return chalk.blue("Discussing");
    case "consensus_reached":
      return chalk.green("Consensus Reached");
    case "escalated":
      return chalk.yellow("Escalated to User");
    case "applying":
      return chalk.cyan("Applying...");
    case "completed":
      return chalk.gray("Completed");
    default:
      return chalk.dim(phase);
  }
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}
