import { execa } from "execa";
import { BaseAdapter } from "./base.js";
import { classifyError } from "../utils/errors.js";

export class OpenAICliAdapter extends BaseAdapter {
  readonly name = "GPT";

  private command: string;
  private defaultTimeout: number;

  constructor(command: string = "codex", timeoutMs: number = 120_000) {
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

    // Codex docs: "If not provided as an argument (or if `-` is used),
    // instructions are read from stdin"
    try {
      const result = await execa(
        this.command,
        ["exec", "-", "--sandbox", "read-only", "-o", "-"],
        {
          input: prompt,
          timeout,
          reject: false,
        }
      );

      if (result.exitCode !== 0) {
        const errorMsg = result.stderr || result.stdout || "Unknown error";
        throw new Error(`Codex CLI failed (exit ${result.exitCode}): ${errorMsg}`);
      }

      return result.stdout;
    } catch (error) {
      throw classifyError(error, this.name);
    }
  }
}
