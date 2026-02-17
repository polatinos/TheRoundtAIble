import { createInterface } from "node:readline/promises";
import chalk from "chalk";
import { loadConfig, ConfigError } from "../utils/config.js";
import { initializeAdapters } from "../utils/adapters.js";
import { runDiagnosis } from "../orchestrator.js";
import { getNextCodeRedId, appendToErrorLog, updateErrorLogEntry } from "../utils/error-log.js";
import { askKingsDecree, askParleyMode } from "../utils/decree.js";
import { applyCommand } from "./apply.js";
import type { DiagnosisResult } from "../types.js";

const rl = () =>
  createInterface({ input: process.stdin, output: process.stdout });

/**
 * Show the CODE RED banner.
 */
function showBanner(): void {
  const border = chalk.red("=".repeat(50));
  console.log("");
  console.log(border);
  console.log(chalk.red.bold("  CODE RED — EMERGENCY DIAGNOSTIC MODE"));
  console.log(chalk.red("  The knights are now doctors. The code is the patient."));
  console.log(border);
  console.log("");
}

/**
 * Ask if the doctors should read the codebase first.
 */
async function askReadCodebase(): Promise<boolean> {
  console.log(chalk.bold("  Shall the doctors read the codebase first?\n"));
  console.log(`  ${chalk.bold("Y.")} ${chalk.cyan("Yes")} — full codebase scan (more tokens, better diagnosis)`);
  console.log(`  ${chalk.bold("N.")} ${chalk.dim("No")} — symptoms only (faster, cheaper)\n`);

  const r = rl();
  const answer = await r.question(chalk.bold.yellow("  Read codebase? [Y/N] "));
  r.close();

  const choice = answer.trim().toLowerCase();
  if (choice === "y" || choice === "yes") {
    console.log(chalk.cyan("\n  Full body scan initiated.\n"));
    return true;
  }

  console.log(chalk.dim("\n  Symptoms only. The doctors will ask for files as needed.\n"));
  return false;
}

/**
 * The `roundtable code-red` command.
 */
export async function codeRedCommand(symptoms: string): Promise<void> {
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

  showBanner();
  console.log(chalk.bold(`  Symptoms: "${symptoms}"\n`));

  // Initialize adapters
  const adapters = await initializeAdapters(config);

  if (adapters.size === 0) {
    console.log(chalk.red("\n  No doctors available. Install at least one AI CLI tool."));
    process.exit(1);
  }

  const doctorNames = Array.from(adapters.keys())
    .map((a) => config.knights.find((k) => k.adapter === a)?.name || a);
  console.log(
    chalk.dim(`  Doctors on call: ${doctorNames.map((n) => `Dr. ${n}`).join(", ")}\n`)
  );

  // Ask about codebase reading
  const readCodebase = await askReadCodebase();

  // Get Code Red ID
  const codeRedId = await getNextCodeRedId(projectRoot);
  console.log(chalk.red.bold(`  ${codeRedId} — Diagnosis in progress...\n`));

  // Run diagnosis
  const result = await runDiagnosis(symptoms, config, adapters, projectRoot, readCodebase);
  result.codeRedId = codeRedId;

  // Final output
  console.log(chalk.red.bold("\n" + "=".repeat(50)));

  if (result.converged) {
    await handleConverged(result, symptoms, projectRoot);
  } else {
    await handleInconclusive(result, symptoms, projectRoot);
  }

  console.log(chalk.red.bold("=".repeat(50) + "\n"));
}

/**
 * Diagnosis converged — ask what to do.
 */
async function handleConverged(
  result: DiagnosisResult,
  symptoms: string,
  projectRoot: string
): Promise<void> {
  console.log(chalk.bold.green("  DIAGNOSIS CONVERGED."));
  console.log(chalk.dim(`  Code Red ID: ${result.codeRedId}`));
  console.log(chalk.dim(`  Root cause:  ${result.rootCauseKey}`));
  console.log(chalk.dim(`  Rounds:      ${result.rounds}`));
  console.log(chalk.dim(`  Session:     ${result.sessionPath}`));

  const decree = await askKingsDecree("diagnosis");

  if (decree === "knights") {
    // Log to error log as OPEN, then fix
    await appendToErrorLog(projectRoot, {
      id: result.codeRedId,
      symptoms,
      rootCause: result.rootCauseKey,
      triedAndFailed: [],
      status: "OPEN",
      date: new Date().toISOString().slice(0, 10),
    });

    const noparley = await askParleyMode("diagnosis");
    await applyCommand(noparley);

    // Update error log to RESOLVED
    await updateErrorLogEntry(projectRoot, result.codeRedId, { status: "RESOLVED" });
    console.log(chalk.green(`\n  ${result.codeRedId} marked as RESOLVED in the error log.`));
  } else if (decree === "self") {
    // Log and let the user handle it
    await appendToErrorLog(projectRoot, {
      id: result.codeRedId,
      symptoms,
      rootCause: result.rootCauseKey,
      triedAndFailed: [],
      status: "OPEN",
      date: new Date().toISOString().slice(0, 10),
    });

    console.log(chalk.bold("\n  Diagnosis recorded. The surgery is yours, Commander."));
    console.log(chalk.dim(`  Read the diagnosis: ${result.sessionPath}/decisions.md`));
    console.log(chalk.dim(`  Error log updated: .roundtable/error-log.md\n`));
  } else {
    // Log for later
    await appendToErrorLog(projectRoot, {
      id: result.codeRedId,
      symptoms,
      rootCause: result.rootCauseKey,
      triedAndFailed: [],
      status: "PARKED",
      date: new Date().toISOString().slice(0, 10),
    });

    console.log(chalk.dim(`\n  ${result.codeRedId} parked in the error log. Fix it when you're ready.\n`));
  }
}

/**
 * Diagnosis inconclusive — log and show suspects.
 */
async function handleInconclusive(
  result: DiagnosisResult,
  symptoms: string,
  projectRoot: string
): Promise<void> {
  console.log(chalk.bold.yellow("  DIAGNOSIS INCONCLUSIVE."));
  console.log(chalk.dim(`  Code Red ID: ${result.codeRedId}`));
  console.log(chalk.dim(`  Rounds:      ${result.rounds}`));
  console.log(chalk.dim(`  Session:     ${result.sessionPath}`));

  if (result.rootCauseKey) {
    console.log(chalk.yellow(`  Best suspect: ${result.rootCauseKey}`));
  }

  // Log as PARKED
  await appendToErrorLog(projectRoot, {
    id: result.codeRedId,
    symptoms,
    rootCause: result.rootCauseKey,
    triedAndFailed: [],
    status: "PARKED",
    date: new Date().toISOString().slice(0, 10),
  });

  console.log(chalk.dim(`\n  ${result.codeRedId} logged in the error log for future investigation.`));
  console.log(chalk.dim(`  Check: .roundtable/error-log.md\n`));
}
