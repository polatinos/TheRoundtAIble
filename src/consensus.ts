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
 * Extract balanced JSON objects containing a required key.
 * Handles nested braces correctly using a state machine parser.
 */
function extractBalancedJson(input: string, key: string): string[] {
  const keyToken = `"${key}"`;
  const candidates: string[] = [];

  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (ch === "\\") { escaped = true; continue; }
      if (ch === '"') { inString = false; }
      continue;
    }

    if (ch === '"') { inString = true; continue; }

    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
      continue;
    }

    if (ch === "}") {
      if (depth === 0) continue;
      depth--;
      if (depth === 0 && start >= 0) {
        const candidate = input.slice(start, i + 1);
        if (candidate.includes(keyToken)) {
          candidates.push(candidate);
        }
        start = -1;
      }
    }
  }

  return candidates;
}

/**
 * Parse a consensus JSON block from an LLM response string.
 * Tries fenced code blocks first, then balanced JSON extraction as fallback.
 */
export function parseConsensusFromResponse(
  response: string,
  knightName: string,
  round: number
): ConsensusBlock | null {
  // Pattern 1 & 2: fenced code blocks (these work fine for most cases)
  const fencedPatterns = [
    /```json\s*\n?([\s\S]*?)\n?\s*```/,
    /```\s*\n?([\s\S]*?)\n?\s*```/,
  ];

  for (const pattern of fencedPatterns) {
    const match = response.match(pattern);
    if (!match?.[1]) continue;

    const result = tryParseConsensus(match[1].trim(), knightName, round);
    if (result) return result;
  }

  // Fallback: balanced brace extraction (handles nested objects)
  const candidates = extractBalancedJson(response, "consensus_score");
  for (const candidate of candidates) {
    const result = tryParseConsensus(candidate, knightName, round);
    if (result) return result;
  }

  return null;
}

/**
 * Try to parse a JSON string into a ConsensusBlock.
 */
/**
 * Filter out non-meaningful entries from pending_issues.
 * LLMs often write ["none"], ["no issues"], ["n/a"] instead of [].
 */
function sanitizePendingIssues(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];

  const meaningless = new Set([
    "", "none", "no", "n/a", "na", "nil", "null", "-",
    "no issues", "no open issues", "no pending issues",
    "geen", "geen issues", "geen open issues",
    "all resolved", "all issues resolved", "resolved",
    "nothing", "no concerns", "no remaining issues",
  ]);

  return raw
    .filter((item): item is string => typeof item === "string")
    .map((s) => s.trim())
    .filter((s) => !meaningless.has(s.toLowerCase()));
}

function tryParseConsensus(
  json: string,
  knightName: string,
  round: number
): ConsensusBlock | null {
  // Try raw first, then repaired (handles comments, trailing commas, single quotes)
  for (const attempt of [json, repairJson(json)]) {
    const result = parseConsensusJson(attempt, knightName, round);
    if (result) return result;
  }
  return null;
}

function parseConsensusJson(
  json: string,
  knightName: string,
  round: number
): ConsensusBlock | null {
  try {
    const parsed = JSON.parse(json);
    if (typeof parsed.consensus_score === "number") {
      return {
        knight: parsed.knight || knightName,
        round: parsed.round || round,
        consensus_score: parsed.consensus_score,
        agrees_with: Array.isArray(parsed.agrees_with) ? parsed.agrees_with : [],
        pending_issues: sanitizePendingIssues(parsed.pending_issues),
        proposal: parsed.proposal,
        files_to_modify: validateFilesToModify(parsed.files_to_modify),
        file_requests: Array.isArray(parsed.file_requests) ? parsed.file_requests.slice(0, 4) : [],
        verify_commands: Array.isArray(parsed.verify_commands) ? parsed.verify_commands.slice(0, 4) : [],
      };
    }
  } catch {
    // Invalid JSON
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
 * Attempt to repair broken JSON from LLM output.
 * - Strip single-line comments (// ...)
 * - Strip trailing commas before } or ]
 * - Replace single quotes with double quotes
 */
function repairJson(raw: string): string {
  return raw
    .replace(/\/\/[^\n]*/g, "")       // strip // comments (local LLMs love these)
    .replace(/,\s*([}\]])/g, "$1")    // strip trailing commas
    .replace(/'/g, '"');              // single → double quotes
}

/**
 * Parse a diagnostic JSON block from an LLM response string.
 */
export function parseDiagnosticFromResponse(
  response: string,
  knightName: string,
  round: number
): DiagnosticBlock | null {
  // Fenced code blocks first
  const fencedPatterns = [
    /```json\s*\n?([\s\S]*?)\n?\s*```/,
    /```\s*\n?([\s\S]*?)\n?\s*```/,
  ];

  for (const pattern of fencedPatterns) {
    const match = response.match(pattern);
    if (!match?.[1]) continue;

    const result = tryParseDiagnostic(match[1].trim(), knightName, round);
    if (result) return result;
  }

  // Fallback: balanced brace extraction (handles nested objects)
  const candidates = extractBalancedJson(response, "confidence_score");
  for (const candidate of candidates) {
    const result = tryParseDiagnostic(candidate, knightName, round);
    if (result) return result;
  }

  return null;
}

/**
 * Try to parse a JSON string into a DiagnosticBlock.
 */
function tryParseDiagnostic(
  json: string,
  knightName: string,
  round: number
): DiagnosticBlock | null {
  for (const attempt of [json, repairJson(json)]) {
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
