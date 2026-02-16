import type { ConsensusBlock } from "./types.js";

/**
 * Parse a consensus JSON block from an LLM response string.
 * Tries multiple patterns: fenced code blocks, raw JSON objects.
 */
export function parseConsensusFromResponse(
  response: string,
  knightName: string,
  round: number
): ConsensusBlock | null {
  const jsonPatterns = [
    /```json\s*\n?([\s\S]*?)\n?\s*```/,
    /```\s*\n?([\s\S]*?)\n?\s*```/,
    /(\{[^{}]*"consensus_score"\s*:[^{}]*\})/,
  ];

  for (const pattern of jsonPatterns) {
    const match = response.match(pattern);
    if (!match?.[1]) continue;

    try {
      const parsed = JSON.parse(match[1].trim());
      if (typeof parsed.consensus_score === "number") {
        return {
          knight: parsed.knight || knightName,
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

/**
 * Check if consensus is reached: all scores >= threshold AND no pending issues.
 */
export function checkConsensus(blocks: ConsensusBlock[], threshold: number): boolean {
  if (blocks.length === 0) return false;

  return blocks.every(
    (block) =>
      block.consensus_score >= threshold &&
      block.pending_issues.length === 0
  );
}

/**
 * Produce a human-readable summary of the current consensus state.
 */
export function summarizeConsensus(blocks: ConsensusBlock[]): string {
  if (blocks.length === 0) return "No consensus data yet.";

  const lines: string[] = [];

  for (const block of blocks) {
    const status =
      block.consensus_score >= 9
        ? "AGREES"
        : block.consensus_score >= 6
          ? "PARTIAL"
          : "DISAGREES";

    lines.push(
      `- **${block.knight}** (Round ${block.round}): Score ${block.consensus_score}/10 [${status}]`
    );

    if (block.agrees_with.length > 0) {
      lines.push(`  Agrees with: ${block.agrees_with.join(", ")}`);
    }

    if (block.pending_issues.length > 0) {
      lines.push(`  Pending: ${block.pending_issues.join(", ")}`);
    }
  }

  const avgScore =
    blocks.reduce((sum, b) => sum + b.consensus_score, 0) / blocks.length;
  lines.push(`\nAverage score: ${avgScore.toFixed(1)}/10`);

  return lines.join("\n");
}
