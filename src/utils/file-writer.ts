import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import chalk from "chalk";

export interface ParsedFile {
  path: string;
  content: string;
  language: string;
}

/**
 * Parse code blocks from a Lead Knight's response.
 * Looks for `FILE: path/to/file` followed by a fenced code block.
 * Falls back to plain fenced code blocks with language hints.
 */
export function parseCodeBlocks(response: string): ParsedFile[] {
  const files: ParsedFile[] = [];

  // Primary pattern: FILE: path/to/file followed by a code block
  const filePattern =
    /FILE:\s*([^\n]+)\s*\n\s*```(\w*)\n([\s\S]*?)```/g;

  let match: RegExpExecArray | null;
  while ((match = filePattern.exec(response)) !== null) {
    const filePath = match[1].trim();
    const language = match[2] || "text";
    const content = match[3];

    // Skip empty blocks
    if (!content.trim()) continue;

    files.push({ path: filePath, content, language });
  }

  // If no FILE: markers found, try generic code blocks as fallback
  if (files.length === 0) {
    const genericPattern = /```(\w+)\n([\s\S]*?)```/g;
    let blockIndex = 0;

    while ((match = genericPattern.exec(response)) !== null) {
      const language = match[1];
      const content = match[2];

      if (!content.trim()) continue;

      // Try to guess filename from language
      const ext = languageToExtension(language);
      const path = `output-${blockIndex}.${ext}`;
      blockIndex++;

      files.push({ path, content, language });
    }
  }

  return files;
}

function languageToExtension(lang: string): string {
  const map: Record<string, string> = {
    typescript: "ts",
    ts: "ts",
    javascript: "js",
    js: "js",
    tsx: "tsx",
    jsx: "jsx",
    python: "py",
    py: "py",
    json: "json",
    yaml: "yaml",
    yml: "yml",
    css: "css",
    html: "html",
    md: "md",
    markdown: "md",
    bash: "sh",
    sh: "sh",
    sql: "sql",
    rust: "rs",
    go: "go",
  };
  return map[lang.toLowerCase()] || lang;
}

/**
 * Write files directly without asking (noparley mode).
 * Returns count of files written.
 */
export async function writeFilesDirect(
  files: ParsedFile[],
  projectRoot: string
): Promise<number> {
  let written = 0;

  for (const file of files) {
    const fullPath = resolve(projectRoot, file.path);
    const dir = dirname(fullPath);

    await mkdir(dir, { recursive: true });
    await writeFile(fullPath, file.content, "utf-8");
    written++;

    console.log(chalk.green(`  + ${file.path}`));
  }

  return written;
}

/**
 * Write files with per-file confirmation (parley mode).
 * Returns count of files written.
 */
export async function writeFilesWithConfirmation(
  files: ParsedFile[],
  projectRoot: string
): Promise<number> {
  let written = 0;

  for (const file of files) {
    console.log(chalk.bold(`\n  ${chalk.cyan(file.path)}`));
    console.log(chalk.dim("  " + "─".repeat(50)));

    // Show preview (first 20 lines)
    const lines = file.content.split("\n");
    const preview = lines.slice(0, 20);
    for (const line of preview) {
      console.log(chalk.dim(`  ${line}`));
    }
    if (lines.length > 20) {
      console.log(chalk.dim(`  ...(${lines.length - 20} more lines)`));
    }

    console.log(chalk.dim("  " + "─".repeat(50)));

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(
      chalk.yellow(`  Write this file? [Y/n] `)
    );
    rl.close();

    const confirmed =
      answer.trim() === "" ||
      answer.trim().toLowerCase() === "y" ||
      answer.trim().toLowerCase() === "yes";

    if (confirmed) {
      const fullPath = resolve(projectRoot, file.path);
      const dir = dirname(fullPath);
      await mkdir(dir, { recursive: true });
      await writeFile(fullPath, file.content, "utf-8");
      written++;
      console.log(chalk.green(`  + Written: ${file.path}`));
    } else {
      console.log(chalk.dim(`  - Skipped: ${file.path}`));
    }
  }

  return written;
}
