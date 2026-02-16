import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

/**
 * Read the chronicle.md file. Returns empty string if not found.
 */
export async function readChronicle(projectRoot: string, chroniclePath: string): Promise<string> {
  const fullPath = resolve(projectRoot, chroniclePath);

  if (!existsSync(fullPath)) {
    return "";
  }

  return readFile(fullPath, "utf-8");
}

/**
 * Append a decision entry to the chronicle.
 */
export async function appendToChronicle(
  projectRoot: string,
  chroniclePath: string,
  decision: { topic: string; outcome: string; knights: string[]; date: string }
): Promise<void> {
  const fullPath = resolve(projectRoot, chroniclePath);
  const dir = dirname(fullPath);

  if (!existsSync(dir)) {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(dir, { recursive: true });
  }

  let content = "";
  if (existsSync(fullPath)) {
    content = await readFile(fullPath, "utf-8");
  } else {
    content = "# Chronicle - TheRoundtAIble\n\nBeslissingen log van dit project.\n\n---\n\n";
  }

  const entry = [
    `## ${decision.date} — ${decision.topic}`,
    "",
    `**Knights:** ${decision.knights.join(", ")}`,
    "",
    decision.outcome,
    "",
    "---",
    "",
  ].join("\n");

  content += entry;
  await writeFile(fullPath, content, "utf-8");
}
