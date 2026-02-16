import chalk from "chalk";
import { listSessions } from "../utils/session.js";

const PHASE_ICONS: Record<string, string> = {
  discussing: "\u2694\uFE0F",     // swords
  consensus_reached: "\u2705", // check
  escalated: "\u26A0\uFE0F",  // warning
  applying: "\u2699\uFE0F",   // gear
  completed: "\u2728",       // sparkles
};

const PHASE_LABELS: Record<string, string> = {
  discussing: "debating",
  consensus_reached: "consensus",
  escalated: "escalated",
  applying: "executing",
  completed: "done",
};

const PHASE_COLORS: Record<string, (text: string) => string> = {
  discussing: chalk.blue,
  consensus_reached: chalk.green,
  escalated: chalk.yellow,
  applying: chalk.cyan,
  completed: chalk.gray,
};

/**
 * The `roundtable list` command.
 * Shows all sessions with their status.
 */
export async function listCommand(): Promise<void> {
  const projectRoot = process.cwd();
  const sessions = await listSessions(projectRoot);

  if (sessions.length === 0) {
    console.log(chalk.yellow("\n  No battles fought yet."));
    console.log(chalk.dim('  Run `roundtable discuss "topic"` to start one.\n'));
    return;
  }

  console.log(chalk.bold(`\n  The Archives — ${sessions.length} session(s)\n`));

  for (const session of sessions) {
    const phase = session.status?.phase || "unknown";
    const icon = PHASE_ICONS[phase] || "?";
    const label = PHASE_LABELS[phase] || phase;
    const colorFn = PHASE_COLORS[phase] || chalk.white;
    const round = session.status?.round || 0;
    const topic = session.topic
      ? session.topic.length > 60
        ? session.topic.slice(0, 57) + "..."
        : session.topic
      : "—";

    console.log(
      `  ${icon} ${colorFn(label.padEnd(12))} ${chalk.dim(session.name)}`
    );
    console.log(
      `    ${chalk.white(topic)} ${chalk.dim(`(${round} round${round !== 1 ? "s" : ""})`)}`
    );
    console.log("");
  }
}
