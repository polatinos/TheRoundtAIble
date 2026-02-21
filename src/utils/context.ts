import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import chalk from "chalk";
import { readChronicle } from "./chronicle.js";
import { getGitBranch, getGitDiff, getRecentCommits } from "./git.js";
import type { RoundtableConfig } from "../types.js";

/**
 * Collect project files, respecting ignore patterns from config.
 * Returns a list of relative file paths.
 */
export async function getProjectFiles(
  rootDir: string,
  ignorePatterns: string[]
): Promise<string[]> {
  const files: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relPath = relative(rootDir, fullPath);

      // Check if any ignore pattern matches
      const shouldIgnore = ignorePatterns.some(
        (pattern) =>
          relPath.startsWith(pattern) ||
          entry.name === pattern ||
          relPath.includes(`/${pattern}/`) ||
          relPath.includes(`\\${pattern}\\`)
      );

      if (shouldIgnore) continue;

      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        files.push(relPath);
      }
    }
  }

  await walk(rootDir);
  return files;
}

/**
 * Read the content of key project files for context.
 * Limits to common config/source files to avoid token waste.
 */
async function readKeyFiles(
  rootDir: string,
  files: string[]
): Promise<string> {
  const keyPatterns = [
    "package.json",
    "tsconfig.json",
    "README.md",
    "CLAUDE.md",
  ];

  const keyFiles = files.filter((f) =>
    keyPatterns.some((p) => f.endsWith(p))
  );

  const contents: string[] = [];

  for (const file of keyFiles.slice(0, 5)) {
    try {
      const content = await readFile(join(rootDir, file), "utf-8");
      // Limit per file to avoid huge contexts
      const truncated = content.length > 2000 ? content.slice(0, 2000) + "\n...(truncated)" : content;
      contents.push(`### ${file}\n\`\`\`\n${truncated}\n\`\`\``);
    } catch {
      // Skip unreadable files
    }
  }

  return contents.join("\n\n");
}

export interface ProjectContext {
  chronicle: string;
  gitBranch: string | null;
  gitDiff: string | null;
  recentCommits: string | null;
  projectFiles: string[];
  keyFileContents: string;
  sourceFileContents: string;
}

/** Files to always exclude from source reading (noise, not context) */
const SOURCE_EXCLUDE = [
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  ".env",
  ".env.local",
];

/**
 * Read source files from the codebase for context.
 * Filters to common source extensions, excludes lock files.
 * @param maxChars - maximum characters to read (default 50000)
 */
export async function readSourceFiles(
  projectRoot: string,
  ignorePatterns: string[],
  maxChars = 50000
): Promise<string> {
  const files = await getProjectFiles(projectRoot, ignorePatterns);

  const sourceExts = [".ts", ".tsx", ".js", ".jsx", ".py", ".rs", ".go", ".java", ".json"];
  const sourceFiles = files
    .filter((f) => sourceExts.some((ext) => f.endsWith(ext)))
    .filter((f) => !SOURCE_EXCLUDE.some((ex) => f.endsWith(ex)))
    .slice(0, 30);

  const contents: string[] = [];
  let totalChars = 0;
  let skippedFiles = 0;

  for (const file of sourceFiles) {
    if (totalChars >= maxChars) {
      skippedFiles++;
      continue;
    }

    try {
      const content = await readFile(join(projectRoot, file), "utf-8");
      const truncated = content.slice(0, Math.min(content.length, maxChars - totalChars));
      contents.push(`### ${file}\n\`\`\`\n${truncated}\n\`\`\``);
      totalChars += truncated.length;
    } catch {
      // Skip unreadable
    }
  }

  if (skippedFiles > 0) {
    const kb = Math.round(maxChars / 1024);
    console.log(chalk.yellow(`\n  ⚔️  The scrolls overflow! ${skippedFiles} file(s) skipped — the knights can only carry ${kb}KB into battle.`));
    console.log(chalk.dim(`  Tip: For large codebases, use cloud knights (Claude, Gemini, GPT) — they handle 100K+ tokens.`));
    console.log(chalk.dim(`  Local LLMs have smaller context windows. Narrow the scope with ignore patterns in .roundtable/config.json\n`));
  }

  return contents.join("\n\n");
}

/**
 * Build the full project context for a discussion.
 * @param readSourceCode - if true, reads source files for deeper context (default: false)
 * @param maxSourceChars - max chars for source reading (default 200000 for discuss, code-red uses 50000)
 */
export async function buildContext(
  projectRoot: string,
  config: RoundtableConfig,
  readSourceCode = false,
  maxSourceChars = 200_000
): Promise<ProjectContext> {
  const [chronicle, gitBranch, gitDiff, recentCommits, projectFiles] =
    await Promise.all([
      readChronicle(projectRoot, config.chronicle),
      getGitBranch(),
      getGitDiff(),
      getRecentCommits(5),
      getProjectFiles(projectRoot, config.rules.ignore),
    ]);

  const keyFileContents = await readKeyFiles(projectRoot, projectFiles);

  let sourceFileContents = "";
  if (readSourceCode) {
    sourceFileContents = await readSourceFiles(projectRoot, config.rules.ignore, maxSourceChars);
  }

  return {
    chronicle,
    gitBranch,
    gitDiff,
    recentCommits,
    projectFiles,
    keyFileContents,
    sourceFileContents,
  };
}
