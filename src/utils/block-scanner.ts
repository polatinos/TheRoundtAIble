import type { SegmentInfo, SegmentKind, ScanResult } from "../types.js";

/**
 * Bracket-balanced block scanner with string/comment awareness.
 *
 * Scans a source file and produces a flat list of segments:
 *   - preamble: everything before the first named block (imports, top-level constants)
 *   - fn:name: top-level function or arrow function export
 *   - class:Name: entire class block
 *   - class:Name#method: class method (inside class scope)
 *   - gap:N: unnamed code between named blocks (top-level constants, type aliases, etc.)
 *
 * The scanner uses a state machine that tracks:
 *   - Bracket depth ({} nesting level)
 *   - String state (single/double/template quotes)
 *   - Comment state (line comments //, block comments)
 *
 * This is NOT a full AST parser — it detects block boundaries via bracket counting
 * and keyword matching. Good enough for TypeScript/JavaScript, not meant for all languages.
 */

// --- String/comment state machine ---

type QuoteState = "none" | "single" | "double" | "template";

interface ScannerState {
  depth: number;        // current brace depth (0 = top level)
  quoteState: QuoteState;
  inBlockComment: boolean;
  escaped: boolean;
}

// --- Block detection patterns ---

// Matches: export function name(, export async function name(, function name(
const FUNCTION_RE = /^(?:export\s+)?(?:async\s+)?function\s*\*?\s+(\w+)\s*(?:<[^>]*>)?\s*\(/;

// Matches: export const name = (...) =>, export const name = async (...) =>
// Also: export const name: Type = (...) =>
const ARROW_EXPORT_RE = /^export\s+(?:const|let|var)\s+(\w+)\s*(?::[^=]+)?\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>/;

// Broader arrow: export const name = async ( or export const name = (
// We detect the opening, then track the brace to find the block end
const ARROW_EXPORT_START_RE = /^export\s+(?:const|let|var)\s+(\w+)\s*(?::[^=]+)?\s*=\s*/;

// Matches: export class Name, class Name, export abstract class Name
const CLASS_RE = /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/;

// Matches: export interface Name, interface Name
const INTERFACE_RE = /^(?:export\s+)?interface\s+(\w+)/;

// Matches: export type Name, type Name
const TYPE_RE = /^(?:export\s+)?type\s+(\w+)\s*(?:<[^>]*>)?\s*=/;

// Matches: export enum Name, enum Name
const ENUM_RE = /^(?:export\s+)?(?:const\s+)?enum\s+(\w+)/;

// Matches: export default function/class/async function
const EXPORT_DEFAULT_RE = /^export\s+default\s+(?:async\s+)?(?:function|class)\s*(\w*)/;

// Class method patterns (at depth 1 inside a class)
// Matches: methodName(, async methodName(, get methodName(, set methodName(
// Also: static methodName(, private methodName(, public methodName(, protected methodName(
const METHOD_RE = /^(?:(?:static|private|public|protected|readonly|abstract|override)\s+)*(?:async\s+)?(?:get\s+|set\s+)?(?:\*\s*)?(\w+)\s*(?:<[^>]*>)?\s*\(/;

// Constructor
const CONSTRUCTOR_RE = /^\s*constructor\s*\(/;

/**
 * Advance the scanner state through one character.
 * Returns true if this character is "active code" (not in string/comment).
 */
function advanceChar(ch: string, nextCh: string | undefined, state: ScannerState): boolean {
  // Handle escape sequences
  if (state.escaped) {
    state.escaped = false;
    return false;
  }

  if (ch === "\\") {
    if (state.quoteState !== "none") {
      state.escaped = true;
    }
    return false;
  }

  // Block comment state
  if (state.inBlockComment) {
    if (ch === "*" && nextCh === "/") {
      state.inBlockComment = false;
      // Note: caller should skip next char
    }
    return false;
  }

  // String state
  if (state.quoteState === "single") {
    if (ch === "'") state.quoteState = "none";
    return false;
  }
  if (state.quoteState === "double") {
    if (ch === '"') state.quoteState = "none";
    return false;
  }
  if (state.quoteState === "template") {
    if (ch === "`") state.quoteState = "none";
    // Note: template literal ${} expressions are not fully handled,
    // but for bracket counting at top level this is good enough.
    return false;
  }

  // Start of string
  if (ch === "'") { state.quoteState = "single"; return false; }
  if (ch === '"') { state.quoteState = "double"; return false; }
  if (ch === "`") { state.quoteState = "template"; return false; }

  // Start of comment
  if (ch === "/" && nextCh === "/") {
    return false; // line comment — caller handles skipping rest of line
  }
  if (ch === "/" && nextCh === "*") {
    state.inBlockComment = true;
    return false;
  }

  // Active code — track braces
  if (ch === "{") state.depth++;
  if (ch === "}") state.depth--;

  return true;
}

/**
 * Process a line through the scanner state, tracking bracket depth.
 * Returns the depth AFTER processing this line.
 */
function processLine(line: string, state: ScannerState): void {
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const nextCh = i + 1 < line.length ? line[i + 1] : undefined;

    const isActive = advanceChar(ch, nextCh, state);

    // Skip rest of line for line comments
    if (isActive && ch === "/" && nextCh === "/") {
      break;
    }

    // Skip next char for block comment end (*/)
    if (!state.inBlockComment && ch === "*" && nextCh === "/" && i > 0) {
      // Already handled in advanceChar
    }

    // Skip next char for block comment start (/*)
    if (state.inBlockComment && ch === "/" && nextCh === "*") {
      i++; // skip the *
    }

    // Skip next char for block comment end
    if (!state.inBlockComment && ch === "*" && nextCh === "/") {
      i++; // skip the /
    }
  }
}

/**
 * Detect what kind of block starts on this line (at top level, depth 0).
 * Returns segment info or null if no block detected.
 */
function detectBlockStart(
  trimmedLine: string,
  lineNum: number,
  currentClassName: string | null,
  depth: number
): { kind: SegmentKind; name: string; key: string; className?: string } | null {
  // At depth 0: detect top-level declarations
  if (depth === 0) {
    // Export default function/class
    const defaultMatch = trimmedLine.match(EXPORT_DEFAULT_RE);
    if (defaultMatch) {
      const name = defaultMatch[1] || "default";
      const isClass = trimmedLine.includes("class");
      return {
        kind: isClass ? "class" : "function",
        name,
        key: isClass ? `class:${name}` : `fn:${name}`,
      };
    }

    // Class
    const classMatch = trimmedLine.match(CLASS_RE);
    if (classMatch) {
      return { kind: "class", name: classMatch[1], key: `class:${classMatch[1]}` };
    }

    // Function
    const funcMatch = trimmedLine.match(FUNCTION_RE);
    if (funcMatch) {
      return { kind: "function", name: funcMatch[1], key: `fn:${funcMatch[1]}` };
    }

    // Arrow function export (check if line has => or if brace follows)
    const arrowStartMatch = trimmedLine.match(ARROW_EXPORT_START_RE);
    if (arrowStartMatch) {
      // Check if it's a function-like value (contains => or has opening brace)
      const rest = trimmedLine.slice(arrowStartMatch[0].length);
      if (rest.includes("=>") || rest.includes("{") || rest.includes("(")) {
        return { kind: "function", name: arrowStartMatch[1], key: `fn:${arrowStartMatch[1]}` };
      }
    }

    // Interface
    const ifaceMatch = trimmedLine.match(INTERFACE_RE);
    if (ifaceMatch) {
      return { kind: "function", name: ifaceMatch[1], key: `fn:${ifaceMatch[1]}` };
    }

    // Enum
    const enumMatch = trimmedLine.match(ENUM_RE);
    if (enumMatch) {
      return { kind: "function", name: enumMatch[1], key: `fn:${enumMatch[1]}` };
    }

    // Type alias (multi-line)
    const typeMatch = trimmedLine.match(TYPE_RE);
    if (typeMatch && (trimmedLine.includes("{") || trimmedLine.includes("("))) {
      return { kind: "function", name: typeMatch[1], key: `fn:${typeMatch[1]}` };
    }
  }

  // At depth 1 inside a class: detect methods
  if (depth === 1 && currentClassName) {
    // Constructor
    if (CONSTRUCTOR_RE.test(trimmedLine)) {
      return {
        kind: "class_method",
        name: "constructor",
        key: `class:${currentClassName}#constructor`,
        className: currentClassName,
      };
    }

    // Regular method
    const methodMatch = trimmedLine.match(METHOD_RE);
    if (methodMatch) {
      // Filter out keywords that aren't method names
      const name = methodMatch[1];
      if (!["if", "else", "for", "while", "switch", "return", "throw", "new", "delete", "typeof", "import", "export", "const", "let", "var"].includes(name)) {
        return {
          kind: "class_method",
          name,
          key: `class:${currentClassName}#${name}`,
          className: currentClassName,
        };
      }
    }
  }

  return null;
}

/**
 * Scan a source file and produce a list of segments.
 *
 * @param content - File content as string
 * @returns ScanResult with segments array and preamble info
 */
export function scanBlocks(content: string): ScanResult {
  const lines = content.split("\n");
  const segments: SegmentInfo[] = [];

  const state: ScannerState = {
    depth: 0,
    quoteState: "none",
    inBlockComment: false,
    escaped: false,
  };

  // Track current blocks
  let currentClassName: string | null = null;
  let classStartLine = 0;
  let classDepth = 0; // depth when class block was entered

  // Track block being built
  let currentBlock: {
    kind: SegmentKind;
    name: string;
    key: string;
    className?: string;
    startLine: number;
    entryDepth: number; // depth when we entered the block
  } | null = null;

  let preambleEnd = 0;
  let firstNamedBlockSeen = false;
  let lastNamedBlockEndLine = 0;
  let gapCounter = 0;

  // Helper: emit preamble + gap before a new named block
  function emitPreambleOrGap(lineNum: number): void {
    if (firstNamedBlockSeen && lastNamedBlockEndLine > 0 && lineNum > lastNamedBlockEndLine + 1) {
      const gapStart = lastNamedBlockEndLine + 1;
      const gapEnd = lineNum - 1;
      const gapLines = lines.slice(gapStart - 1, gapEnd);
      if (gapLines.some(l => l.trim() !== "")) {
        gapCounter++;
        segments.push({
          key: `gap:${gapCounter}`,
          kind: "gap",
          startLine: gapStart,
          endLine: gapEnd,
        });
      }
    }

    if (!firstNamedBlockSeen) {
      if (lineNum > 1) {
        preambleEnd = lineNum - 1;
        const preambleLines = lines.slice(0, preambleEnd);
        if (preambleLines.some(l => l.trim() !== "")) {
          segments.push({
            key: "preamble",
            kind: "preamble",
            startLine: 1,
            endLine: preambleEnd,
          });
        }
      }
      firstNamedBlockSeen = true;
    }
  }

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    const trimmed = line.trim();
    const lineNum = lineIdx + 1; // 1-indexed

    const depthBefore = state.depth;

    // Detect block start BEFORE processing the line through state machine
    if (trimmed && !state.inBlockComment && state.quoteState === "none") {
      const detected = detectBlockStart(trimmed, lineNum, currentClassName, state.depth);

      if (detected) {
        if (detected.kind === "class" && !currentBlock) {
          // Class: track separately, DON'T set currentBlock
          // This keeps currentBlock free for method detection inside the class
          emitPreambleOrGap(lineNum);
          currentClassName = detected.name;
          classStartLine = lineNum;
          classDepth = state.depth; // depth before the class opens (0)
        } else if (detected.kind === "class_method" && !currentBlock && currentClassName) {
          // Method inside a class: track as currentBlock
          currentBlock = {
            ...detected,
            startLine: lineNum,
            entryDepth: state.depth, // depth 1 (inside class body)
          };
        } else if (!currentBlock && detected.kind !== "class_method") {
          // Top-level function, interface, enum, etc.
          emitPreambleOrGap(lineNum);
          currentBlock = {
            ...detected,
            startLine: lineNum,
            entryDepth: state.depth,
          };
        }
      }
    }

    // Process line through state machine (updates depth)
    processLine(line, state);

    // Check if current block (method or top-level fn) ended
    if (currentBlock) {
      const expectedCloseDepth = currentBlock.entryDepth;
      if (state.depth <= expectedCloseDepth && depthBefore > expectedCloseDepth) {
        segments.push({
          key: currentBlock.key,
          kind: currentBlock.kind,
          startLine: currentBlock.startLine,
          endLine: lineNum,
          name: currentBlock.name,
          className: currentBlock.className,
        });

        // Only update lastNamedBlockEndLine for top-level blocks (not methods)
        if (currentBlock.kind !== "class_method") {
          lastNamedBlockEndLine = lineNum;
        }

        currentBlock = null;
      }
    }

    // Check if class closed (depth returned to classDepth after being deeper)
    if (currentClassName && state.depth <= classDepth && depthBefore > classDepth) {
      segments.push({
        key: `class:${currentClassName}`,
        kind: "class",
        startLine: classStartLine,
        endLine: lineNum,
        name: currentClassName,
      });
      lastNamedBlockEndLine = lineNum;
      currentClassName = null;
    }
  }

  // Handle unclosed block at end of file
  if (currentBlock) {
    segments.push({
      key: currentBlock.key,
      kind: currentBlock.kind,
      startLine: currentBlock.startLine,
      endLine: lines.length,
      name: currentBlock.name,
      className: currentBlock.className,
    });
    lastNamedBlockEndLine = lines.length;
  }

  // Handle unclosed class at end of file
  if (currentClassName) {
    segments.push({
      key: `class:${currentClassName}`,
      kind: "class",
      startLine: classStartLine,
      endLine: lines.length,
      name: currentClassName,
    });
    lastNamedBlockEndLine = lines.length;
    currentClassName = null;
  }

  // Handle trailing gap after last named block
  if (firstNamedBlockSeen && lastNamedBlockEndLine < lines.length) {
    const gapStart = lastNamedBlockEndLine + 1;
    const gapEnd = lines.length;
    const gapLines = lines.slice(gapStart - 1, gapEnd);
    if (gapLines.some(l => l.trim() !== "")) {
      gapCounter++;
      segments.push({
        key: `gap:${gapCounter}`,
        kind: "gap",
        startLine: gapStart,
        endLine: gapEnd,
      });
    }
  }

  // If no named blocks were found, the entire file is preamble
  if (!firstNamedBlockSeen && lines.length > 0) {
    preambleEnd = lines.length;
    if (lines.some(l => l.trim() !== "")) {
      segments.push({
        key: "preamble",
        kind: "preamble",
        startLine: 1,
        endLine: lines.length,
      });
    }
  }

  return { segments, preambleEnd };
}

/**
 * Generate a BLOCK_MAP string for a file's segments.
 * This is injected into the knight's prompt so they know the file structure.
 *
 * Example output:
 *   [BLOCK_MAP] src/orchestrator.ts
 *     preamble (1-8): imports + constants
 *     fn:runDiscussion (10-45): async function
 *     gap:1 (47-48): top-level constants
 *     class:Orchestrator (50-120): class
 *     class:Orchestrator#constructor (51-60): method
 *     class:Orchestrator#run (62-118): method
 */
export function generateBlockMap(filePath: string, segments: SegmentInfo[]): string {
  const lines = [`[BLOCK_MAP] ${filePath}`];

  for (const seg of segments) {
    const range = `(${seg.startLine}-${seg.endLine})`;
    let label: string;

    switch (seg.kind) {
      case "preamble":
        label = "imports + top-level code";
        break;
      case "function":
        label = seg.name ? `function ${seg.name}` : "function";
        break;
      case "class":
        label = seg.name ? `class ${seg.name}` : "class";
        break;
      case "class_method":
        label = seg.name ? `method ${seg.name}` : "method";
        break;
      case "gap":
        label = "top-level code";
        break;
      default:
        label = seg.kind;
    }

    lines.push(`  ${seg.key} ${range}: ${label}`);
  }

  return lines.join("\n");
}

/**
 * Find a segment by its key in a scan result.
 * Returns undefined if not found.
 */
export function findSegment(segments: SegmentInfo[], key: string): SegmentInfo | undefined {
  return segments.find(s => s.key === key);
}
