/**
 * Extract a trailing JSON block from a role response.
 *
 * Each role is instructed to end with a fenced ```json ... ``` block,
 * but real LLMs are inconsistent — some emit bare braces, some omit
 * the fence, some put the JSON in the middle. The strategy:
 *
 *   1. Try fenced ```json ``` first.
 *   2. Fall back to balanced-brace scan for the LAST top-level object.
 *   3. Strip JS-style comments before parsing (some adapters add them).
 *   4. On total failure, return null — caller decides what to do.
 *
 * This mirrors the consensus parser's approach (see src/consensus.ts)
 * but is intentionally simpler — advise has fewer fields and no scoring.
 */

export function extractJsonBlock(text: string): unknown | null {
  const cleaned = stripComments(text);

  // 1. Fenced ```json ... ``` block
  const fenced = cleaned.match(/```json\s*([\s\S]*?)```/i);
  if (fenced) {
    const parsed = tryParse(fenced[1]);
    if (parsed) return parsed;
  }

  // 2. Plain ``` ... ``` block (some models drop the language tag)
  const plain = [...cleaned.matchAll(/```\s*([\s\S]*?)```/g)];
  for (const match of plain.reverse()) {
    const parsed = tryParse(match[1]);
    if (parsed && typeof parsed === "object") return parsed;
  }

  // 3. Last top-level { ... } via balanced-brace scan
  const lastObject = findLastBalancedObject(cleaned);
  if (lastObject) {
    const parsed = tryParse(lastObject);
    if (parsed) return parsed;
  }

  return null;
}

function tryParse(raw: string): unknown | null {
  try {
    return JSON.parse(raw.trim());
  } catch {
    return null;
  }
}

function stripComments(text: string): string {
  // Remove // line comments and /* ... */ block comments outside of strings.
  // Cheap heuristic — good enough for LLM output where comments are rare.
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function findLastBalancedObject(text: string): string | null {
  let depth = 0;
  let start = -1;
  let lastObject: string | null = null;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start !== -1) {
        lastObject = text.slice(start, i + 1);
        start = -1;
      }
    }
  }

  return lastObject;
}

/**
 * Strip the trailing JSON block (and any preceding fenced code marker)
 * from a response so the prose half can be displayed cleanly.
 */
export function stripJsonBlock(text: string): string {
  let result = text;

  // Remove the LAST fenced json block
  const fenced = /```json\s*[\s\S]*?```\s*$/i;
  result = result.replace(fenced, "");

  // Remove a final bare-brace object if no fenced block was there
  const lastObj = findLastBalancedObject(result);
  if (lastObj) {
    const idx = result.lastIndexOf(lastObj);
    if (idx >= 0 && idx + lastObj.length >= result.trimEnd().length) {
      result = result.slice(0, idx);
    }
  }

  return result.trim();
}

// --- Typed shape validators for each role ---

export interface ProposalShape {
  recommendation: string;
  why: string[];
  risks: string[];
}

export interface CritiqueShape {
  strongest_objection: string;
  severity: "low" | "medium" | "high";
  would_change_recommendation: boolean;
}

export interface SynthesisShape {
  final_recommendation: string;
  addresses_objection: string;
  confidence: "low" | "medium" | "high";
  disagreement_health: "healthy" | "suspicious-agreement" | "unresolved-conflict";
  open_questions: string[];
}

const SEVERITIES = new Set(["low", "medium", "high"]);
const HEALTHS = new Set(["healthy", "suspicious-agreement", "unresolved-conflict"]);

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function asStringArray(v: unknown, max = 8): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => x.trim())
    .slice(0, max);
}

export function parseProposal(text: string): ProposalShape | null {
  const obj = extractJsonBlock(text);
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;

  const recommendation = asString(o.recommendation);
  if (!recommendation) return null;

  return {
    recommendation,
    why: asStringArray(o.why, 6),
    risks: asStringArray(o.risks, 6),
  };
}

export function parseCritique(text: string): CritiqueShape | null {
  const obj = extractJsonBlock(text);
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;

  const objection = asString(o.strongest_objection);
  if (!objection) return null;

  const severity = typeof o.severity === "string" && SEVERITIES.has(o.severity)
    ? (o.severity as CritiqueShape["severity"])
    : "medium";

  return {
    strongest_objection: objection,
    severity,
    would_change_recommendation: o.would_change_recommendation === true,
  };
}

export function parseSynthesis(text: string): SynthesisShape | null {
  const obj = extractJsonBlock(text);
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;

  const recommendation = asString(o.final_recommendation);
  if (!recommendation) return null;

  const confidence = typeof o.confidence === "string" && SEVERITIES.has(o.confidence)
    ? (o.confidence as SynthesisShape["confidence"])
    : "medium";

  const health = typeof o.disagreement_health === "string" && HEALTHS.has(o.disagreement_health)
    ? (o.disagreement_health as SynthesisShape["disagreement_health"])
    : "healthy";

  return {
    final_recommendation: recommendation,
    addresses_objection: asString(o.addresses_objection) || "",
    confidence,
    disagreement_health: health,
    open_questions: asStringArray(o.open_questions, 8),
  };
}
