import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ErrorLogEntry } from "../types.js";

const ERROR_LOG_FILE = "error-log.md";

/**
 * Get the path to the error log file.
 */
function getErrorLogPath(projectRoot: string): string {
  return join(projectRoot, ".roundtable", ERROR_LOG_FILE);
}

/**
 * Read all error log entries from .roundtable/error-log.md.
 */
export async function readErrorLog(projectRoot: string): Promise<ErrorLogEntry[]> {
  const logPath = getErrorLogPath(projectRoot);
  if (!existsSync(logPath)) return [];

  const content = await readFile(logPath, "utf-8");
  const entries: ErrorLogEntry[] = [];

  // Parse markdown entries: ## CR-XXX — symptoms
  const entryPattern = /## (CR-\d{3}) — (.+?)\n([\s\S]*?)(?=\n## CR-|\n*$)/g;
  let match;

  while ((match = entryPattern.exec(content)) !== null) {
    const id = match[1];
    const symptoms = match[2].trim();
    const body = match[3];

    const statusMatch = body.match(/\*\*Status:\*\* (\w+)/);
    const rootCauseMatch = body.match(/\*\*Root Cause:\*\* (.+)/);
    const dateMatch = body.match(/\*\*Date:\*\* (.+)/);

    const triedAndFailed: string[] = [];
    const triedMatch = body.match(/\*\*Tried & Failed:\*\*\n([\s\S]*?)(?=\n\*\*|$)/);
    if (triedMatch) {
      const lines = triedMatch[1].split("\n").filter((l) => l.trim().startsWith("- "));
      for (const line of lines) {
        triedAndFailed.push(line.replace(/^- /, "").trim());
      }
    }

    entries.push({
      id,
      symptoms,
      rootCause: rootCauseMatch?.[1]?.trim() || null,
      triedAndFailed,
      status: (statusMatch?.[1] as ErrorLogEntry["status"]) || "OPEN",
      date: dateMatch?.[1]?.trim() || "",
    });
  }

  return entries;
}

/**
 * Get the next CR-XXX id based on existing entries.
 */
export async function getNextCodeRedId(projectRoot: string): Promise<string> {
  const entries = await readErrorLog(projectRoot);
  if (entries.length === 0) return "CR-001";

  const maxNum = Math.max(
    ...entries.map((e) => {
      const num = parseInt(e.id.replace("CR-", ""));
      return isNaN(num) ? 0 : num;
    })
  );

  return `CR-${String(maxNum + 1).padStart(3, "0")}`;
}

/**
 * Format an error log entry as markdown.
 */
function formatEntry(entry: ErrorLogEntry): string {
  const lines = [
    `## ${entry.id} — ${entry.symptoms}`,
    "",
    `**Status:** ${entry.status}`,
    `**Date:** ${entry.date}`,
  ];

  if (entry.rootCause) {
    lines.push(`**Root Cause:** ${entry.rootCause}`);
  }

  if (entry.triedAndFailed.length > 0) {
    lines.push("**Tried & Failed:**");
    for (const item of entry.triedAndFailed) {
      lines.push(`- ${item}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

/**
 * Append a new entry to the error log.
 */
export async function appendToErrorLog(
  projectRoot: string,
  entry: ErrorLogEntry
): Promise<void> {
  const logPath = getErrorLogPath(projectRoot);

  let content = "";
  if (existsSync(logPath)) {
    content = await readFile(logPath, "utf-8");
  } else {
    content = "# Error Log — TheRoundtAIble Code Red\n\n";
  }

  content += formatEntry(entry) + "---\n\n";
  await writeFile(logPath, content, "utf-8");
}

/**
 * Update the status of an existing error log entry.
 */
export async function updateErrorLogEntry(
  projectRoot: string,
  id: string,
  updates: Partial<Pick<ErrorLogEntry, "status" | "rootCause">>
): Promise<void> {
  const logPath = getErrorLogPath(projectRoot);
  if (!existsSync(logPath)) return;

  let content = await readFile(logPath, "utf-8");

  if (updates.status) {
    const statusPattern = new RegExp(
      `(## ${id} —[\\s\\S]*?\\*\\*Status:\\*\\*) \\w+`
    );
    content = content.replace(statusPattern, `$1 ${updates.status}`);
  }

  if (updates.rootCause) {
    const rootCausePattern = new RegExp(
      `(## ${id} —[\\s\\S]*?\\*\\*Date:\\*\\* .+)`
    );
    if (content.match(new RegExp(`## ${id} —[\\s\\S]*?\\*\\*Root Cause:\\*\\*`))) {
      // Update existing root cause
      const rcPattern = new RegExp(
        `(## ${id} —[\\s\\S]*?\\*\\*Root Cause:\\*\\*) .+`
      );
      content = content.replace(rcPattern, `$1 ${updates.rootCause}`);
    } else {
      // Add root cause after date
      content = content.replace(
        rootCausePattern,
        `$1\n**Root Cause:** ${updates.rootCause}`
      );
    }
  }

  await writeFile(logPath, content, "utf-8");
}
