import chalk from "chalk";
import type { ValidationIssue, ValidationReport } from "../types.js";

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

// --- Combined validation ---

/**
 * Validate a single staged file. Runs all three checks.
 */
export function validateStagedFile(path: string, content: string): ValidationReport {
  const issues: ValidationIssue[] = [
    ...checkBracketBalance(content),
    ...detectArtifacts(content),
    ...detectDuplicateImports(content),
  ];

  return {
    path,
    issues,
    passed: issues.length === 0,
  };
}

/**
 * Validate all staged files. Returns reports for ALL files (not just failed ones).
 * Does not stop at first failure — shows everything.
 */
export function validateAll(staged: Map<string, string>): ValidationReport[] {
  const reports: ValidationReport[] = [];

  for (const [path, content] of staged) {
    reports.push(validateStagedFile(path, content));
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
