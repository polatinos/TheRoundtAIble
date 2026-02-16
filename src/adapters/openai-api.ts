import { BaseAdapter } from "./base.js";

export class OpenAIApiAdapter extends BaseAdapter {
  readonly name = "GPT";

  private model: string;
  private apiKey: string | undefined;
  private defaultTimeout: number;

  constructor(model: string = "gpt-4o", envKey: string = "OPENAI_API_KEY", timeoutMs: number = 120_000) {
    super();
    this.model = model;
    this.apiKey = process.env[envKey];
    this.defaultTimeout = timeoutMs;
  }

  async isAvailable(): Promise<boolean> {
    return typeof this.apiKey === "string" && this.apiKey.length > 0;
  }

  async execute(prompt: string, timeoutMs?: number): Promise<string> {
    if (!this.apiKey) {
      throw new Error("OpenAI API key not set. Set the OPENAI_API_KEY environment variable.");
    }

    const timeout = timeoutMs ?? this.defaultTimeout;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 2048,
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
    } finally {
      clearTimeout(timer);
    }
  }
}
