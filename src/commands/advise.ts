import chalk from "chalk";
import { loadConfig, ConfigError } from "../utils/config.js";
import { initializeAdapters } from "../utils/adapters.js";
import { runAdvise, AdviseOptions } from "../advise/orchestrator.js";

export interface AdviseCliOptions {
  proposer?: string;
  critic?: string;
  synth?: string;
  source?: boolean;
}

/**
 * The `roundtable advise` command.
 *
 * Runs the proposer/critic/synthesizer pipeline introduced in v0.6.
 * One concrete recommendation, one concrete counter-argument, one
 * synthesis. No rounds. No scores. Output is a structured decision
 * record at .roundtable/sessions/<id>/decision.md.
 */
export async function adviseCommand(
  topic: string,
  cliOptions: AdviseCliOptions = {}
): Promise<void> {
  const projectRoot = process.cwd();
  const config = await loadConfig(projectRoot);

  console.log(chalk.bold(`\n  Topic: "${topic}"\n`));
  console.log(chalk.dim("  Calling the advisory panel...\n"));

  const adapters = await initializeAdapters(config);

  if (adapters.size < 2) {
    throw new ConfigError(
      "advise needs at least 2 working knights.",
      { hint: "Configure additional knights in .roundtable/config.json or check that their CLI tools are installed." }
    );
  }

  const options: AdviseOptions = {
    proposerName: cliOptions.proposer,
    criticName: cliOptions.critic,
    synthesizerName: cliOptions.synth,
    readSourceCode: cliOptions.source ?? false,
  };

  const result = await runAdvise(topic, config, adapters, projectRoot, options);

  console.log(chalk.bold("\n" + "=".repeat(50)));
  console.log(chalk.bold.green("  Decision recorded."));
  console.log(chalk.dim(`  Confidence: ${result.record.synth.parsed.confidence}`));
  console.log(chalk.dim(`  Disagreement health: ${result.record.synth.parsed.disagreement_health}`));
  if (result.record.synth.parsed.disagreement_health === "suspicious-agreement") {
    console.log(chalk.yellow(
      "  ⚠ Knights agreed too easily — possible shared blindspot. Read the decision before acting on it."
    ));
  }
  console.log(chalk.dim(`\n  Read it: ${result.decisionPath}`));
  console.log(chalk.bold("=".repeat(50) + "\n"));
}
