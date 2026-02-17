import { execa } from "execa";
import { BaseAdapter } from "./base.js";
import { classifyError } from "../utils/errors.js";

export class ClaudeCliAdapter extends BaseAdapter {
  readonly name = "Claude";

  private command: string;
  private defaultTimeout: number;

  constructor(command: string = "claude", timeoutMs: number = 120_000) {
    super();
    this.command = command;
    this.defaultTimeout = timeoutMs;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const result = await execa("where", [this.command], { reject: false });
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  async execute(prompt: string, timeoutMs?: number): Promise<string> {
    const timeout = timeoutMs ?? this.defaultTimeout;

    // Claude reads from stdin when no -p flag is given.
    // Use --print for non-interactive output.
    // Remove CLAUDECODE env var entirely to allow invocation from within VS Code
    // terminal where Claude Code is running. Empty string is not enough.
    const env = { ...process.env };
    delete env.CLAUDECODE;

    try {
      const result = await execa(this.command, ["--print"], {
        input: prompt,
        timeout,
        reject: false,
        env,
      });

      if (result.exitCode !== 0) {
        const errorMsg = result.stderr || result.stdout || "Unknown error";
        throw new Error(`Claude CLI failed (exit ${result.exitCode}): ${errorMsg}`);
      }

      return result.stdout;
    } catch (error) {
      throw classifyError(error, this.name);
    }
  }
}
