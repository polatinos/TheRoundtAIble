import chalk from "chalk";
import type { ValidationIssue, ValidationReport, SegmentInfo } from "../types.js";
import { scanBlocks } from "./block-scanner.js";

// --- Bracket balancing (string-aware state machine) ---

type StringState = "none" | "single" | "double" | "template";

/**
 * Check bracket balance in source code content.
 * String-aware: ignores brackets inside '...', "...", and `...` strings.
 * Tracks (), [], {} — net count per type must be 0.
 */
export function checkBracketBalance(content: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const lines = content.split("\n");

  let stringState: StringState = "none";
  let escaped = false;

  const counts = { "(": 0, ")": 0, "[": 0, "]": 0, "{": 0, "}": 0 };
  const openers = "([{";
  const closers = ")]}";
  const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (ch === "\\") {
        escaped = true;
        continue;
      }

      // String state transitions
      if (stringState === "none") {
        if (ch === "'") { stringState = "single"; continue; }
        if (ch === '"') { stringState = "double"; continue; }
        if (ch === "`") { stringState = "template"; continue; }

        // Skip single-line comments
        if (ch === "/" && i + 1 < line.length) {
          if (line[i + 1] === "/") break; // rest of line is comment
          if (line[i + 1] === "*") {
            // Block comment — skip until */
            const endIdx = content.indexOf("*/", lineIdx === 0 ? i + 2 : lines.slice(0, lineIdx).join("\n").length + i + 2);
            if (endIdx !== -1) {
              // Fast-forward past the comment
              const remaining = content.slice(lines.slice(0, lineIdx).join("\n").length + i + 2, endIdx);
              const newlines = remaining.split("\n").length - 1;
              lineIdx += newlines;
              if (newlines > 0) {
                i = lines[lineIdx]?.length ?? 0; // skip to end of current line after jump
              } else {
                i += (endIdx - (lines.slice(0, lineIdx).join("\n").length + i)) + 1;
              }
            }
            continue;
          }
        }

        // Count brackets
        if (openers.includes(ch) || closers.includes(ch)) {
          counts[ch as keyof typeof counts]++;
        }
      } else if (stringState === "single" && ch === "'") {
        stringState = "none";
      } else if (stringState === "double" && ch === '"') {
        stringState = "none";
      } else if (stringState === "template" && ch === "`") {
        stringState = "none";
      }
    }
  }

  // Check net balance
  const bracketPairs: Array<[string, string, string]> = [
    ["(", ")", "parentheses"],
    ["[", "]", "brackets"],
    ["{", "}", "braces"],
  ];

  for (const [open, close, name] of bracketPairs) {
    const openCount = counts[open as keyof typeof counts];
    const closeCount = counts[close as keyof typeof counts];
    const diff = openCount - closeCount;

    if (diff !== 0) {
      const which = diff > 0 ? `${diff} unclosed '${open}'` : `${Math.abs(diff)} extra '${close}'`;
      issues.push({
        type: "bracket_balance",
        message: `Unbalanced ${name}: ${which} (${openCount} opened, ${closeCount} closed)`,
        line: 0, // whole-file issue
        snippet: `${open}: ${openCount}, ${close}: ${closeCount}`,
      });
    }
  }

  return issues;
}

// --- Artifact detection ---

const ARTIFACT_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /^<{3,7}\s*SEARCH\s*$/m, label: "Leaked <<<< SEARCH marker" },
  { pattern: /^>{3,7}\s*REPLACE\s*$/m, label: "Leaked >>>> REPLACE marker" },
  { pattern: /^={3,7}$/m, label: "Leaked ==== block separator" },
  { pattern: /^<{7}\s/m, label: "Merge conflict marker (<<<<<<<)" },
  { pattern: /^>{7}\s/m, label: "Merge conflict marker (>>>>>>>)" },
  { pattern: /^={7}$/m, label: "Merge conflict marker (=======)" },
  { pattern: /^EDIT:\s+\S/m, label: "Leaked EDIT: directive in code" },
];

/**
 * Detect AI artifacts (leaked markers, merge conflicts) in code content.
 * These patterns should NEVER appear in real code.
 */
export function detectArtifacts(content: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const lines = content.split("\n");

  for (const { pattern, label } of ARTIFACT_PATTERNS) {
    // Reset regex state
    pattern.lastIndex = 0;

    const match = pattern.exec(content);
    if (match) {
      // Find line number
      const beforeMatch = content.slice(0, match.index);
      const lineNum = beforeMatch.split("\n").length;
      const snippetLine = lines[lineNum - 1] || "";

      issues.push({
        type: "artifact_detection",
        message: label,
        line: lineNum,
        snippet: snippetLine.trim(),
      });
    }
  }

  return issues;
}

// --- Duplicate import detection ---

/**
 * Detect duplicate import statements in code content.
 * Simple heuristic: if the exact same import line appears twice, it's a knight bug.
 */
export function detectDuplicateImports(content: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const lines = content.split("\n");
  const importLines = new Map<string, number>(); // normalized → first line number

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Match import statements (JS/TS)
    if (line.startsWith("import ") && (line.includes("from ") || line.includes("require("))) {
      const normalized = line.replace(/\s+/g, " ");

      if (importLines.has(normalized)) {
        const firstLine = importLines.get(normalized)!;
        issues.push({
          type: "duplicate_import",
          message: `Duplicate import (first seen line ${firstLine})`,
          line: i + 1,
          snippet: line,
        });
      } else {
        importLines.set(normalized, i + 1);
      }
    }
  }

  return issues;
}

// --- Structural integrity validation ---

/**
 * Validate structural integrity: ensure class methods haven't been "demoted"
 * to standalone functions, and classes haven't disappeared.
 *
 * This catches the exact failure mode where a knight (especially GPT) reads
 * a class, decides the methods "look like functions", and outputs them as
 * standalone `export function` declarations — destroying the class structure.
 *
 * Rules:
 *   1. Every class in "before" must still exist as a class in "after"
 *   2. Every class_method must still be a class_method — not a standalone function
 *   3. If a class_method name appears as a top-level function, that's "identity demotion"
 *   4. New functions/methods are fine — we only guard against structural demolition
 *   5. Gaps are ignored (whitespace changes don't matter)
 */
export function validateStructuralIntegrity(
  beforeSegments: SegmentInfo[],
  afterContent: string
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Re-scan the staged content to get "after" segments
  const afterResult = scanBlocks(afterContent);
  const afterSegments = afterResult.segments;

  // Build lookup maps
  const afterClasses = new Set(
    afterSegments.filter(s => s.kind === "class").map(s => s.name!)
  );
  const afterMethods = new Set(
    afterSegments.filter(s => s.kind === "class_method").map(s => s.key)
  );
  const afterFunctions = new Set(
    afterSegments.filter(s => s.kind === "function").map(s => s.name!)
  );

  // Check 1: Classes must not disappear
  const beforeClasses = beforeSegments.filter(s => s.kind === "class");
  for (const cls of beforeClasses) {
    if (!afterClasses.has(cls.name!)) {
      issues.push({
        type: "structural_integrity",
        message: `Class '${cls.name}' was removed — structural violation`,
        line: 0,
        snippet: `Before: class ${cls.name} (lines ${cls.startLine}-${cls.endLine})`,
      });
    }
  }

  // Check 2: Class methods must not be demoted to standalone functions
  const beforeMethods = beforeSegments.filter(s => s.kind === "class_method");
  for (const method of beforeMethods) {
    const methodName = method.name!;
    const className = method.className!;

    // Skip if the entire class was already flagged as missing
    if (!afterClasses.has(className)) continue;

    // Check if this method still exists as a class_method
    const stillAMethod = afterSegments.some(
      s => s.kind === "class_method" && s.name === methodName && s.className === className
    );

    if (!stillAMethod) {
      // Check for "identity demotion": method name now appears as a top-level function
      if (afterFunctions.has(methodName)) {
        issues.push({
          type: "structural_integrity",
          message: `Class method '${className}#${methodName}' was demoted to standalone function — identity demotion`,
          line: 0,
          snippet: `Before: class_method ${className}#${methodName}, After: standalone fn:${methodName}`,
        });
      }
      // Note: if the method just disappeared (deleted), that's allowed.
      // We only block the specific case where it was CONVERTED to a function.
    }
  }

  return issues;
}

// --- Combined validation ---

/**
 * Validate a single staged file. Runs all three checks.
 * Optionally runs structural integrity check if beforeSegments are provided.
 */
export function validateStagedFile(
  path: string,
  content: string,
  beforeSegments?: SegmentInfo[]
): ValidationReport {
  const issues: ValidationIssue[] = [
    ...checkBracketBalance(content),
    ...detectArtifacts(content),
    ...detectDuplicateImports(content),
  ];

  // Structural integrity: only if we have "before" segments to compare against
  if (beforeSegments && beforeSegments.length > 0) {
    issues.push(...validateStructuralIntegrity(beforeSegments, content));
  }

  return {
    path,
    issues,
    passed: issues.length === 0,
  };
}

/**
 * Validate all staged files. Returns reports for ALL files (not just failed ones).
 * Does not stop at first failure — shows everything.
 *
 * @param staged - Map of file path → staged content
 * @param beforeSegmentsMap - Optional map of file path → original segments (for structural integrity check)
 */
export function validateAll(
  staged: Map<string, string>,
  beforeSegmentsMap?: Map<string, SegmentInfo[]>
): ValidationReport[] {
  const reports: ValidationReport[] = [];

  for (const [path, content] of staged) {
    const beforeSegments = beforeSegmentsMap?.get(path);
    reports.push(validateStagedFile(path, content, beforeSegments));
  }

  return reports;
}

/**
 * Format validation reports for CLI display.
 * Shows each failed file with its issues and code snippets.
 */
export function formatValidationReport(reports: ValidationReport[]): string {
  const failed = reports.filter((r) => !r.passed);
  if (failed.length === 0) return "";

  const lines: string[] = [
    "",
    chalk.red.bold(`  VALIDATION FAILED — ${failed.length} file(s) have issues:`),
    "",
  ];

  for (const report of failed) {
    lines.push(chalk.red(`  ${report.path} (${report.issues.length} issue(s)):`));

    for (const issue of report.issues) {
      const lineInfo = issue.line > 0 ? ` (line ${issue.line})` : "";
      lines.push(chalk.yellow(`    ${issue.type}${lineInfo}: ${issue.message}`));
      if (issue.snippet) {
        lines.push(chalk.dim(`      > ${issue.snippet}`));
      }
    }
    lines.push("");
  }

  lines.push(chalk.dim("  0 files written. Fix the knight's output or try again."));
  lines.push("");

  return lines.join("\n");
}
