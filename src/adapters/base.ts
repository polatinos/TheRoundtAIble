import type { ConsensusBlock } from "../types.js";

export type AdapterErrorKind = "not_installed" | "timeout" | "auth" | "api" | "unknown";

export class AdapterError extends Error {
  readonly kind: AdapterErrorKind;
  readonly adapterName: string;

  constructor(message: string, kind: AdapterErrorKind, adapterName: string) {
    super(message);
    this.name = "AdapterError";
    this.kind = kind;
    this.adapterName = adapterName;
  }
}

/**
 * Classify an error thrown during adapter execution into a known kind.
 */
export function classifyError(error: unknown, adapterName: string): AdapterError {
  const msg = error instanceof Error ? error.message : String(error);
  const lower = msg.toLowerCase();

  if (lower.includes("enoent") || lower.includes("not found") || lower.includes("not recognized")) {
    return new AdapterError(msg, "not_installed", adapterName);
  }
  if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("etimedout")) {
    return new AdapterError(msg, "timeout", adapterName);
  }
  if (lower.includes("401") || lower.includes("403") || lower.includes("unauthorized") || lower.includes("api key")) {
    return new AdapterError(msg, "auth", adapterName);
  }
  if (lower.includes("api error") || lower.includes("429") || lower.includes("500") || lower.includes("502") || lower.includes("503")) {
    return new AdapterError(msg, "api", adapterName);
  }

  return new AdapterError(msg, "unknown", adapterName);
}

export abstract class BaseAdapter {
  abstract readonly name: string;

  abstract execute(prompt: string, timeoutMs?: number): Promise<string>;

  abstract isAvailable(): Promise<boolean>;

  parseConsensus(response: string, round: number): ConsensusBlock | null {
    // Try to extract JSON block from the response
    // Knights are instructed to end with a JSON block containing consensus_score
    const jsonPatterns = [
      // Fenced code block with json
      /```json\s*\n?([\s\S]*?)\n?\s*```/,
      // Fenced code block without language
      /```\s*\n?([\s\S]*?)\n?\s*```/,
      // Raw JSON object containing consensus_score
      /(\{[^{}]*"consensus_score"\s*:[^{}]*\})/,
    ];

    for (const pattern of jsonPatterns) {
      const match = response.match(pattern);
      if (!match?.[1]) continue;

      try {
        const parsed = JSON.parse(match[1].trim());
        if (typeof parsed.consensus_score === "number") {
          return {
            knight: parsed.knight || this.name,
            round: parsed.round || round,
            consensus_score: parsed.consensus_score,
            agrees_with: Array.isArray(parsed.agrees_with) ? parsed.agrees_with : [],
            pending_issues: Array.isArray(parsed.pending_issues) ? parsed.pending_issues : [],
            proposal: parsed.proposal,
          };
        }
      } catch {
        // Try next pattern
      }
    }

    return null;
  }
}
