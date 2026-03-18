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

    // --approval-mode plan = read-only mode (can read files, cannot write/execute).
    // Without this, Gemini CLI tries to use tools in a loop and hangs.
    // -o text = clean text output without markdown wrapping.
    // -p "" with stdin = non-interactive prompt mode.
    // Falls back to basic mode if --approval-mode plan fails (requires
    // experimental.plan in Gemini config).
    try {
      let result = await execa(this.command, [
        "-p", "",
        "--approval-mode", "plan",
        "-o", "text",
      ], {
        input: prompt,
        timeout,
        reject: false,
      });

      // If plan mode failed (not enabled in config), retry without it
      if (result.exitCode !== 0 && result.stderr?.includes("approval-mode")) {
        result = await execa(this.command, [
          "-p", "",
          "-o", "text",
        ], {
          input: prompt,
          timeout,
          reject: false,
        });
      }

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
