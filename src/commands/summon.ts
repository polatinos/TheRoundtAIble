import chalk from "chalk";
import { loadConfig, ConfigError } from "../utils/config.js";
import { getGitDiff, getGitBranch, getRecentCommits } from "../utils/git.js";
import { discussCommand } from "./discuss.js";

/**
 * The `roundtable summon` command.
 * Reads the current git diff and starts a discussion based on it.
 */
export async function summonCommand(): Promise<void> {
  const projectRoot = process.cwd();

  // Validate config exists
  try {
    await loadConfig(projectRoot);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.log(chalk.red(error.message));
      process.exit(1);
    }
    throw error;
  }

  console.log(chalk.dim("\n  Analyzing git changes...\n"));

  // Get git context
  const [diff, branch, commits] = await Promise.all([
    getGitDiff(),
    getGitBranch(),
    getRecentCommits(3),
  ]);

  if (!diff) {
    console.log(chalk.yellow("  No git changes detected (no staged or unstaged diff)."));
    console.log(chalk.dim("  Make some changes first, then run `roundtable summon` again.\n"));
    return;
  }

  // Count changed files from diff
  const fileChanges = diff.match(/^diff --git/gm);
  const fileCount = fileChanges?.length || 0;

  console.log(chalk.dim(`  Branch: ${branch || "unknown"}`));
  console.log(chalk.dim(`  Changed files: ${fileCount}`));
  if (commits) {
    console.log(chalk.dim(`  Recent commits:`));
    for (const line of commits.split("\n").slice(0, 3)) {
      console.log(chalk.dim(`    ${line}`));
    }
  }

  // Build a review topic from the diff
  const diffPreview = diff.slice(0, 500).replace(/\n/g, " ").trim();
  const topic = `Review de huidige wijzigingen op branch "${branch || "unknown"}". ${fileCount} bestand(en) gewijzigd. Diff preview: ${diffPreview}`;

  console.log(chalk.bold(`\n  Starting review discussion...\n`));

  // Delegate to discuss command
  await discussCommand(topic);
}
