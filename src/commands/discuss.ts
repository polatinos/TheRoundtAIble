import chalk from "chalk";
import { loadConfig, ConfigError } from "../utils/config.js";
import { initializeAdapters } from "../utils/adapters.js";
import { runDiscussion } from "../orchestrator.js";

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
    console.log(chalk.bold.green("  Against all odds... they actually agree."));
    console.log(chalk.dim(`  Rounds: ${result.rounds}`));
    console.log(chalk.dim(`  Session: ${result.sessionPath}`));
    console.log(
      chalk.dim('  Run "roundtable apply" to execute the decision.')
    );
  } else {
    console.log(chalk.bold.yellow("  The knights have agreed to disagree. Your move."));
    console.log(chalk.dim(`  Rounds: ${result.rounds}`));
    console.log(chalk.dim(`  Session: ${result.sessionPath}`));
    console.log(
      chalk.dim("  Review the discussion in the session folder.")
    );
  }

  console.log(chalk.bold("=".repeat(50) + "\n"));
}
