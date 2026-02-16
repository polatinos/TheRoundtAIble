import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import ora from "ora";
import { loadConfig, ConfigError } from "../utils/config.js";
import { initializeAdapters } from "../utils/adapters.js";
import { findLatestSession, updateStatus } from "../utils/session.js";
import { selectLeadKnight } from "../orchestrator.js";
import {
  parseCodeBlocks,
  writeFilesDirect,
  writeFilesWithConfirmation,
} from "../utils/file-writer.js";
import type { ConsensusBlock } from "../types.js";

/**
 * The `roundtable apply` command.
 * Reads the latest session's decision and executes it via the Lead Knight.
 * Now actually writes files to disk instead of just printing text.
 *
 * Modes:
 *   --parley (default) — shows each file, asks for confirmation
 *   --noparley — writes everything directly ("dangerous mode")
 */
export async function applyCommand(noparley = false): Promise<void> {
  const projectRoot = process.cwd();

  // Load config
  let config;
  try {
    config = await loadConfig(projectRoot);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.log(chalk.red(`\n  Well, that didn't go as planned: ${error.message}`));
      process.exit(1);
    }
    throw error;
  }

  // Find latest session
  const session = await findLatestSession(projectRoot);
  if (!session) {
    console.log(chalk.red("\n  No sessions found. The knights have nothing to execute."));
    console.log(chalk.dim('  Run `roundtable discuss "topic"` first.\n'));
    process.exit(1);
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
    console.log(chalk.red("\n  No decisions.md found. Consensus without a decision? Impressive."));
    process.exit(1);
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
  console.log(chalk.cyan(`  Lead Knight: ${leadKnight.name}`));

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
    console.log(
      chalk.red(
        `\n  ${leadKnight.name} didn't show up. Adapter "${leadKnight.adapter}" not available.`
      )
    );
    console.log(chalk.dim("  Install the required CLI tool or configure an API key."));
    await updateStatus(session.path, { phase: "consensus_reached" });
    process.exit(1);
  }

  // Build execution prompt with file format instructions
  const executionPrompt = [
    `You are ${leadKnight.name}, the Lead Knight chosen to execute the following decision.`,
    `Your capabilities: ${leadKnight.capabilities.join(", ")}`,
    "",
    "DECISION TO IMPLEMENT:",
    "---",
    decision,
    "---",
    "",
    "IMPORTANT — OUTPUT FORMAT:",
    "For EACH file you create or modify, use this EXACT format:",
    "",
    "FILE: path/to/file.ts",
    "```typescript",
    "// complete file content here",
    "```",
    "",
    "Rules:",
    "- Use FILE: before every code block with the full relative path",
    "- Give the COMPLETE file content, not just snippets or diffs",
    "- Include ALL files needed to implement the decision",
    "- Do not explain — just output the files",
    "- Be precise and thorough",
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
    const files = parseCodeBlocks(result);

    if (files.length === 0) {
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

    console.log(
      chalk.bold(`\n  ${files.length} file(s) forged by ${leadKnight.name}:\n`)
    );

    // Write files based on mode
    let written: number;
    if (noparley) {
      console.log(chalk.red("  No parley mode — writing all files directly.\n"));
      written = await writeFilesDirect(files, projectRoot);
    } else {
      console.log(chalk.dim("  Let's review what the knight proposes:\n"));
      written = await writeFilesWithConfirmation(files, projectRoot);
    }

    // Update status
    if (written > 0) {
      await updateStatus(session.path, { phase: "completed" });
      console.log(
        chalk.bold.green(`\n  ${written} file(s) written. The decision has been executed.`)
      );
      console.log(chalk.dim("  Review the changes before committing.\n"));
    } else {
      console.log(chalk.yellow("\n  No files were written. The decision remains unexecuted."));
      await updateStatus(session.path, { phase: "consensus_reached" });
    }
  } catch (error) {
    spinner.fail(chalk.red(`  ${leadKnight.name} dropped their sword`));
    const errMsg = error instanceof Error ? error.message : String(error);
    console.log(chalk.red(`  Well, that didn't go as planned: ${errMsg}`));
    await updateStatus(session.path, { phase: "consensus_reached" });
    process.exit(1);
  }
}
