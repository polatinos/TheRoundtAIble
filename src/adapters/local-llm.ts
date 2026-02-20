import { BaseAdapter } from "./base.js";
import { classifyError } from "../utils/errors.js";

export class LocalLlmAdapter extends BaseAdapter {
  readonly name: string;

  private endpoint: string;
  private model: string;
  private defaultTimeout: number;

  constructor(endpoint: string, model: string, name: string, timeoutMs: number = 120_000) {
    super();
    this.endpoint = endpoint.replace(/\/+$/, ""); // strip trailing slash
    this.model = model;
    this.name = name;
    this.defaultTimeout = timeoutMs;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const response = await fetch(`${this.endpoint}/v1/models`, {
        signal: controller.signal,
      });
      clearTimeout(timer);
      return response.ok;
    } catch {
      return false;
    }
  }

  async execute(prompt: string, timeoutMs?: number): Promise<string> {
    const timeout = timeoutMs ?? this.defaultTimeout;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(`${this.endpoint}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 16384,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Local LLM error (${response.status}): ${errorBody}`);
      }

      const data = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
      };

      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error("Local LLM returned empty response");
      }

      return content;
    } catch (error) {
      throw classifyError(error, this.name);
    } finally {
      clearTimeout(timer);
    }
  }
}
