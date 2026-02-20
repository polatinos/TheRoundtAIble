import { execFile } from "node:child_process";
import chalk from "chalk";

/**
 * Whitelisted base commands for knight verify_commands.
 * All are read-only — no write/delete/network commands allowed.
 */
const WHITELISTED_COMMANDS = new Set([
  "ls", "cat", "head", "tail", "grep", "find", "wc",
  "file", "stat", "sort", "uniq", "basename", "dirname",
]);

/**
 * Forbidden patterns that indicate command injection or write operations.
 */
const FORBIDDEN_PATTERNS = [
  /;/,              // command chaining
  /`/,              // backtick substitution
  /\$\(/,           // $( command substitution
  /\$\{/,           // ${ variable expansion with commands
  />/,              // output redirect
  /</,              // input redirect
  />>/,             // append redirect
  /&&/,             // conditional execution
  /\|\|/,           // conditional execution
  /-exec\b/,        // find -exec
  /-delete\b/,      // find -delete
  /-ok\b/,          // find -ok
];

/**
 * Explicitly forbidden commands (write/network/execution).
 */
const FORBIDDEN_COMMANDS = new Set([
  "rm", "mv", "cp", "chmod", "chown", "chgrp",
  "curl", "wget", "eval", "source", "node", "python",
  "python3", "ruby", "perl", "php", "bash", "sh", "zsh",
  "npm", "npx", "yarn", "pnpm", "pip", "apt", "brew",
  "dd", "mkfs", "mount", "umount", "kill", "pkill",
  "ssh", "scp", "rsync", "nc", "ncat", "telnet",
]);

/**
 * Sensitive env vars to strip before command execution.
 */
const SENSITIVE_ENV_KEYS = [
  "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY",
  "GOOGLE_API_KEY", "AWS_SECRET_ACCESS_KEY", "AWS_ACCESS_KEY_ID",
  "GITHUB_TOKEN", "GH_TOKEN", "NPM_TOKEN", "CLAUDECODE",
];

/**
 * Validate a single command string against the whitelist.
 * Returns null if valid, or an error message if rejected.
 */
export function validateCommand(command: string): string | null {
  const trimmed = command.trim();
  if (!trimmed) return "empty command";

  // Check forbidden patterns
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(trimmed)) {
      return `forbidden pattern: ${pattern.source}`;
    }
  }

  // Split by pipe to validate each segment
  const segments = trimmed.split("|").map((s) => s.trim());

  for (const segment of segments) {
    if (!segment) return "empty pipe segment";

    // Extract base command (first word)
    const baseCommand = segment.split(/\s+/)[0];
    if (!baseCommand) return "empty segment";

    if (FORBIDDEN_COMMANDS.has(baseCommand)) {
      return `forbidden command: ${baseCommand}`;
    }

    if (!WHITELISTED_COMMANDS.has(baseCommand)) {
      return `command not whitelisted: ${baseCommand}`;
    }
  }

  return null; // valid
}

/**
 * Execute a single verified command and return formatted output.
 * Returns the command output with a header, or an error message.
 */
function executeCommand(
  command: string,
  projectRoot: string,
  env: NodeJS.ProcessEnv
): Promise<string> {
  return new Promise((resolve) => {
    const child = execFile(
      "bash",
      ["-c", command],
      {
        cwd: projectRoot,
        timeout: 5000,
        maxBuffer: 1024 * 1024, // 1MB buffer
        env,
      },
      (error, stdout, stderr) => {
        const output = (stdout || "").trim();
        const errOutput = (stderr || "").trim();

        // Truncate output to 5000 chars
        const truncated = output.length > 5000
          ? output.slice(0, 5000) + "\n...(truncated)"
          : output;

        if (error) {
          if (error.killed) {
            resolve(`### VERIFY: ${command}\n\`\`\`\n[TIMEOUT after 5s]\n\`\`\``);
          } else {
            // Show output even on non-zero exit (e.g. grep no match)
            const combined = truncated || errOutput || `exit code ${error.code}`;
            resolve(`### VERIFY: ${command}\n\`\`\`\n${combined}\n\`\`\``);
          }
        } else {
          resolve(`### VERIFY: ${command}\n\`\`\`\n${truncated || "(empty output)"}\n\`\`\``);
        }
      }
    );
  });
}

/**
 * Resolve verify_commands from a knight: validate, execute, collect output.
 * Max 4 commands per invocation, 5s timeout each, read-only whitelist.
 */
export async function resolveVerifyCommands(
  commands: string[],
  projectRoot: string
): Promise<string> {
  const results: string[] = [];

  // Build sanitized environment
  const env = { ...process.env };
  for (const key of SENSITIVE_ENV_KEYS) {
    delete env[key];
  }

  for (const command of commands.slice(0, 4)) {
    const error = validateCommand(command);
    if (error) {
      results.push(`### VERIFY: ${command}\n\`\`\`\n[DENIED] ${error}\n\`\`\``);
      console.log(chalk.yellow(`  [DENIED] ${command} — ${error}`));
      continue;
    }

    console.log(chalk.dim(`  Running: ${command}`));
    const output = await executeCommand(command, projectRoot, env);
    results.push(output);
  }

  return results.join("\n\n");
}
