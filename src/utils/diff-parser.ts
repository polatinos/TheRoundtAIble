import type { BlockOperation, BlockOpType, ParsedRtdiff, PatchResult, SegmentInfo } from "../types.js";
import { findSegment } from "./block-scanner.js";
import { parseCodeBlocks } from "./file-writer.js";

/**
 * RTDIFF v1.1 Parser + Executor
 *
 * Parses knight output in the RTDIFF/1 block-operation format and applies
 * patches by resolving segment keys to line ranges.
 *
 * Supported operations:
 *   BLOCK_REPLACE: path :: segmentKey     — replace segment content
 *   BLOCK_INSERT_AFTER: path :: segmentKey — insert content after segment
 *   BLOCK_DELETE: path :: segmentKey       — delete segment
 *   PREAMBLE_REPLACE: path                 — replace preamble (sugar for BLOCK_REPLACE :: preamble)
 *
 * Format:
 *   BLOCK_REPLACE: src/utils/file-writer.ts :: fn:writeFiles
 *   ---
 *   export async function writeFiles(...) {
 *     // new implementation
 *   }
 *   ---
 *
 * FILE: blocks for new files are also supported (backward compat).
 */

// --- Parser ---

const RTDIFF_HEADER_RE = /^RTDIFF\/1\s*$/;
const BLOCK_OP_RE = /^(BLOCK_REPLACE|BLOCK_INSERT_AFTER|BLOCK_DELETE)\s*:\s*(.+?)\s*::\s*(.+)$/;
const PREAMBLE_OP_RE = /^PREAMBLE_REPLACE\s*:\s*(.+)$/;
const CONTENT_DELIMITER = /^-{3,}$/;

type ParserState = "IDLE" | "EXPECTING_CONTENT" | "IN_CONTENT";

/**
 * Parse an RTDIFF/1 response from the knight.
 * Also extracts FILE: blocks for new files.
 */
export function parseRtdiff(response: string): ParsedRtdiff {
  const operations: BlockOperation[] = [];
  const lines = response.split("\n");

  let state: ParserState = "IDLE";
  let currentOp: { type: BlockOpType; filePath: string; segmentKey: string } | null = null;
  let contentLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    switch (state) {
      case "IDLE": {
        // Skip RTDIFF/1 header
        if (RTDIFF_HEADER_RE.test(line.trim())) continue;

        // Try block operation
        const blockMatch = line.match(BLOCK_OP_RE);
        if (blockMatch) {
          const type = blockMatch[1] as BlockOpType;
          const filePath = blockMatch[2].trim();
          const segmentKey = blockMatch[3].trim();

          if (type === "BLOCK_DELETE") {
            // DELETE has no content section
            operations.push({ type, filePath, segmentKey });
          } else {
            currentOp = { type, filePath, segmentKey };
            state = "EXPECTING_CONTENT";
          }
          continue;
        }

        // Try preamble operation
        const preambleMatch = line.match(PREAMBLE_OP_RE);
        if (preambleMatch) {
          currentOp = {
            type: "PREAMBLE_REPLACE",
            filePath: preambleMatch[1].trim(),
            segmentKey: "preamble",
          };
          state = "EXPECTING_CONTENT";
          continue;
        }
        break;
      }

      case "EXPECTING_CONTENT": {
        if (CONTENT_DELIMITER.test(line.trim())) {
          contentLines = [];
          state = "IN_CONTENT";
        } else if (line.trim() === "") {
          // Allow blank lines between header and content delimiter
        } else {
          // Not valid, reset
          currentOp = null;
          state = "IDLE";
        }
        break;
      }

      case "IN_CONTENT": {
        if (CONTENT_DELIMITER.test(line.trim())) {
          // End of content block
          if (currentOp) {
            operations.push({
              type: currentOp.type,
              filePath: currentOp.filePath,
              segmentKey: currentOp.segmentKey,
              content: contentLines.join("\n"),
            });
          }
          currentOp = null;
          contentLines = [];
          state = "IDLE";
        } else {
          contentLines.push(line);
        }
        break;
      }
    }
  }

  // Extract FILE: blocks for new files
  const allFiles = parseCodeBlocks(response);
  const opPaths = new Set(operations.map(o => o.filePath));
  const newFiles = allFiles
    .filter(f => !opPaths.has(f.path))
    .map(f => ({ path: f.path, content: f.content }));

  return { operations, newFiles };
}

// --- Executor ---

/**
 * Apply a single BLOCK_REPLACE operation to file content.
 * Replaces lines startLine..endLine with new content.
 */
function applyBlockReplace(
  lines: string[],
  segment: SegmentInfo,
  newContent: string
): string[] {
  const before = lines.slice(0, segment.startLine - 1);
  const after = lines.slice(segment.endLine);
  const replacement = newContent.split("\n");
  return [...before, ...replacement, ...after];
}

/**
 * Apply a single BLOCK_INSERT_AFTER operation to file content.
 * Inserts new content after the segment's end line.
 */
function applyBlockInsertAfter(
  lines: string[],
  segment: SegmentInfo,
  newContent: string
): string[] {
  const before = lines.slice(0, segment.endLine);
  const after = lines.slice(segment.endLine);
  const insertion = newContent.split("\n");
  return [...before, "", ...insertion, ...after];
}

/**
 * Apply a single BLOCK_DELETE operation to file content.
 * Removes lines startLine..endLine.
 */
function applyBlockDelete(
  lines: string[],
  segment: SegmentInfo
): string[] {
  const before = lines.slice(0, segment.startLine - 1);
  const after = lines.slice(segment.endLine);
  return [...before, ...after];
}

/**
 * Apply all RTDIFF operations for a single file.
 *
 * Operations are grouped by file and applied in reverse line order
 * (bottom-to-top) so that line numbers remain valid after each operation.
 *
 * @param content - Original file content
 * @param operations - Operations targeting this file
 * @param segments - Scan result segments for this file
 * @returns PatchResult with new content or error
 */
export function applyBlockOperations(
  content: string,
  operations: BlockOperation[],
  segments: SegmentInfo[]
): PatchResult {
  // Validate all targets exist before applying anything
  for (const op of operations) {
    const segment = findSegment(segments, op.segmentKey);
    if (!segment) {
      return {
        path: op.filePath,
        success: false,
        error: `PatchTargetError: segment "${op.segmentKey}" not found in ${op.filePath}. Available segments: ${segments.map(s => s.key).join(", ")}`,
      };
    }
  }

  // Sort operations by start line DESCENDING (apply bottom-to-top)
  // This preserves line numbers for earlier operations
  const sortedOps = [...operations].sort((a, b) => {
    const segA = findSegment(segments, a.segmentKey)!;
    const segB = findSegment(segments, b.segmentKey)!;
    return segB.startLine - segA.startLine;
  });

  let lines = content.split("\n");

  for (const op of sortedOps) {
    const segment = findSegment(segments, op.segmentKey)!;

    switch (op.type) {
      case "BLOCK_REPLACE":
      case "PREAMBLE_REPLACE":
        if (!op.content && op.content !== "") {
          return {
            path: op.filePath,
            success: false,
            error: `BLOCK_REPLACE for "${op.segmentKey}" has no content`,
          };
        }
        lines = applyBlockReplace(lines, segment, op.content!);
        break;

      case "BLOCK_INSERT_AFTER":
        if (!op.content && op.content !== "") {
          return {
            path: op.filePath,
            success: false,
            error: `BLOCK_INSERT_AFTER for "${op.segmentKey}" has no content`,
          };
        }
        lines = applyBlockInsertAfter(lines, segment, op.content!);
        break;

      case "BLOCK_DELETE":
        lines = applyBlockDelete(lines, segment);
        break;
    }
  }

  return {
    path: operations[0].filePath,
    success: true,
    content: lines.join("\n"),
  };
}

/**
 * Check if a response contains RTDIFF operations.
 * Used to determine which parser to use.
 */
export function isRtdiffResponse(response: string): boolean {
  // Use multiline-aware patterns (the parser regexes use ^ without m flag)
  return /^(BLOCK_REPLACE|BLOCK_INSERT_AFTER|BLOCK_DELETE)\s*:/m.test(response)
    || /^PREAMBLE_REPLACE\s*:/m.test(response)
    || RTDIFF_HEADER_RE.test(response.trim().split("\n")[0] || "");
}

/**
 * Check if a response contains legacy EDIT: blocks.
 */
export function isLegacyEditResponse(response: string): boolean {
  return /^EDIT:\s+\S/m.test(response);
}
