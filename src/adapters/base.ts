import type { ConsensusBlock } from "../types.js";
import { validateFilesToModify } from "../consensus.js";
import { AdapterError, classifyError } from "../utils/errors.js";
import type { AdapterErrorKind } from "../utils/errors.js";

// Re-export for backward compatibility (orchestrator imports from here)
export { AdapterError, classifyError };
export type { AdapterErrorKind };

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
            files_to_modify: validateFilesToModify(parsed.files_to_modify),
          };
        }
      } catch {
        // Try next pattern
      }
    }

    return null;
  }
}
