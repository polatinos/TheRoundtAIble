import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import type { DecreeLog, DecreeEntry, DecreeType } from "../types.js";

const DECREE_LOG_PATH = ".roundtable/decree-log.json";

function emptyLog(): DecreeLog {
  return { version: "1.0", entries: [] };
}

/**
 * Read the decree log from disk. Returns empty log if not found.
 */
export async function readDecreeLog(projectRoot: string): Promise<DecreeLog> {
  const logPath = join(projectRoot, DECREE_LOG_PATH);

  if (!existsSync(logPath)) {
    return emptyLog();
  }

  try {
    const raw = await readFile(logPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed.version === "1.0" && Array.isArray(parsed.entries)) {
      return parsed as DecreeLog;
    }
    return emptyLog();
  } catch {
    return emptyLog();
  }
}

/**
 * Generate the next decree ID (decree-001, decree-002, ...).
 */
function nextDecreeId(log: DecreeLog): string {
  const maxNum = log.entries.reduce((max, e) => {
    const match = e.id.match(/^decree-(\d+)$/);
    return match ? Math.max(max, parseInt(match[1])) : max;
  }, 0);
  return `decree-${String(maxNum + 1).padStart(3, "0")}`;
}

/**
 * Add a decree entry to the log. Append-only.
 */
export async function addDecreeEntry(
  projectRoot: string,
  type: DecreeType,
  session: string,
  topic: string,
  reason?: string
): Promise<DecreeEntry> {
  const log = await readDecreeLog(projectRoot);
  const entry: DecreeEntry = {
    id: nextDecreeId(log),
    type,
    session,
    topic,
    reason: reason?.trim() || "No reason provided",
    revoked: false,
    date: new Date().toISOString(),
  };

  log.entries.push(entry);

  const logPath = join(projectRoot, DECREE_LOG_PATH);
  await mkdir(dirname(logPath), { recursive: true });
  await writeFile(logPath, JSON.stringify(log, null, 2) + "\n", "utf-8");

  return entry;
}

/**
 * Get recent active decrees for prompt injection.
 * Returns max 5 most recent entries where revoked === false.
 */
export function getActiveDecrees(log: DecreeLog, max = 5): DecreeEntry[] {
  return log.entries
    .filter((e) => !e.revoked)
    .slice(-max);
}

/**
 * Format decrees for system prompt injection.
 * Uses exact enum type-tags as agreed in consensus.
 */
export function formatDecreesForPrompt(decrees: DecreeEntry[]): string {
  if (decrees.length === 0) return "";

  const lines = decrees.map((d) => {
    const dateShort = d.date.slice(0, 10);
    const typeTag = d.type.toUpperCase();
    const topicShort = d.topic.length > 50 ? d.topic.slice(0, 47) + "..." : d.topic;
    return `- [${d.id}] ${typeTag} — "${topicShort}": "${d.reason}" (${dateShort})`;
  });

  return [
    "KING'S DECREES (afgewezen beslissingen — stel NIET opnieuw voor tenzij je de afwijsreden expliciet adresseert):",
    ...lines,
  ].join("\n");
}
