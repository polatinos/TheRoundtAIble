import { execa } from "execa";
import { BaseAdapter } from "./base.js";

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
      await execa(this.command, ["--version"]);
      return true;
    } catch {
      return false;
    }
  }

  async execute(prompt: string, timeoutMs?: number): Promise<string> {
    const timeout = timeoutMs ?? this.defaultTimeout;

    const result = await execa(this.command, ["-p", prompt, "--print"], {
      timeout,
      reject: false,
    });

    if (result.exitCode !== 0) {
      const errorMsg = result.stderr || result.stdout || "Unknown error";
      throw new Error(`Claude CLI failed (exit ${result.exitCode}): ${errorMsg}`);
    }

    return result.stdout;
  }
}
