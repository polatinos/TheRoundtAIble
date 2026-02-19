import { BaseAdapter } from "./base.js";
import { classifyError } from "../utils/errors.js";
import { getKey } from "../utils/keys.js";

export class ClaudeApiAdapter extends BaseAdapter {
  readonly name = "Claude";

  private model: string;
  private envKey: string;
  private defaultTimeout: number;

  constructor(model: string = "claude-sonnet-4-20250514", envKey: string = "ANTHROPIC_API_KEY", timeoutMs: number = 120_000) {
    super();
    this.model = model;
    this.envKey = envKey;
    this.defaultTimeout = timeoutMs;
  }

  async isAvailable(): Promise<boolean> {
    const key = await getKey(this.envKey);
    return typeof key === "string" && key.length > 0;
  }

  async execute(prompt: string, timeoutMs?: number): Promise<string> {
    const apiKey = await getKey(this.envKey);
    if (!apiKey) {
      throw classifyError(
        new Error(`Anthropic API key not set. Set ${this.envKey} or run 'roundtable init'.`),
        this.name
      );
    }

    const timeout = timeoutMs ?? this.defaultTimeout;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 16384,
          messages: [{ role: "user", content: prompt }],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Anthropic API error (${response.status}): ${errorBody}`);
      }

      const data = (await response.json()) as {
        content: Array<{ type: string; text: string }>;
      };

      const text = data.content?.find((c) => c.type === "text")?.text;
      if (!text) {
        throw new Error("Anthropic API returned empty response");
      }

      return text;
    } catch (error) {
      throw classifyError(error, this.name);
    } finally {
      clearTimeout(timer);
    }
  }
}
