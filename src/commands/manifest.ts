import chalk from "chalk";
import { createInterface } from "node:readline/promises";
import {
  readManifest,
  addManifestEntry,
  deprecateFeature,
  checkManifest,
} from "../utils/manifest.js";

/**
 * `roundtable manifest list` — show all features in the manifest.
 */
export async function manifestListCommand(): Promise<void> {
  const projectRoot = process.cwd();
  const manifest = await readManifest(projectRoot);

  if (manifest.features.length === 0) {
    console.log(chalk.dim("\n  The manifest is empty. No features tracked yet."));
    console.log(chalk.dim('  Features are added automatically after `roundtable apply`.\n'));
    return;
  }

  console.log(chalk.bold(`\n  Implementation Manifest (${manifest.features.length} features)\n`));

  for (const f of manifest.features) {
    const statusColor =
      f.status === "implemented" ? chalk.green :
      f.status === "partial" ? chalk.yellow :
      chalk.red;
    const statusIcon =
      f.status === "implemented" ? "+" :
      f.status === "partial" ? "~" :
      "x";

    console.log(`  ${statusColor(`[${statusIcon}]`)} ${chalk.bold(f.id)} — ${chalk.dim(f.summary)}`);
    console.log(chalk.dim(`      Status: ${f.status} | Knight: ${f.lead_knight} | ${f.applied_at.slice(0, 10)}`));
    console.log(chalk.dim(`      Files: ${f.files.join(", ")}`));
    if (f.files_skipped && f.files_skipped.length > 0) {
      console.log(chalk.yellow(`      Skipped: ${f.files_skipped.join(", ")}`));
    }
    if (f.replaced_by) {
      console.log(chalk.dim(`      Replaced by: ${f.replaced_by}`));
    }
    console.log("");
  }
}

/**
 * `roundtable manifest add` — manually add a feature.
 */
export async function manifestAddCommand(
  featureId: string,
  files: string[]
): Promise<void> {
  const projectRoot = process.cwd();

  if (!featureId || files.length === 0) {
    console.log(chalk.red("\n  Usage: roundtable manifest add <feature-id> --files file1.ts file2.ts\n"));
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const summary = await rl.question(chalk.yellow("  Summary: "));
  rl.close();

  await addManifestEntry(projectRoot, {
    id: featureId,
    session: "manual",
    status: "implemented",
    files,
    summary: summary.trim() || featureId,
    applied_at: new Date().toISOString(),
    lead_knight: "manual",
  });

  console.log(chalk.green(`\n  Added "${featureId}" to manifest with ${files.length} file(s).\n`));
}

/**
 * `roundtable manifest deprecate` — mark a feature as deprecated.
 */
export async function manifestDeprecateCommand(
  featureId: string,
  replacedBy?: string
): Promise<void> {
  const projectRoot = process.cwd();

  const success = await deprecateFeature(projectRoot, featureId, replacedBy);

  if (success) {
    console.log(chalk.yellow(`\n  Deprecated "${featureId}".`));
    if (replacedBy) {
      console.log(chalk.dim(`  Replaced by: ${replacedBy}`));
    }
    console.log("");
  } else {
    console.log(chalk.red(`\n  Feature "${featureId}" not found in manifest.\n`));
  }
}

/**
 * `roundtable manifest check` — verify manifest consistency.
 */
export async function manifestCheckCommand(): Promise<void> {
  const projectRoot = process.cwd();
  const warnings = await checkManifest(projectRoot);

  if (warnings.length === 0) {
    console.log(chalk.green("\n  Manifest is consistent. All tracked files exist on disk.\n"));
    return;
  }

  console.log(chalk.yellow(`\n  ${warnings.length} warning(s) found:\n`));
  for (const w of warnings) {
    console.log(chalk.yellow(`    ${w}`));
  }
  console.log("");
}
