import chalk from "chalk";

/**
 * Non-blocking version check against npm registry.
 * Prints a one-liner if a newer version is available.
 * Never throws — silently swallows errors (network down, etc.).
 */
export async function checkForUpdate(currentVersion: string): Promise<void> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(
      "https://registry.npmjs.org/theroundtaible/latest",
      { signal: controller.signal }
    );
    clearTimeout(timer);

    if (!response.ok) return;

    const data = (await response.json()) as { version?: string };
    const latest = data.version;
    if (!latest || latest === currentVersion) return;

    // Simple semver compare: split into [major, minor, patch] and compare
    if (isNewer(latest, currentVersion)) {
      console.log(
        chalk.yellow(
          `\n  ⚔️  Update available: ${currentVersion} → ${chalk.bold(latest)}`
        )
      );
      console.log(
        chalk.dim(`     Run: npm update -g theroundtaible\n`)
      );
    }
  } catch {
    // Network error, timeout, etc. — silently ignore
  }
}

/** Returns true if `a` is newer than `b` (simple semver compare). */
function isNewer(a: string, b: string): boolean {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);

  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false;
  }
  return false;
}
