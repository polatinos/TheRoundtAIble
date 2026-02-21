#!/usr/bin/env node

import { Command } from "commander";
import { createRequire } from "node:module";
import chalk from "chalk";
import { initCommand } from "./commands/init.js";
import { discussCommand } from "./commands/discuss.js";
import { applyCommand } from "./commands/apply.js";
import { summonCommand } from "./commands/summon.js";
import { listCommand } from "./commands/list.js";
import { statusCommand } from "./commands/status.js";
import { chronicleCommand } from "./commands/chronicle.js";
// import { codeRedCommand } from "./commands/code-red.js"; // disabled — code-red deferred to v1.1
import { decreesCommand } from "./commands/decrees.js";
import {
  manifestListCommand,
  manifestAddCommand,
  manifestDeprecateCommand,
  manifestCheckCommand,
} from "./commands/manifest.js";
import { RoundtableError, formatError, getExitCode } from "./utils/errors.js";
import { checkForUpdate } from "./utils/update-check.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

/**
 * Central error handler. ALL process.exit() calls live here and ONLY here.
 * Commands throw errors; this function catches and formats them.
 */
function handleCliError(error: unknown): never {
  if (error instanceof RoundtableError) {
    console.error(chalk.red(formatError(error)));
    process.exit(error.exitCode);
  }

  // Unknown error — dump for debugging
  if (error instanceof Error) {
    console.error(chalk.red(`\n  Unexpected error: ${error.message}`));
    if (process.env.DEBUG) {
      console.error(chalk.dim(error.stack || ""));
    }
  } else {
    console.error(chalk.red(`\n  Unexpected error: ${String(error)}`));
  }

  process.exit(getExitCode(error));
}

const program = new Command();

program
  .name("roundtable")
  .description(
    "TheRoundtAIble — Where no AI is King, but all serve the Code."
  )
  .version(pkg.version);

program
  .command("init")
  .description("Initialize TheRoundtAIble in the current project")
  .action(async () => {
    try {
      await initCommand(pkg.version);
    } catch (error) {
      handleCliError(error);
    }
  });

program
  .command("discuss <topic>")
  .description("Start a discussion between knights")
  .action(async (topic: string) => {
    try {
      await discussCommand(topic);
    } catch (error) {
      handleCliError(error);
    }
  });

program
  .command("status")
  .description("Show the status of the latest discussion")
  .action(async () => {
    try {
      await statusCommand();
    } catch (error) {
      handleCliError(error);
    }
  });

program
  .command("apply")
  .description("Apply the consensus decision (Lead Knight executes)")
  .option("--noparley", "Skip file confirmation — write everything directly (dangerous)")
  .option("--override-scope", "Bypass scope enforcement (requires confirmation and reason)")
  .option("--dry-run", "Run full pipeline without writing files — show what would happen")
  .action(async (options: { noparley?: boolean; overrideScope?: boolean; dryRun?: boolean }) => {
    try {
      await applyCommand(options.noparley ?? false, options.overrideScope ?? false, options.dryRun ?? false);
    } catch (error) {
      handleCliError(error);
    }
  });

program
  .command("summon")
  .description("Start a discussion based on current git diff")
  .action(async () => {
    try {
      await summonCommand();
    } catch (error) {
      handleCliError(error);
    }
  });

program
  .command("list")
  .description("List all discussion sessions")
  .action(async () => {
    try {
      await listCommand();
    } catch (error) {
      handleCliError(error);
    }
  });

program
  .command("chronicle")
  .description("View the decision log")
  .action(async () => {
    try {
      await chronicleCommand();
    } catch (error) {
      handleCliError(error);
    }
  });

program
  .command("decrees")
  .description("View the King's Decree Log (rejected/deferred decisions)")
  .action(async () => {
    try {
      await decreesCommand();
    } catch (error) {
      handleCliError(error);
    }
  });

program
  .command("code-red <symptoms>")
  .description("Emergency diagnostic mode — coming soon")
  .action(async (_symptoms: string) => {
    console.log(chalk.yellow("\n  ⚔️  Code-Red is under construction."));
    console.log(chalk.white("  The knights are sharpening their diagnostic tools — this feature will return in a future update."));
    console.log(chalk.dim("  For now, use: roundtable discuss \"describe the bug here\"\n"));
  });

const manifestCmd = program
  .command("manifest")
  .description("Manage the implementation manifest");

manifestCmd
  .command("list")
  .description("Show all tracked features")
  .action(async () => {
    try {
      await manifestListCommand();
    } catch (error) {
      handleCliError(error);
    }
  });

manifestCmd
  .command("add <feature-id>")
  .description("Manually add a feature to the manifest")
  .option("--files <files...>", "Files included in this feature")
  .action(async (featureId: string, options: { files?: string[] }) => {
    try {
      await manifestAddCommand(featureId, options.files || []);
    } catch (error) {
      handleCliError(error);
    }
  });

manifestCmd
  .command("deprecate <feature-id>")
  .description("Mark a feature as deprecated")
  .option("--replaced-by <id>", "ID of the replacement feature")
  .action(async (featureId: string, options: { replacedBy?: string }) => {
    try {
      await manifestDeprecateCommand(featureId, options.replacedBy);
    } catch (error) {
      handleCliError(error);
    }
  });

manifestCmd
  .command("check")
  .description("Check manifest for stale entries")
  .action(async () => {
    try {
      await manifestCheckCommand();
    } catch (error) {
      handleCliError(error);
    }
  });

// Fire-and-forget: check for updates without blocking CLI startup
checkForUpdate(pkg.version);

program.parse();
