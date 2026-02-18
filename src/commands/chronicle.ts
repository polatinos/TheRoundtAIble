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
    } else {
      throw error;
    }
  }

  const content = await readChronicle(projectRoot, chroniclePath);

  if (!content || content.trim().length === 0) {
    console.log(chalk.yellow("\n  The chronicle is blank. No decisions recorded yet."));
    console.log(chalk.dim("  Win some debates first, then come back.\n"));
    return;
  }

  // Count decisions (## entries after the header)
  const decisionCount = (content.match(/^## \d{4}/gm) || []).length;

  console.log(chalk.bold(`\n  The Chronicle — ${decisionCount} decision(s) etched in stone\n`));
  console.log(chalk.dim("  " + "=".repeat(56)));
  console.log("");

  // Print the chronicle content with some formatting
  const lines = content.split("\n");
  for (const line of lines) {
    if (line.startsWith("# ")) {
      // Main header
      console.log(chalk.bold.cyan(`  ${line}`));
    } else if (line.startsWith("## ")) {
      // Decision header
      console.log(chalk.bold.white(`\n  ${line}`));
    } else if (line.startsWith("**")) {
      console.log(chalk.white(`  ${line}`));
    } else if (line.startsWith("---")) {
      console.log(chalk.dim(`  ${"~".repeat(40)}`));
    } else {
      console.log(chalk.dim(`  ${line}`));
    }
  }

  console.log("");
}
