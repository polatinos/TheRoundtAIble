import { createInterface } from "node:readline/promises";
import chalk from "chalk";

const rl = () =>
  createInterface({ input: process.stdin, output: process.stdout });

/**
 * Ask the King what to do with the decision.
 * Returns: "self" | "later"
 */
export async function askKingsDecree(): Promise<"self" | "later"> {
  console.log(chalk.bold("\n  What is your decree, Your Majesty?\n"));
  console.log(`  ${chalk.bold("1.")} ${chalk.green("I'll wield the sword myself")} — use the advice to implement`);
  console.log(`  ${chalk.bold("2.")} ${chalk.dim("Adjourn the court")} — decide later\n`);

  const r = rl();
  const answer = await r.question(chalk.bold.yellow("  Your Majesty? [1/2] "));
  r.close();

  const choice = answer.trim();
  if (choice === "2") return "later";
  return "self";
}
