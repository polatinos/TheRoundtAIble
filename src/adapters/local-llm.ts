import { BaseAdapter } from "./base.js";
import { classifyError } from "../utils/errors.js";

type LocalSource = "Ollama" | "LM Studio" | undefined;

export class LocalLlmAdapter extends BaseAdapter {
  readonly name: string;

  private endpoint: string;
  private model: string;
  private source: LocalSource;
  private defaultTimeout: number;
  private detectedContextTokens: number | undefined;

  constructor(endpoint: string, model: string, name: string, source?: LocalSource, timeoutMs: number = 120_000) {
    super();
    this.endpoint = endpoint.replace(/\/+$/, ""); // strip trailing slash
    this.model = model;
    this.name = name;
    this.source = source;
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

  /**
   * Detect the model's context window size.
   * - Ollama: POST /api/show → model_info["*.context_length"]
   * - LM Studio: no reliable API detection (user sets it manually)
   */
  async detectContextWindow(): Promise<number | undefined> {
    if (this.source === "Ollama") {
      this.detectedContextTokens = await this.detectOllamaContext();
    }
    // LM Studio: no reliable API, user configures manually
    return this.detectedContextTokens;
  }

  /**
   * Max source chars budget based on detected context window.
   * Reserves 4096 tokens for response + 3000 for system prompt/rounds overhead.
   */
  override getMaxSourceChars(): number | undefined {
    if (!this.detectedContextTokens) return undefined;

    const responseReserve = 4096;
    const overheadReserve = 3000; // system prompt, chronicle, discussion rounds
    const availableTokens = Math.max(this.detectedContextTokens - responseReserve - overheadReserve, 2000);
    // ~4 chars per token (rough estimate)
    return availableTokens * 4;
  }

  async execute(prompt: string, timeoutMs?: number): Promise<string> {
    try {
      if (this.source === "Ollama") {
        return await this.executeOllama(prompt, timeoutMs);
      }
      return await this.executeOpenAICompat(prompt, timeoutMs);
    } catch (error) {
      // Retry once on transient "Model reloaded" error (LM Studio reloads model after settings change)
      if (error instanceof Error && error.message.includes("Model reloaded")) {
        await new Promise((r) => setTimeout(r, 3000));
        if (this.source === "Ollama") {
          return this.executeOllama(prompt, timeoutMs);
        }
        return this.executeOpenAICompat(prompt, timeoutMs);
      }
      throw error;
    }
  }

  /**
   * Ollama native API — uses /api/chat with dynamic num_ctx based on prompt size.
   * Only allocates as much context as needed to save GPU memory.
   */
  private async executeOllama(prompt: string, timeoutMs?: number): Promise<string> {
    const timeout = timeoutMs ?? this.defaultTimeout;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    // Dynamic num_ctx: prompt tokens + response budget + safety margin
    const estimatedPromptTokens = Math.ceil(prompt.length / 4);
    const responsebudget = 4096;
    const safetyMargin = 512;
    let numCtx = estimatedPromptTokens + responsebudget + safetyMargin;

    // Clamp to model's detected max (if known)
    if (this.detectedContextTokens) {
      numCtx = Math.min(numCtx, this.detectedContextTokens);
    }

    try {
      const response = await fetch(`${this.endpoint}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: "user", content: prompt }],
          stream: false,
          options: { num_ctx: numCtx },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Ollama error (${response.status}): ${errorBody}`);
      }

      const data = (await response.json()) as {
        message?: { content: string };
      };

      const content = data.message?.content;
      if (!content) {
        throw new Error("Ollama returned empty response");
      }

      return content;
    } catch (error) {
      throw classifyError(error, this.name);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * OpenAI-compatible API — used by LM Studio and unknown sources.
   * Parses LM Studio-specific context window errors into actionable messages.
   */
  private async executeOpenAICompat(prompt: string, timeoutMs?: number): Promise<string> {
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
        // Detect LM Studio context window overflow
        if (this.source === "LM Studio" && this.isContextWindowError(errorBody)) {
          const estimatedTokens = Math.ceil(prompt.length / 4);
          throw new Error(
            `LM Studio context window too small (prompt needs ~${estimatedTokens} tokens).\n` +
            `  Fix: In LM Studio → Developer → Model Settings → increase Context Length.\n` +
            `  Also uncheck the Response Limit, or set it higher.\n` +
            `  Note: higher context = more VRAM. Find the sweet spot for your GPU.`
          );
        }
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

  /**
   * Detect Ollama model context window via /api/show.
   * Looks for context_length in model_info (e.g. "llama.context_length": 32768).
   */
  private async detectOllamaContext(): Promise<number | undefined> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(`${this.endpoint}/api/show`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: this.model }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!response.ok) return undefined;

      const data = (await response.json()) as {
        model_info?: Record<string, unknown>;
      };

      if (data.model_info) {
        for (const [key, value] of Object.entries(data.model_info)) {
          if (key.endsWith(".context_length") && typeof value === "number") {
            return value;
          }
        }
      }

      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Detect LM Studio context window errors from response body.
   */
  private isContextWindowError(errorBody: string): boolean {
    const lower = errorBody.toLowerCase();
    return (
      (lower.includes("n_keep") && lower.includes("n_ctx")) ||
      lower.includes("context length exceeded") ||
      lower.includes("maximum context length") ||
      lower.includes("too many tokens")
    );
  }
}
