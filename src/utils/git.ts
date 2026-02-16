import { execaCommand } from "execa";

/**
 * Get the current git branch name.
 */
export async function getGitBranch(): Promise<string | null> {
  try {
    const { stdout } = await execaCommand("git rev-parse --abbrev-ref HEAD");
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Get staged + unstaged git diff.
 */
export async function getGitDiff(): Promise<string | null> {
  try {
    const { stdout: staged } = await execaCommand("git diff --cached");
    const { stdout: unstaged } = await execaCommand("git diff");
    const combined = [staged, unstaged].filter(Boolean).join("\n");
    return combined || null;
  } catch {
    return null;
  }
}

/**
 * Get the last n commit messages.
 */
export async function getRecentCommits(n: number = 5): Promise<string | null> {
  try {
    const { stdout } = await execaCommand(
      `git log --oneline -${n}`
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}
