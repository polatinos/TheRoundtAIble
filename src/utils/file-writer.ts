import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { createInterface } from "node:readline/promises";
import chalk from "chalk";
import type { ParsedEdit } from "../types.js";
import { applyEdits } from "./edit-parser.js";

export interface ParsedFile {
  path: string;
  content: string;
  language: string;
}

export interface ScopeFilterResult<T extends { path: string } = ParsedFile> {
  allowed: T[];
  rejected: T[];
}

/**
 * Normalize a path for scope comparison.
 * Trims whitespace, uses forward slashes, removes leading ./
 */
export function normalizeScopePath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "");
}

/**
 * Check if a path escapes the project root via ".." traversal.
 */
export function isPathEscaping(filePath: string, projectRoot: string): boolean {
  const fullPath = resolve(projectRoot, filePath);
  const resolvedRoot = resolve(projectRoot);
  return fullPath !== resolvedRoot && !fullPath.startsWith(resolvedRoot + sep);
}

/**
 * Check if a file path is allowed by the scope allowlist.
 * Handles NEW: prefix — a NEW:path/to/file entry allows path/to/file.
 */
export function isPathAllowed(filePath: string, allowedFiles: string[]): boolean {
  const normalized = normalizeScopePath(filePath);

  for (const allowed of allowedFiles) {
    // Strip NEW: prefix for comparison
    const cleanAllowed = allowed.toUpperCase().startsWith("NEW:")
      ? normalizeScopePath(allowed.slice(4))
      : normalizeScopePath(allowed);

    if (normalized === cleanAllowed) return true;
  }

  return false;
}

/**
 * Split items into allowed and rejected based on scope allowlist.
 * If allowedFiles is empty/undefined, all items are allowed (backward compat).
 * Generic: works with ParsedFile, ParsedEdit, or any { path: string }.
 */
export function filterByScope<T extends { path: string }>(
  items: T[],
  allowedFiles?: string[]
): ScopeFilterResult<T> {
  if (!allowedFiles || allowedFiles.length === 0) {
    return { allowed: items, rejected: [] };
  }

  const allowed: T[] = [];
  const rejected: T[] = [];

  for (const item of items) {
    if (isPathAllowed(item.path, allowedFiles)) {
      allowed.push(item);
    } else {
      rejected.push(item);
    }
  }

  return { allowed, rejected };
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

export interface WriteResult {
  count: number;
  writtenPaths: string[];
  skippedPaths: string[];
}

/**
 * Backup a file to .roundtable/backups/{session}/ before overwriting.
 * Only backs up files that already exist.
 */
export async function backupFile(
  filePath: string,
  projectRoot: string,
  sessionName: string
): Promise<void> {
  const fullPath = resolve(projectRoot, filePath);
  if (!existsSync(fullPath)) return;

  const backupDir = join(projectRoot, ".roundtable", "backups", sessionName);
  const backupPath = join(backupDir, filePath.replace(/\//g, "__"));

  await mkdir(backupDir, { recursive: true });
  await copyFile(fullPath, backupPath);
}

/**
 * Write staged content from a Map to disk.
 * Used after validation passes. Handles backups.
 * All-or-nothing: if any write fails, throws.
 */
export async function writeStagedFiles(
  staged: Map<string, string>,
  projectRoot: string,
  sessionName: string
): Promise<WriteResult> {
  const writtenPaths: string[] = [];
  const skippedPaths: string[] = [];

  // Backup all existing files first
  for (const filePath of staged.keys()) {
    if (isPathEscaping(filePath, projectRoot)) {
      console.log(chalk.red(`  BLOCKED: ${filePath} — path escapes project root`));
      skippedPaths.push(filePath);
      continue;
    }
    await backupFile(filePath, projectRoot, sessionName);
  }

  // Write all files
  for (const [filePath, content] of staged) {
    if (isPathEscaping(filePath, projectRoot)) continue; // already logged above

    const fullPath = resolve(projectRoot, filePath);
    const dir = dirname(fullPath);

    await mkdir(dir, { recursive: true });
    await writeFile(fullPath, content, "utf-8");
    writtenPaths.push(filePath);

    console.log(chalk.green(`  + ${filePath}`));
  }

  return { count: writtenPaths.length, writtenPaths, skippedPaths };
}

/**
 * Write staged content with per-file confirmation (parley mode).
 */
export async function writeStagedFilesWithConfirmation(
  staged: Map<string, string>,
  projectRoot: string,
  sessionName: string
): Promise<WriteResult> {
  const writtenPaths: string[] = [];
  const skippedPaths: string[] = [];

  for (const [filePath, content] of staged) {
    if (isPathEscaping(filePath, projectRoot)) {
      console.log(chalk.red(`  BLOCKED: ${filePath} — path escapes project root`));
      skippedPaths.push(filePath);
      continue;
    }

    console.log(chalk.bold(`\n  ${chalk.cyan(filePath)}`));
    console.log(chalk.dim("  " + "─".repeat(50)));

    const lines = content.split("\n");
    const preview = lines.slice(0, 20);
    for (const line of preview) {
      console.log(chalk.dim(`  ${line}`));
    }
    if (lines.length > 20) {
      console.log(chalk.dim(`  ...(${lines.length - 20} more lines)`));
    }

    console.log(chalk.dim("  " + "─".repeat(50)));

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(chalk.yellow(`  Write this file? [Y/n] `));
    rl.close();

    const confirmed =
      answer.trim() === "" ||
      answer.trim().toLowerCase() === "y" ||
      answer.trim().toLowerCase() === "yes";

    if (confirmed) {
      await backupFile(filePath, projectRoot, sessionName);
      const fullPath = resolve(projectRoot, filePath);
      const dir = dirname(fullPath);
      await mkdir(dir, { recursive: true });
      await writeFile(fullPath, content, "utf-8");
      writtenPaths.push(filePath);
      console.log(chalk.green(`  + Written: ${filePath}`));
    } else {
      skippedPaths.push(filePath);
      console.log(chalk.dim(`  - Skipped: ${filePath}`));
    }
  }

  return { count: writtenPaths.length, writtenPaths, skippedPaths };
}

/**
 * Write files directly without asking (noparley mode).
 * Returns written/skipped paths for manifest tracking.
 */
export async function writeFilesDirect(
  files: ParsedFile[],
  projectRoot: string
): Promise<WriteResult> {
  const writtenPaths: string[] = [];
  const skippedPaths: string[] = [];

  for (const file of files) {
    if (isPathEscaping(file.path, projectRoot)) {
      console.log(chalk.red(`  BLOCKED: ${file.path} — path escapes project root`));
      skippedPaths.push(file.path);
      continue;
    }

    const fullPath = resolve(projectRoot, file.path);
    const dir = dirname(fullPath);

    await mkdir(dir, { recursive: true });
    await writeFile(fullPath, file.content, "utf-8");
    writtenPaths.push(file.path);

    console.log(chalk.green(`  + ${file.path}`));
  }

  return { count: writtenPaths.length, writtenPaths, skippedPaths };
}

/**
 * Write files with per-file confirmation (parley mode).
 * Returns written/skipped paths for manifest tracking.
 */
export async function writeFilesWithConfirmation(
  files: ParsedFile[],
  projectRoot: string
): Promise<WriteResult> {
  const writtenPaths: string[] = [];
  const skippedPaths: string[] = [];

  for (const file of files) {
    if (isPathEscaping(file.path, projectRoot)) {
      console.log(chalk.red(`  BLOCKED: ${file.path} — path escapes project root`));
      skippedPaths.push(file.path);
      continue;
    }

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
      writtenPaths.push(file.path);
      console.log(chalk.green(`  + Written: ${file.path}`));
    } else {
      skippedPaths.push(file.path);
      console.log(chalk.dim(`  - Skipped: ${file.path}`));
    }
  }

  return { count: writtenPaths.length, writtenPaths, skippedPaths };
}

// --- Edit (search-and-replace) write functions ---

/**
 * Format a diff preview for a single edit operation.
 * Shows removed lines in red and added lines in green.
 */
function formatEditPreview(edit: { search: string; replace: string }): string {
  const lines: string[] = [];
  for (const line of edit.search.split("\n")) {
    lines.push(chalk.red(`  - ${line}`));
  }
  for (const line of edit.replace.split("\n")) {
    lines.push(chalk.green(`  + ${line}`));
  }
  return lines.join("\n");
}

/**
 * Apply EDIT: blocks directly without asking (noparley mode).
 * Reads existing files, applies search-and-replace edits, writes results.
 */
export async function writeEditsDirect(
  edits: ParsedEdit[],
  projectRoot: string
): Promise<WriteResult> {
  const writtenPaths: string[] = [];
  const skippedPaths: string[] = [];

  for (const parsedEdit of edits) {
    if (isPathEscaping(parsedEdit.path, projectRoot)) {
      console.log(chalk.red(`  BLOCKED: ${parsedEdit.path} — path escapes project root`));
      skippedPaths.push(parsedEdit.path);
      continue;
    }

    const fullPath = resolve(projectRoot, parsedEdit.path);

    if (!existsSync(fullPath)) {
      console.log(chalk.red(`  SKIP: ${parsedEdit.path} — file not found (use FILE: for new files)`));
      skippedPaths.push(parsedEdit.path);
      continue;
    }

    const originalContent = await readFile(fullPath, "utf-8");
    const result = applyEdits(originalContent, parsedEdit.edits, parsedEdit.path);

    if (result.errors && result.errors.length > 0) {
      for (const err of result.errors) {
        console.log(chalk.yellow(`  WARNING: ${err}`));
      }
    }

    if (!result.content || result.content === originalContent) {
      console.log(chalk.yellow(`  SKIP: ${parsedEdit.path} — no changes after applying edits`));
      skippedPaths.push(parsedEdit.path);
      continue;
    }

    await writeFile(fullPath, result.content, "utf-8");
    writtenPaths.push(parsedEdit.path);

    const editCount = parsedEdit.edits.length;
    const failedCount = result.failedEdits?.length ?? 0;
    const successCount = editCount - failedCount;
    console.log(chalk.green(`  ~ ${parsedEdit.path} (${successCount}/${editCount} edits applied)`));
  }

  return { count: writtenPaths.length, writtenPaths, skippedPaths };
}

/**
 * Apply EDIT: blocks with per-file confirmation (parley mode).
 * Shows a diff-style preview for each file before writing.
 */
export async function writeEditsWithConfirmation(
  edits: ParsedEdit[],
  projectRoot: string
): Promise<WriteResult> {
  const writtenPaths: string[] = [];
  const skippedPaths: string[] = [];

  for (const parsedEdit of edits) {
    if (isPathEscaping(parsedEdit.path, projectRoot)) {
      console.log(chalk.red(`  BLOCKED: ${parsedEdit.path} — path escapes project root`));
      skippedPaths.push(parsedEdit.path);
      continue;
    }

    const fullPath = resolve(projectRoot, parsedEdit.path);

    if (!existsSync(fullPath)) {
      console.log(chalk.red(`  SKIP: ${parsedEdit.path} — file not found (use FILE: for new files)`));
      skippedPaths.push(parsedEdit.path);
      continue;
    }

    const originalContent = await readFile(fullPath, "utf-8");
    const result = applyEdits(originalContent, parsedEdit.edits, parsedEdit.path);

    if (!result.content || result.content === originalContent) {
      console.log(chalk.yellow(`  SKIP: ${parsedEdit.path} — no changes after applying edits`));
      skippedPaths.push(parsedEdit.path);
      continue;
    }

    // Show preview
    console.log(chalk.bold(`\n  ${chalk.cyan(parsedEdit.path)} (${parsedEdit.edits.length} edit(s))`));
    console.log(chalk.dim("  " + "─".repeat(50)));

    for (let i = 0; i < parsedEdit.edits.length; i++) {
      const edit = parsedEdit.edits[i];
      const failed = result.failedEdits?.includes(i);

      if (failed) {
        console.log(chalk.red(`  Edit ${i + 1}/${parsedEdit.edits.length}: FAILED — search not found`));
      } else {
        console.log(chalk.dim(`  Edit ${i + 1}/${parsedEdit.edits.length}:`));
        console.log(formatEditPreview(edit));
      }
      console.log("");
    }

    if (result.errors && result.errors.length > 0) {
      for (const err of result.errors) {
        console.log(chalk.yellow(`  WARNING: ${err}`));
      }
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
      await writeFile(fullPath, result.content, "utf-8");
      writtenPaths.push(parsedEdit.path);
      console.log(chalk.green(`  ~ Written: ${parsedEdit.path}`));
    } else {
      skippedPaths.push(parsedEdit.path);
      console.log(chalk.dim(`  - Skipped: ${parsedEdit.path}`));
    }
  }

  return { count: writtenPaths.length, writtenPaths, skippedPaths };
}
