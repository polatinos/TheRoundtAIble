import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
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
}

/**
 * Build the full project context for a discussion.
 */
export async function buildContext(
  projectRoot: string,
  config: RoundtableConfig
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

  return {
    chronicle,
    gitBranch,
    gitDiff,
    recentCommits,
    projectFiles,
    keyFileContents,
  };
}
