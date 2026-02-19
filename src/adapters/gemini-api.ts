import { BaseAdapter } from "./base.js";
import { classifyError } from "../utils/errors.js";
import { getKey } from "../utils/keys.js";

export class GeminiApiAdapter extends BaseAdapter {
  readonly name = "Gemini";

  private model: string;
  private envKey: string;
  private defaultTimeout: number;

  constructor(model: string = "gemini-2.0-flash", envKey: string = "GEMINI_API_KEY", timeoutMs: number = 120_000) {
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
        new Error(`Gemini API key not set. Set ${this.envKey} or run 'roundtable init'.`),
        this.name
      );
    }

    const timeout = timeoutMs ?? this.defaultTimeout;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 16384 },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Gemini API error (${response.status}): ${errorBody}`);
      }

      const data = (await response.json()) as {
        candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
      };

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new Error("Gemini API returned empty response");
      }

      return text;
    } catch (error) {
      throw classifyError(error, this.name);
    } finally {
      clearTimeout(timer);
    }
  }
}
