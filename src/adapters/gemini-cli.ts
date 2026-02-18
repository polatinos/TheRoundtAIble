import { execa } from "execa";
import { BaseAdapter } from "./base.js";
import { classifyError } from "../utils/errors.js";

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

    // --approval-mode plan = read-only mode (no tool execution).
    // -e with empty string disables skills/extensions that cause conflicts.
    // Gemini may still attempt tools in plan mode (exit_plan_mode, write_file)
    // which get denied — so we accept output even on non-zero exit if stdout exists.
    try {
      const result = await execa(this.command, [
        "-p", "",
        "--approval-mode", "plan",
        "-e", "",
      ], {
        input: prompt,
        timeout,
        reject: false,
      });

      // Gemini often exits non-zero due to tool denials in plan mode,
      // but still produces valid output on stdout. Use it if available.
      if (result.stdout && result.stdout.trim().length > 50) {
        return result.stdout;
      }

      if (result.exitCode !== 0) {
        const errorMsg = result.stderr || result.stdout || "Unknown error";
        throw new Error(`Gemini CLI failed (exit ${result.exitCode}): ${errorMsg}`);
      }

      return result.stdout;
    } catch (error) {
      throw classifyError(error, this.name);
    }
  }
}
