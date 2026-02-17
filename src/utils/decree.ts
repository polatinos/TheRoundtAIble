import { createInterface } from "node:readline/promises";
import chalk from "chalk";

const rl = () =>
  createInterface({ input: process.stdin, output: process.stdout });

export interface DecreeLabels {
  title: string;
  option1Label: string;
  option1Desc: string;
  option2Label: string;
  option2Desc: string;
  option3Label: string;
  option3Desc: string;
  prompt: string;
}

const DEFAULT_DECREE_LABELS: DecreeLabels = {
  title: "What is your decree, Your Majesty?",
  option1Label: "Let the knights forge it",
  option1Desc: "they write the code",
  option2Label: "I'll wield the sword myself",
  option2Desc: "just show me the plan",
  option3Label: "Adjourn the court",
  option3Desc: "decide later with `roundtable apply`",
  prompt: "Your Majesty? [1/2/3] ",
};

const CODE_RED_DECREE_LABELS: DecreeLabels = {
  title: "What is your order, Commander?",
  option1Label: "Fix now",
  option1Desc: "the doctors operate immediately",
  option2Label: "Report only",
  option2Desc: "write the diagnosis, I'll handle the surgery",
  option3Label: "Log for later",
  option3Desc: "park it in the error log",
  prompt: "Commander? [1/2/3] ",
};

/**
 * Ask the King/Commander what to do with the decision.
 * Returns: "knights" | "self" | "later"
 */
export async function askKingsDecree(
  mode: "discussion" | "diagnosis" = "discussion"
): Promise<"knights" | "self" | "later"> {
  const labels = mode === "diagnosis" ? CODE_RED_DECREE_LABELS : DEFAULT_DECREE_LABELS;

  console.log(chalk.bold(`\n  ${labels.title}\n`));
  console.log(`  ${chalk.bold("1.")} ${chalk.cyan(labels.option1Label)} — ${labels.option1Desc}`);
  console.log(`  ${chalk.bold("2.")} ${chalk.green(labels.option2Label)} — ${labels.option2Desc}`);
  console.log(`  ${chalk.bold("3.")} ${chalk.dim(labels.option3Label)} — ${labels.option3Desc}\n`);

  const r = rl();
  const answer = await r.question(chalk.bold.yellow(`  ${labels.prompt}`));
  r.close();

  const choice = answer.trim();
  if (choice === "2") return "self";
  if (choice === "3") return "later";
  return "knights";
}

export interface ParleyLabels {
  title: string;
  parleyLabel: string;
  parleyDesc: string;
  noParleyLabel: string;
  noParleyDesc: string;
  prompt: string;
  parleyMsg: string;
  noParleyMsg: string;
}

const DEFAULT_PARLEY_LABELS: ParleyLabels = {
  title: "How shall the code be written?",
  parleyLabel: "Parley",
  parleyDesc: "review each file before writing",
  noParleyLabel: "No Parley",
  noParleyDesc: "write everything, no questions asked",
  prompt: "Your call, Your Majesty? [1/2] ",
  parleyMsg: "Parley mode. Wise choice.",
  noParleyMsg: "No Parley it is. Bold move.",
};

const CODE_RED_PARLEY_LABELS: ParleyLabels = {
  title: "How shall the surgery proceed?",
  parleyLabel: "Careful incision",
  parleyDesc: "review each file before writing",
  noParleyLabel: "Emergency surgery",
  noParleyDesc: "write everything, no anesthesia",
  prompt: "Commander? [1/2] ",
  parleyMsg: "Careful incision. The patient will survive.",
  noParleyMsg: "Emergency surgery. No time to waste.",
};

/**
 * Ask the user whether to use parley (review each file) or no parley (write all).
 * Returns true for noparley mode.
 */
export async function askParleyMode(
  mode: "discussion" | "diagnosis" = "discussion"
): Promise<boolean> {
  const labels = mode === "diagnosis" ? CODE_RED_PARLEY_LABELS : DEFAULT_PARLEY_LABELS;

  console.log(chalk.bold(`\n  ${labels.title}\n`));
  console.log(`  ${chalk.bold("1.")} ${chalk.green(labels.parleyLabel)} — ${labels.parleyDesc}`);
  console.log(`  ${chalk.bold("2.")} ${chalk.red(labels.noParleyLabel)} — ${labels.noParleyDesc}\n`);

  const r = rl();
  const answer = await r.question(chalk.bold.yellow(`  ${labels.prompt}`));
  r.close();

  const choice = answer.trim();
  if (choice === "2") {
    console.log(chalk.red(`\n  ${labels.noParleyMsg}\n`));
    return true;
  }

  console.log(chalk.green(`\n  ${labels.parleyMsg}\n`));
  return false;
}
