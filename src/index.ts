#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import { initCommand } from "./commands/init.js";
import { discussCommand } from "./commands/discuss.js";
import { applyCommand } from "./commands/apply.js";
import { summonCommand } from "./commands/summon.js";
import { listCommand } from "./commands/list.js";
import { statusCommand } from "./commands/status.js";
import { chronicleCommand } from "./commands/chronicle.js";
import { codeRedCommand } from "./commands/code-red.js";

const program = new Command();

program
  .name("roundtable")
  .description(
    "TheRoundtAIble — Where no AI is King, but all serve the Code."
  )
  .version("0.1.0");

program
  .command("init")
  .description("Initialize TheRoundtAIble in the current project")
  .action(async () => {
    try {
      await initCommand();
    } catch (error) {
      console.error(chalk.red("Well, that didn't go as planned:"), error);
      process.exit(1);
    }
  });

program
  .command("discuss <topic>")
  .description("Start a discussion between knights")
  .action(async (topic: string) => {
    try {
      await discussCommand(topic);
    } catch (error) {
      console.error(chalk.red("The debate ended in chaos:"), error);
      process.exit(1);
    }
  });

program
  .command("status")
  .description("Show the status of the latest discussion")
  .action(async () => {
    try {
      await statusCommand();
    } catch (error) {
      console.error(chalk.red("Well, that didn't go as planned:"), error);
      process.exit(1);
    }
  });

program
  .command("apply")
  .description("Apply the consensus decision (Lead Knight executes)")
  .option("--noparley", "Skip file confirmation — write everything directly (dangerous)")
  .action(async (options: { noparley?: boolean }) => {
    try {
      await applyCommand(options.noparley ?? false);
    } catch (error) {
      console.error(chalk.red("The knight dropped their sword:"), error);
      process.exit(1);
    }
  });

program
  .command("summon")
  .description("Start a discussion based on current git diff")
  .action(async () => {
    try {
      await summonCommand();
    } catch (error) {
      console.error(chalk.red("The summoning ritual failed:"), error);
      process.exit(1);
    }
  });

program
  .command("list")
  .description("List all discussion sessions")
  .action(async () => {
    try {
      await listCommand();
    } catch (error) {
      console.error(chalk.red("Well, that didn't go as planned:"), error);
      process.exit(1);
    }
  });

program
  .command("chronicle")
  .description("View the decision log")
  .action(async () => {
    try {
      await chronicleCommand();
    } catch (error) {
      console.error(chalk.red("The chronicles are... unreadable:"), error);
      process.exit(1);
    }
  });

program
  .command("code-red <symptoms>")
  .description("Emergency diagnostic mode — knights become doctors")
  .action(async (symptoms: string) => {
    try {
      await codeRedCommand(symptoms);
    } catch (error) {
      console.error(chalk.red("The patient flatlined:"), error);
      process.exit(1);
    }
  });

program.parse();
