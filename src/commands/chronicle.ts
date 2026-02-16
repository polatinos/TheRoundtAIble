import chalk from "chalk";
import { readChronicle } from "../utils/chronicle.js";
import { loadConfig, ConfigError } from "../utils/config.js";

/**
 * The `roundtable chronicle` command.
 * Displays the chronicle (decision log) for the current project.
 */
export async function chronicleCommand(): Promise<void> {
  const projectRoot = process.cwd();

  // Load config to get chronicle path
  let chroniclePath = ".roundtable/chronicle.md";
  try {
    const config = await loadConfig(projectRoot);
    chroniclePath = config.chronicle;
  } catch (error) {
    // If config doesn't exist, still try default path
    if (error instanceof ConfigError && error.message.includes("not found")) {
      // Use default path
    } else if (error instanceof ConfigError) {
      console.log(chalk.red(error.message));
      process.exit(1);
    }
  }

  const content = await readChronicle(projectRoot, chroniclePath);

  if (!content || content.trim().length === 0) {
    console.log(chalk.yellow("\n  Chronicle is empty."));
    console.log(chalk.dim("  Decisions will appear here after discussions reach consensus.\n"));
    return;
  }

  // Count decisions (## entries after the header)
  const decisionCount = (content.match(/^## \d{4}/gm) || []).length;

  console.log(chalk.bold(`\n  Chronicle — ${decisionCount} decision(s)\n`));
  console.log(chalk.dim("─".repeat(60)));
  console.log("");

  // Print the chronicle content with some formatting
  const lines = content.split("\n");
  for (const line of lines) {
    if (line.startsWith("# ")) {
      // Main header
      console.log(chalk.bold.cyan(`  ${line}`));
    } else if (line.startsWith("## ")) {
      // Decision header
      console.log(chalk.bold.white(`  ${line}`));
    } else if (line.startsWith("**")) {
      console.log(chalk.white(`  ${line}`));
    } else if (line.startsWith("---")) {
      console.log(chalk.dim(`  ${"─".repeat(40)}`));
    } else {
      console.log(chalk.dim(`  ${line}`));
    }
  }

  console.log("");
}
