import { execa } from "execa";
import { BaseAdapter } from "./base.js";

export class GeminiCliAdapter extends BaseAdapter {
  readonly name = "Gemini";

  private command: string;
  private defaultTimeout: number;

  constructor(command: string = "gemini", timeoutMs: number = 120_000) {
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

    // Gemini docs: "-p/--prompt appended to input on stdin (if any)"
    // Pass prompt via stdin to avoid command line length limits.
    // --approval-mode plan = read-only mode (no tool execution).
    // Without this, Gemini enters agentic mode when it sees source code
    // and tries to use tools (replace, write_file, etc.) which fail and crash.
    // --approval-mode plan = read-only mode (no tool execution).
    // Requires experimental.plan=true in ~/.gemini/settings.json.
    // Without this, Gemini enters agentic mode when it sees source code
    // and tries to use tools (replace, write_file, etc.) which crash in piped mode.
    const result = await execa(this.command, ["-p", "", "--approval-mode", "plan"], {
      input: prompt,
      timeout,
      reject: false,
    });

    if (result.exitCode !== 0) {
      const errorMsg = result.stderr || result.stdout || "Unknown error";
      throw new Error(`Gemini CLI failed (exit ${result.exitCode}): ${errorMsg}`);
    }

    return result.stdout;
  }
}
