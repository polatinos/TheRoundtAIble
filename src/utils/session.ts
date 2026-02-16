import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { RoundEntry, SessionStatus } from "../types.js";

/**
 * Create a slugified session folder name from a topic string.
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

/**
 * Create a new session directory under .roundtable/sessions/.
 * Returns the absolute path to the session folder.
 */
export async function createSession(
  projectRoot: string,
  topic: string
): Promise<string> {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const time = now.toISOString().slice(11, 16).replace(":", "");
  const slug = slugify(topic);
  const sessionName = `${date}-${time}-${slug}`;
  const sessionPath = join(projectRoot, ".roundtable", "sessions", sessionName);

  await mkdir(sessionPath, { recursive: true });

  // Write topic.md
  await writeFile(
    join(sessionPath, "topic.md"),
    `# Topic\n\n${topic}\n`,
    "utf-8"
  );

  // Write initial status.json
  const status: SessionStatus = {
    phase: "discussing",
    current_knight: null,
    round: 0,
    consensus_reached: false,
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await writeFile(
    join(sessionPath, "status.json"),
    JSON.stringify(status, null, 2),
    "utf-8"
  );

  return sessionPath;
}

/**
 * Append round entries to discussion.md in the session folder.
 */
export async function writeDiscussion(
  sessionPath: string,
  rounds: RoundEntry[]
): Promise<void> {
  const lines: string[] = ["# Discussion\n"];

  for (const entry of rounds) {
    lines.push(`## Round ${entry.round} — ${entry.knight}`);
    lines.push(`*${entry.timestamp}*\n`);
    lines.push(entry.response);
    lines.push("");

    if (entry.consensus) {
      lines.push("**Consensus:**");
      lines.push(`- Score: ${entry.consensus.consensus_score}/10`);
      if (entry.consensus.agrees_with.length > 0) {
        lines.push(`- Agrees with: ${entry.consensus.agrees_with.join(", ")}`);
      }
      if (entry.consensus.pending_issues.length > 0) {
        lines.push(`- Pending: ${entry.consensus.pending_issues.join(", ")}`);
      }
    }

    lines.push("\n---\n");
  }

  await writeFile(join(sessionPath, "discussion.md"), lines.join("\n"), "utf-8");
}

/**
 * Write the final decisions.md when consensus is reached.
 */
export async function writeDecisions(
  sessionPath: string,
  topic: string,
  decision: string,
  rounds: RoundEntry[]
): Promise<void> {
  const knights = [...new Set(rounds.map((r) => r.knight))];

  const lines: string[] = [
    "# Decision\n",
    `**Topic:** ${topic}`,
    `**Knights:** ${knights.join(", ")}`,
    `**Rounds:** ${rounds.length}`,
    `**Date:** ${new Date().toISOString().slice(0, 10)}`,
    "",
    "---\n",
    decision,
    "",
  ];

  await writeFile(join(sessionPath, "decisions.md"), lines.join("\n"), "utf-8");
}

/**
 * Update the status.json in the session folder.
 */
export async function updateStatus(
  sessionPath: string,
  updates: Partial<SessionStatus>
): Promise<void> {
  const statusPath = join(sessionPath, "status.json");
  let current: SessionStatus;

  if (existsSync(statusPath)) {
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(statusPath, "utf-8");
    current = JSON.parse(raw);
  } else {
    current = {
      phase: "discussing",
      current_knight: null,
      round: 0,
      consensus_reached: false,
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  const updated: SessionStatus = {
    ...current,
    ...updates,
    updated_at: new Date().toISOString(),
  };

  await writeFile(statusPath, JSON.stringify(updated, null, 2), "utf-8");
}

/**
 * Read status.json from a session folder.
 */
export async function readStatus(sessionPath: string): Promise<SessionStatus | null> {
  const statusPath = join(sessionPath, "status.json");
  if (!existsSync(statusPath)) return null;

  try {
    const raw = await readFile(statusPath, "utf-8");
    return JSON.parse(raw) as SessionStatus;
  } catch {
    return null;
  }
}

export interface SessionInfo {
  name: string;
  path: string;
  status: SessionStatus | null;
  topic: string | null;
}

/**
 * List all sessions in .roundtable/sessions/, sorted newest first.
 */
export async function listSessions(projectRoot: string): Promise<SessionInfo[]> {
  const sessionsDir = join(projectRoot, ".roundtable", "sessions");
  if (!existsSync(sessionsDir)) return [];

  const entries = await readdir(sessionsDir, { withFileTypes: true });
  const sessions: SessionInfo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const sessionPath = join(sessionsDir, entry.name);
    const status = await readStatus(sessionPath);

    let topic: string | null = null;
    const topicPath = join(sessionPath, "topic.md");
    if (existsSync(topicPath)) {
      const raw = await readFile(topicPath, "utf-8");
      // Extract topic from "# Topic\n\n<topic>"
      const match = raw.match(/^# Topic\s*\n\n(.+)/m);
      topic = match?.[1]?.trim() || raw.trim();
    }

    sessions.push({ name: entry.name, path: sessionPath, status, topic });
  }

  // Sort newest first (session names start with date)
  sessions.sort((a, b) => b.name.localeCompare(a.name));
  return sessions;
}

/**
 * Find the most recent session folder.
 */
export async function findLatestSession(projectRoot: string): Promise<SessionInfo | null> {
  const sessions = await listSessions(projectRoot);
  return sessions[0] || null;
}
