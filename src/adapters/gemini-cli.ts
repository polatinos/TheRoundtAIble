import { execa } from "execa";
import { BaseAdapter } from "./base.js";
import { classifyError } from "../utils/errors.js";

export class GeminiCliAdapter extends BaseAdapter {
  readonly name = "Gemini";

  // Gemini CLI's default model (currently gemini-3.1-pro-preview) frequently
  // returns 429 RESOURCE_EXHAUSTED for non-paid accounts. Pin to a stable
  // model unless the user explicitly overrides it in config.
  private static readonly DEFAULT_MODEL = "gemini-2.5-pro";

  private command: string;
  private model: string;
  private defaultTimeout: number;

  constructor(command: string = "gemini", model?: string, timeoutMs: number = 120_000) {
    super();
    this.command = command;
    this.model = model || GeminiCliAdapter.DEFAULT_MODEL;
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
    // -m model = override model selection (avoids capacity-exhausted defaults).
    // Falls back to basic mode if --approval-mode plan fails (requires
    // experimental.plan in Gemini config).
    try {
      const baseArgs = ["-p", "", "--approval-mode", "plan", "-o", "text", "-m", this.model];

      let result = await execa(this.command, baseArgs, {
        input: prompt,
        timeout,
        reject: false,
      });

      // If plan mode failed (not enabled in config), retry without it
      if (result.exitCode !== 0 && result.stderr?.includes("approval-mode")) {
        result = await execa(this.command, ["-p", "", "-o", "text", "-m", this.model], {
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
