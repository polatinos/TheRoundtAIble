import chalk from "chalk";
import type { ConsensusBlock, DiagnosticBlock } from "./types.js";

/**
 * Validate and normalize a files_to_modify array from a consensus block.
 * - Relative paths only, forward slashes, no "..", dedupe
 * - NEW: prefix detection and normalization
 * - Invalid paths are silently skipped
 */
export function validateFilesToModify(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of raw) {
    if (typeof item !== "string") continue;

    let path = item.trim();
    if (!path) continue;

    // Detect NEW: prefix
    let isNew = false;
    if (path.toUpperCase().startsWith("NEW:")) {
      isNew = true;
      path = path.slice(4).trim();
    }

    // Normalize: forward slashes, remove leading ./
    path = path.replace(/\\/g, "/");
    if (path.startsWith("./")) path = path.slice(2);

    // Security: reject absolute paths and path traversal
    if (path.startsWith("/") || path.includes("..")) continue;

    // Reject empty after normalization
    if (!path) continue;

    // Re-add NEW: prefix if detected
    const normalized = isNew ? `NEW:${path}` : path;

    // Dedupe
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

/**
 * Warn (but don't block) if a knight has score >= 9 but no files_to_modify.
 */
export function warnMissingScopeAtConsensus(block: ConsensusBlock): void {
  if (
    block.consensus_score >= 9 &&
    (!block.files_to_modify || block.files_to_modify.length === 0)
  ) {
    console.log(
      chalk.yellow(
        `  Warning: ${block.knight} agreed (score ${block.consensus_score}) but didn't specify files_to_modify. Scope enforcement will be skipped for this knight.`
      )
    );
  }
}

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
          files_to_modify: validateFilesToModify(parsed.files_to_modify),
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

    if (block.files_to_modify && block.files_to_modify.length > 0) {
      lines.push(`  Scope: ${block.files_to_modify.join(", ")}`);
    }
  }

  const avgScore =
    blocks.reduce((sum, b) => sum + b.consensus_score, 0) / blocks.length;
  lines.push(`\nAverage score: ${avgScore.toFixed(1)}/10`);

  return lines.join("\n");
}

// --- Diagnostic parsing for code-red mode ---

/**
 * Validate a root_cause_key: lowercase kebab-case, max 60 chars.
 */
export function isValidRootCauseKey(key: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(key) && key.length <= 60;
}

/**
 * Dice coefficient for fuzzy string matching.
 * Returns 0-1 (1 = identical).
 */
export function fuzzyMatch(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const bigrams = (str: string): Set<string> => {
    const set = new Set<string>();
    for (let i = 0; i < str.length - 1; i++) {
      set.add(str.slice(i, i + 2));
    }
    return set;
  };

  const setA = bigrams(a);
  const setB = bigrams(b);
  let intersection = 0;
  for (const bg of setA) {
    if (setB.has(bg)) intersection++;
  }

  return (2 * intersection) / (setA.size + setB.size);
}

/**
 * Attempt to repair broken JSON: strip trailing commas before } or ].
 */
function repairJson(raw: string): string {
  return raw
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/'/g, '"');
}

/**
 * Parse a diagnostic JSON block from an LLM response string.
 */
export function parseDiagnosticFromResponse(
  response: string,
  knightName: string,
  round: number
): DiagnosticBlock | null {
  const jsonPatterns = [
    /```json\s*\n?([\s\S]*?)\n?\s*```/,
    /```\s*\n?([\s\S]*?)\n?\s*```/,
    /(\{[^{}]*"confidence_score"\s*:[\s\S]*?\})/,
  ];

  for (const pattern of jsonPatterns) {
    const match = response.match(pattern);
    if (!match?.[1]) continue;

    let raw = match[1].trim();

    // Try direct parse, then repaired parse
    for (const attempt of [raw, repairJson(raw)]) {
      try {
        const parsed = JSON.parse(attempt);
        if (typeof parsed.confidence_score === "number" && parsed.root_cause_key) {
          const rootCauseKey = String(parsed.root_cause_key).toLowerCase().replace(/\s+/g, "-");
          return {
            knight: parsed.knight || knightName,
            round: parsed.round || round,
            confidence_score: Math.min(10, Math.max(0, parsed.confidence_score)),
            root_cause_key: isValidRootCauseKey(rootCauseKey) ? rootCauseKey : "parse-error",
            evidence: Array.isArray(parsed.evidence) ? parsed.evidence : [],
            rules_out: Array.isArray(parsed.rules_out) ? parsed.rules_out : [],
            confirms: Array.isArray(parsed.confirms) ? parsed.confirms : [],
            file_requests: Array.isArray(parsed.file_requests) ? parsed.file_requests.slice(0, 4) : [],
            next_test: typeof parsed.next_test === "string" ? parsed.next_test : "",
          };
        }
      } catch {
        // Try next
      }
    }
  }

  return null;
}

/**
 * Check if diagnostic convergence is reached:
 * 2+ knights same root_cause_key (exact or fuzzy >= 0.7) AND confidence >= 8.
 */
export function checkDiagnosticConvergence(
  blocks: DiagnosticBlock[]
): { converged: boolean; rootCauseKey: string | null } {
  if (blocks.length < 2) return { converged: false, rootCauseKey: null };

  // Only consider blocks with confidence >= 8
  const highConfidence = blocks.filter((b) => b.confidence_score >= 8);
  if (highConfidence.length < 2) return { converged: false, rootCauseKey: null };

  // Check exact matches first
  const keyCounts = new Map<string, number>();
  for (const b of highConfidence) {
    keyCounts.set(b.root_cause_key, (keyCounts.get(b.root_cause_key) || 0) + 1);
  }

  for (const [key, count] of keyCounts) {
    if (count >= 2) return { converged: true, rootCauseKey: key };
  }

  // Fuzzy match fallback
  for (let i = 0; i < highConfidence.length; i++) {
    for (let j = i + 1; j < highConfidence.length; j++) {
      const similarity = fuzzyMatch(
        highConfidence[i].root_cause_key,
        highConfidence[j].root_cause_key
      );
      if (similarity >= 0.7) {
        // Use the shorter key as canonical
        const canonical =
          highConfidence[i].root_cause_key.length <= highConfidence[j].root_cause_key.length
            ? highConfidence[i].root_cause_key
            : highConfidence[j].root_cause_key;
        return { converged: true, rootCauseKey: canonical };
      }
    }
  }

  return { converged: false, rootCauseKey: null };
}
