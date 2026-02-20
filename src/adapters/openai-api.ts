import { BaseAdapter } from "./base.js";
import { classifyError } from "../utils/errors.js";
import { getKey } from "../utils/keys.js";

export class OpenAIApiAdapter extends BaseAdapter {
  readonly name = "GPT";

  private model: string;
  private envKey: string;
  private defaultTimeout: number;

  constructor(model: string = "gpt-5.2", envKey: string = "OPENAI_API_KEY", timeoutMs: number = 120_000) {
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
        new Error(`OpenAI API key not set. Set ${this.envKey} or run 'roundtable init'.`),
        this.name
      );
    }

    const timeout = timeoutMs ?? this.defaultTimeout;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: "user", content: prompt }],
          max_completion_tokens: 16384,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`OpenAI API error (${response.status}): ${errorBody}`);
      }

      const data = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
      };

      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error("OpenAI API returned empty response");
      }

      return content;
    } catch (error) {
      throw classifyError(error, this.name);
    } finally {
      clearTimeout(timer);
    }
  }
}
