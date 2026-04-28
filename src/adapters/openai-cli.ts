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

  private async isInsideGitRepo(): Promise<boolean> {
    try {
      await execa("git", ["rev-parse", "--is-inside-work-tree"]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Extract agent message text from Codex JSONL stream.
   * Codex emits one JSON object per line; we collect text from
   * `item.completed` events whose item.type is "agent_message".
   * Non-JSON lines (e.g. trailing ERROR rollout warnings) are ignored.
   */
  private extractAgentMessage(jsonl: string): string {
    const parts: string[] = [];
    for (const line of jsonl.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) continue;
      try {
        const evt = JSON.parse(trimmed);
        if (evt?.type === "item.completed" && evt.item?.type === "agent_message" && typeof evt.item.text === "string") {
          parts.push(evt.item.text);
        }
      } catch {
        // Ignore unparseable lines — Codex occasionally emits log lines.
      }
    }
    return parts.join("\n").trim();
  }

  async execute(prompt: string, timeoutMs?: number): Promise<string> {
    const timeout = timeoutMs ?? this.defaultTimeout;

    // Codex 0.125+: use --json to get structured JSONL output.
    // Without it, stdout is verbose (header banner, prompt echo, response,
    // rollout warnings, token usage) and the response cannot be cleanly
    // separated. JSONL gives us exactly the agent_message events.
    // NOTE: do NOT pass `-o -` — Codex treats `-` as a literal filename
    // for --output-last-message and creates a file named "-" on disk.
    const args = ["exec", "-", "--sandbox", "read-only", "--json", "--color", "never"];

    if (!(await this.isInsideGitRepo())) {
      args.push("--skip-git-repo-check");
    }

    try {
      const result = await execa(this.command, args, {
        input: prompt,
        timeout,
        reject: false,
      });

      if (result.exitCode !== 0) {
        const errorMsg = result.stderr || result.stdout || "Unknown error";
        throw new Error(`Codex CLI failed (exit ${result.exitCode}): ${errorMsg}`);
      }

      const message = this.extractAgentMessage(result.stdout);
      if (!message) {
        throw new Error("Codex CLI returned no agent_message events");
      }
      return message;
    } catch (error) {
      throw classifyError(error, this.name);
    }
  }
}
