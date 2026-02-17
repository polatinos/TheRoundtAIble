import chalk from "chalk";
import { readDecreeLog } from "../utils/decree-log.js";

/**
 * The `roundtable decrees` command.
 * Read-only view of the King's Decree Log.
 */
export async function decreesCommand(): Promise<void> {
  const projectRoot = process.cwd();
  const log = await readDecreeLog(projectRoot);

  if (log.entries.length === 0) {
    console.log(chalk.dim("\n  No decrees yet. The King has spoken on nothing.\n"));
    return;
  }

  console.log(chalk.bold("\n  King's Decree Log\n"));

  const typeColors: Record<string, (t: string) => string> = {
    rejected_no_apply: chalk.red,
    deferred: chalk.yellow,
    override_scope: chalk.magenta,
  };

  for (const entry of log.entries) {
    const color = typeColors[entry.type] || chalk.white;
    const status = entry.revoked ? chalk.dim(" [REVOKED]") : "";
    const dateShort = entry.date.slice(0, 10);

    console.log(
      `  ${chalk.bold(entry.id)} ${color(entry.type.toUpperCase())}${status}`
    );
    console.log(chalk.dim(`    Topic:   ${entry.topic}`));
    console.log(chalk.dim(`    Reason:  ${entry.reason}`));
    console.log(chalk.dim(`    Session: ${entry.session}`));
    console.log(chalk.dim(`    Date:    ${dateShort}`));
    console.log("");
  }

  const active = log.entries.filter((e) => !e.revoked).length;
  const revoked = log.entries.filter((e) => e.revoked).length;
  console.log(chalk.dim(`  Total: ${log.entries.length} (${active} active, ${revoked} revoked)\n`));
}
