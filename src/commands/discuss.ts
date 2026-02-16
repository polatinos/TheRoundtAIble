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

  console.log(chalk.bold(`\nTopic: "${topic}"\n`));
  console.log(chalk.dim("Initializing knights...\n"));

  // Initialize adapters
  const adapters = await initializeAdapters(config);

  if (adapters.size === 0) {
    console.log(
      chalk.red(
        "\nNo adapters available. Make sure at least one AI CLI tool is installed."
      )
    );
    console.log(
      chalk.dim(
        "  Supported: claude (Claude Code), gemini (Gemini CLI)"
      )
    );
    process.exit(1);
  }

  console.log(chalk.dim(`\n${adapters.size} knight(s) ready. Starting discussion...\n`));

  // Run the discussion
  const result = await runDiscussion(topic, config, adapters, projectRoot);

  // Final output
  console.log(chalk.bold("\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550"));

  if (result.consensus) {
    console.log(chalk.bold.green("  CONSENSUS REACHED"));
    console.log(chalk.dim(`  Rounds: ${result.rounds}`));
    console.log(chalk.dim(`  Session: ${result.sessionPath}`));
    console.log(
      chalk.dim('  Run "roundtable apply" to execute the decision.')
    );
  } else {
    console.log(chalk.bold.yellow("  NO CONSENSUS \u2014 ESCALATED TO USER"));
    console.log(chalk.dim(`  Rounds: ${result.rounds}`));
    console.log(chalk.dim(`  Session: ${result.sessionPath}`));
    console.log(
      chalk.dim("  Review the discussion in the session folder.")
    );
  }

  console.log(chalk.bold("\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n"));
}
