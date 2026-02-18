import type { EditOperation, ParsedEdit, EditApplyResult, ParsedKnightOutput } from "../types.js";
import { parseCodeBlocks, type ParsedFile } from "./file-writer.js";

// --- State machine for parsing EDIT: blocks ---

type ParserState =
  | "IDLE"
  | "EDIT_HEADER"
  | "EXPECTING_SEARCH"
  | "IN_SEARCH"
  | "IN_REPLACE";

const EDIT_HEADER_RE = /^EDIT:\s*(.+)$/;
const SEARCH_START_RE = /^<{3,4}\s*SEARCH\s*$/;
const REPLACE_START_RE = /^>{3,4}\s*REPLACE\s*$/;
const BLOCK_END_RE = /^={3,6}$/;

/**
 * Parse EDIT: blocks with <<<< SEARCH / >>>> REPLACE / ==== markers.
 * Supports multiple edits per file and multiple files per response.
 */
export function parseEditBlocks(response: string): ParsedEdit[] {
  const editMap = new Map<string, EditOperation[]>();
  const lines = response.split("\n");

  let state: ParserState = "IDLE";
  let currentPath = "";
  let searchLines: string[] = [];
  let replaceLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    switch (state) {
      case "IDLE": {
        const headerMatch = line.match(EDIT_HEADER_RE);
        if (headerMatch) {
          currentPath = headerMatch[1].trim();
          state = "EDIT_HEADER";
        }
        break;
      }

      case "EDIT_HEADER": {
        if (SEARCH_START_RE.test(line)) {
          searchLines = [];
          state = "IN_SEARCH";
        } else if (line.trim() === "") {
          // Allow blank lines between EDIT: header and first SEARCH
        } else {
          // Not a valid edit block, reset
          state = "IDLE";
        }
        break;
      }

      case "EXPECTING_SEARCH": {
        if (SEARCH_START_RE.test(line)) {
          searchLines = [];
          state = "IN_SEARCH";
        } else if (line.trim() === "") {
          // Allow blank lines between edits
        } else {
          // No more edits for this file, check if new EDIT: header
          const headerMatch = line.match(EDIT_HEADER_RE);
          if (headerMatch) {
            currentPath = headerMatch[1].trim();
            state = "EDIT_HEADER";
          } else {
            state = "IDLE";
          }
        }
        break;
      }

      case "IN_SEARCH": {
        if (REPLACE_START_RE.test(line)) {
          replaceLines = [];
          state = "IN_REPLACE";
        } else {
          searchLines.push(line);
        }
        break;
      }

      case "IN_REPLACE": {
        if (BLOCK_END_RE.test(line)) {
          // Commit this edit
          const search = searchLines.join("\n");
          const replace = replaceLines.join("\n");

          if (!editMap.has(currentPath)) {
            editMap.set(currentPath, []);
          }
          editMap.get(currentPath)!.push({ search, replace });

          searchLines = [];
          replaceLines = [];
          state = "EXPECTING_SEARCH";
        } else {
          replaceLines.push(line);
        }
        break;
      }
    }
  }

  // Convert map to array
  const result: ParsedEdit[] = [];
  for (const [path, edits] of editMap) {
    result.push({ path, edits });
  }
  return result;
}

// --- Apply edits to content ---

/**
 * Normalize whitespace for fuzzy matching:
 * trim each line, collapse multiple spaces to one.
 */
function normalizeWhitespace(text: string): string {
  return text
    .split("\n")
    .map((line) => line.trim().replace(/\s+/g, " "))
    .join("\n");
}

/**
 * Apply a list of edits sequentially to file content.
 * Each edit searches for an exact substring match, with fuzzy fallback.
 * Returns the result with info about any failed edits.
 */
export function applyEdits(
  originalContent: string,
  edits: EditOperation[],
  filePath: string
): EditApplyResult {
  let content = originalContent;
  const failedEdits: number[] = [];
  const errors: string[] = [];

  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i];

    // Try exact match first
    const idx = content.indexOf(edit.search);
    if (idx !== -1) {
      content =
        content.slice(0, idx) +
        edit.replace +
        content.slice(idx + edit.search.length);
      continue;
    }

    // Fuzzy: normalize whitespace and try again
    const normalizedContent = normalizeWhitespace(content);
    const normalizedSearch = normalizeWhitespace(edit.search);
    const fuzzyIdx = normalizedContent.indexOf(normalizedSearch);

    if (fuzzyIdx !== -1) {
      // Find the corresponding range in original content.
      // Map normalized index back to original by counting through both strings.
      let origStart = -1;
      let origEnd = -1;
      let normPos = 0;

      // Walk through original content, tracking normalized position
      for (let oi = 0; oi <= content.length && normPos <= fuzzyIdx + normalizedSearch.length; oi++) {
        if (normPos === fuzzyIdx && origStart === -1) {
          origStart = oi;
        }
        if (normPos === fuzzyIdx + normalizedSearch.length) {
          origEnd = oi;
          break;
        }

        if (oi < content.length) {
          const ch = content[oi];
          // Advance normPos in the same way normalizeWhitespace transforms chars
          if (ch === "\n") {
            normPos++;
            // Skip leading whitespace of next line in original
            while (oi + 1 < content.length && (content[oi + 1] === " " || content[oi + 1] === "\t")) {
              oi++;
            }
          } else if (ch === " " || ch === "\t") {
            // Collapse spaces: skip additional spaces in original
            normPos++;
            while (oi + 1 < content.length && (content[oi + 1] === " " || content[oi + 1] === "\t")) {
              oi++;
            }
          } else {
            normPos++;
          }
        }
      }

      if (origStart !== -1 && origEnd !== -1) {
        content =
          content.slice(0, origStart) +
          edit.replace +
          content.slice(origEnd);
        continue;
      }
    }

    // Failed
    failedEdits.push(i);
    const preview = edit.search.split("\n").slice(0, 3).join("\n");
    errors.push(`Edit ${i + 1}: SEARCH not found in ${filePath}:\n  ${preview}`);
  }

  return {
    path: filePath,
    success: failedEdits.length === 0,
    content,
    failedEdits: failedEdits.length > 0 ? failedEdits : undefined,
    errors: errors.length > 0 ? errors : undefined,
  };
}

// --- Combined parser ---

/**
 * Parse a knight's response for both EDIT: and FILE: blocks.
 * EDIT: blocks are for modifying existing files (search-and-replace).
 * FILE: blocks are for creating new files (complete content).
 * If a path appears in both, EDIT: wins.
 */
export function parseKnightOutput(response: string): ParsedKnightOutput {
  const edits = parseEditBlocks(response);
  const allFiles = parseCodeBlocks(response);

  // Deduplicate: if a path has EDIT: blocks, remove it from FILE: results
  const editPaths = new Set(edits.map((e) => e.path));
  const files = allFiles.filter((f) => !editPaths.has(f.path));

  return { files, edits };
}
