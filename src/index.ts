#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import { initCommand } from "./commands/init.js";
import { discussCommand } from "./commands/discuss.js";

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
      console.error(chalk.red("Init failed:"), error);
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
      console.error(chalk.red("Discussion failed:"), error);
      process.exit(1);
    }
  });

program
  .command("status")
  .description("Show the status of the current discussion")
  .action(() => {
    console.log(chalk.yellow("Coming soon — roundtable status"));
  });

program
  .command("apply")
  .description("Apply the consensus decision (Lead Knight executes)")
  .action(() => {
    console.log(chalk.yellow("Coming soon — roundtable apply"));
  });

program
  .command("summon")
  .description("Start a discussion based on current git diff")
  .action(() => {
    console.log(chalk.yellow("Coming soon — roundtable summon"));
  });

program
  .command("chronicle")
  .description("View the decision log")
  .action(() => {
    console.log(chalk.yellow("Coming soon — roundtable chronicle"));
  });

program.parse();
