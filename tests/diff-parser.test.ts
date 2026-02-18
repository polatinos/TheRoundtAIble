/**
 * Tests for diff-parser.ts — RTDIFF v1.1 parser + executor
 */
import { parseRtdiff, applyBlockOperations, isRtdiffResponse, isLegacyEditResponse } from "../src/utils/diff-parser.js";
import type { SegmentInfo } from "../src/types.js";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  \x1b[32m PASS \x1b[0m ${message}`);
    passed++;
  } else {
    console.log(`  \x1b[31m FAIL \x1b[0m ${message}`);
    failed++;
  }
}

function assertEq<T>(actual: T, expected: T, message: string) {
  assert(actual === expected, `${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
}

// --- Test: parseRtdiff — BLOCK_REPLACE ---

console.log("\n\x1b[1m\x1b[36m--- parseRtdiff: BLOCK_REPLACE ---\x1b[0m\n");

const replaceInput = `RTDIFF/1

BLOCK_REPLACE: src/utils/file-writer.ts :: fn:writeFiles
---
export async function writeFiles(files: FileChange[]): Promise<void> {
  for (const f of files) {
    await fs.writeFile(f.path, f.content, "utf-8");
  }
}
---
`;

const replaceResult = parseRtdiff(replaceInput);
assertEq(replaceResult.operations.length, 1, "One BLOCK_REPLACE operation parsed");
assertEq(replaceResult.operations[0].type, "BLOCK_REPLACE", "Operation type is BLOCK_REPLACE");
assertEq(replaceResult.operations[0].filePath, "src/utils/file-writer.ts", "File path is correct");
assertEq(replaceResult.operations[0].segmentKey, "fn:writeFiles", "Segment key is fn:writeFiles");
assert(replaceResult.operations[0].content!.includes("writeFiles"), "Content contains function name");
assert(replaceResult.operations[0].content!.includes("fs.writeFile"), "Content contains implementation");
assertEq(replaceResult.newFiles.length, 0, "No new files");

// --- Test: parseRtdiff — BLOCK_INSERT_AFTER ---

console.log("\n\x1b[1m\x1b[36m--- parseRtdiff: BLOCK_INSERT_AFTER ---\x1b[0m\n");

const insertInput = `BLOCK_INSERT_AFTER: src/orchestrator.ts :: fn:runDiscussion
---
export function summarizeRound(round: number): string {
  return \`Round \${round} complete\`;
}
---
`;

const insertResult = parseRtdiff(insertInput);
assertEq(insertResult.operations.length, 1, "One BLOCK_INSERT_AFTER operation parsed");
assertEq(insertResult.operations[0].type, "BLOCK_INSERT_AFTER", "Operation type is BLOCK_INSERT_AFTER");
assertEq(insertResult.operations[0].filePath, "src/orchestrator.ts", "File path correct");
assertEq(insertResult.operations[0].segmentKey, "fn:runDiscussion", "Segment key correct");

// --- Test: parseRtdiff — BLOCK_DELETE ---

console.log("\n\x1b[1m\x1b[36m--- parseRtdiff: BLOCK_DELETE ---\x1b[0m\n");

const deleteInput = `BLOCK_DELETE: src/utils/old.ts :: fn:deprecatedHelper
`;

const deleteResult = parseRtdiff(deleteInput);
assertEq(deleteResult.operations.length, 1, "One BLOCK_DELETE operation parsed");
assertEq(deleteResult.operations[0].type, "BLOCK_DELETE", "Operation type is BLOCK_DELETE");
assertEq(deleteResult.operations[0].filePath, "src/utils/old.ts", "File path correct");
assertEq(deleteResult.operations[0].segmentKey, "fn:deprecatedHelper", "Segment key correct");
assert(deleteResult.operations[0].content === undefined, "DELETE has no content");

// --- Test: parseRtdiff — PREAMBLE_REPLACE ---

console.log("\n\x1b[1m\x1b[36m--- parseRtdiff: PREAMBLE_REPLACE ---\x1b[0m\n");

const preambleInput = `PREAMBLE_REPLACE: src/index.ts
---
import { Command } from "commander";
import { version } from "./version.js";
import { runDiscussion } from "./orchestrator.js";
---
`;

const preambleResult = parseRtdiff(preambleInput);
assertEq(preambleResult.operations.length, 1, "One PREAMBLE_REPLACE operation parsed");
assertEq(preambleResult.operations[0].type, "PREAMBLE_REPLACE", "Operation type is PREAMBLE_REPLACE");
assertEq(preambleResult.operations[0].filePath, "src/index.ts", "File path correct");
assertEq(preambleResult.operations[0].segmentKey, "preamble", "Segment key is preamble");
assert(preambleResult.operations[0].content!.includes("commander"), "Content has import");

// --- Test: parseRtdiff — Multiple operations ---

console.log("\n\x1b[1m\x1b[36m--- parseRtdiff: Multiple operations ---\x1b[0m\n");

const multiInput = `RTDIFF/1

BLOCK_REPLACE: src/a.ts :: fn:foo
---
export function foo() { return 1; }
---

BLOCK_DELETE: src/a.ts :: fn:bar

BLOCK_INSERT_AFTER: src/a.ts :: fn:foo
---
export function baz() { return 3; }
---
`;

const multiResult = parseRtdiff(multiInput);
assertEq(multiResult.operations.length, 3, "Three operations parsed");
assertEq(multiResult.operations[0].type, "BLOCK_REPLACE", "First op: BLOCK_REPLACE");
assertEq(multiResult.operations[1].type, "BLOCK_DELETE", "Second op: BLOCK_DELETE");
assertEq(multiResult.operations[2].type, "BLOCK_INSERT_AFTER", "Third op: BLOCK_INSERT_AFTER");

// --- Test: parseRtdiff — FILE: blocks for new files ---

console.log("\n\x1b[1m\x1b[36m--- parseRtdiff: FILE: blocks for new files ---\x1b[0m\n");

const fileBlockInput = `RTDIFF/1

BLOCK_REPLACE: src/existing.ts :: fn:update
---
export function update() { return true; }
---

FILE: src/brand-new.ts
\`\`\`typescript
export function hello() {
  return "world";
}
\`\`\`
`;

const fileBlockResult = parseRtdiff(fileBlockInput);
assertEq(fileBlockResult.operations.length, 1, "One BLOCK operation parsed");
assertEq(fileBlockResult.newFiles.length, 1, "One new FILE: detected");
assertEq(fileBlockResult.newFiles[0].path, "src/brand-new.ts", "New file path correct");
assert(fileBlockResult.newFiles[0].content.includes("hello"), "New file has content");

// --- Test: parseRtdiff — No valid content (empty) ---

console.log("\n\x1b[1m\x1b[36m--- parseRtdiff: Empty/invalid input ---\x1b[0m\n");

const emptyResult = parseRtdiff("");
assertEq(emptyResult.operations.length, 0, "Empty input: no operations");
assertEq(emptyResult.newFiles.length, 0, "Empty input: no new files");

const junkResult = parseRtdiff("This is just some text with no operations.");
assertEq(junkResult.operations.length, 0, "Junk input: no operations");

// --- Test: applyBlockOperations — BLOCK_REPLACE ---

console.log("\n\x1b[1m\x1b[36m--- applyBlockOperations: BLOCK_REPLACE ---\x1b[0m\n");

const sourceContent = `import { foo } from "bar";
import { baz } from "qux";

export function hello(): void {
  console.log("hello");
}

export function world(): string {
  return "world";
}`;

const segments: SegmentInfo[] = [
  { key: "preamble", kind: "preamble", startLine: 1, endLine: 3 },
  { key: "fn:hello", kind: "function", startLine: 4, endLine: 6, name: "hello" },
  { key: "fn:world", kind: "function", startLine: 8, endLine: 10, name: "world" },
];

const replaceOps = [{
  type: "BLOCK_REPLACE" as const,
  filePath: "src/test.ts",
  segmentKey: "fn:hello",
  content: `export function hello(): void {\n  console.log("REPLACED");\n}`,
}];

const applyResult = applyBlockOperations(sourceContent, replaceOps, segments);
assert(applyResult.success, "BLOCK_REPLACE succeeded");
assert(applyResult.content!.includes("REPLACED"), "Content was replaced");
assert(applyResult.content!.includes("world"), "Other function untouched");
assert(applyResult.content!.includes("import { foo }"), "Preamble untouched");

// --- Test: applyBlockOperations — BLOCK_INSERT_AFTER ---

console.log("\n\x1b[1m\x1b[36m--- applyBlockOperations: BLOCK_INSERT_AFTER ---\x1b[0m\n");

const insertOps = [{
  type: "BLOCK_INSERT_AFTER" as const,
  filePath: "src/test.ts",
  segmentKey: "fn:hello",
  content: `export function newFunc(): void {\n  console.log("new");\n}`,
}];

const insertApply = applyBlockOperations(sourceContent, insertOps, segments);
assert(insertApply.success, "BLOCK_INSERT_AFTER succeeded");
assert(insertApply.content!.includes("newFunc"), "New function was inserted");
assert(insertApply.content!.includes("hello"), "Original hello still exists");
assert(insertApply.content!.includes("world"), "Original world still exists");

// Verify order: hello should come before newFunc, newFunc before world
const helloIdx = insertApply.content!.indexOf("hello");
const newFuncIdx = insertApply.content!.indexOf("newFunc");
const worldIdx = insertApply.content!.indexOf("world");
assert(helloIdx < newFuncIdx, "hello before newFunc");
assert(newFuncIdx < worldIdx, "newFunc before world");

// --- Test: applyBlockOperations — BLOCK_DELETE ---

console.log("\n\x1b[1m\x1b[36m--- applyBlockOperations: BLOCK_DELETE ---\x1b[0m\n");

const deleteOps = [{
  type: "BLOCK_DELETE" as const,
  filePath: "src/test.ts",
  segmentKey: "fn:hello",
}];

const deleteApply = applyBlockOperations(sourceContent, deleteOps, segments);
assert(deleteApply.success, "BLOCK_DELETE succeeded");
assert(!deleteApply.content!.includes("fn hello"), "hello function was deleted");
assert(deleteApply.content!.includes("world"), "world function still exists");
assert(deleteApply.content!.includes("import { foo }"), "Preamble still exists");

// --- Test: applyBlockOperations — Missing segment error ---

console.log("\n\x1b[1m\x1b[36m--- applyBlockOperations: Missing segment error ---\x1b[0m\n");

const badOps = [{
  type: "BLOCK_REPLACE" as const,
  filePath: "src/test.ts",
  segmentKey: "fn:nonexistent",
  content: "whatever",
}];

const badResult = applyBlockOperations(sourceContent, badOps, segments);
assert(!badResult.success, "Missing segment fails");
assert(badResult.error!.includes("PatchTargetError"), "Error mentions PatchTargetError");
assert(badResult.error!.includes("fn:nonexistent"), "Error mentions the missing key");
assert(badResult.error!.includes("fn:hello"), "Error lists available segments");

// --- Test: applyBlockOperations — Multiple ops bottom-to-top ---

console.log("\n\x1b[1m\x1b[36m--- applyBlockOperations: Multiple ops (bottom-to-top) ---\x1b[0m\n");

const multiOps = [
  {
    type: "BLOCK_REPLACE" as const,
    filePath: "src/test.ts",
    segmentKey: "fn:hello",
    content: `export function hello(): void {\n  console.log("HELLO_V2");\n}`,
  },
  {
    type: "BLOCK_REPLACE" as const,
    filePath: "src/test.ts",
    segmentKey: "fn:world",
    content: `export function world(): string {\n  return "WORLD_V2";\n}`,
  },
];

const multiApply = applyBlockOperations(sourceContent, multiOps, segments);
assert(multiApply.success, "Multiple ops succeeded");
assert(multiApply.content!.includes("HELLO_V2"), "First replacement applied");
assert(multiApply.content!.includes("WORLD_V2"), "Second replacement applied");
assert(multiApply.content!.includes("import { foo }"), "Preamble intact");

// --- Test: isRtdiffResponse ---

console.log("\n\x1b[1m\x1b[36m--- isRtdiffResponse ---\x1b[0m\n");

assert(isRtdiffResponse("BLOCK_REPLACE: src/a.ts :: fn:foo\n---\ncode\n---"), "Detects BLOCK_REPLACE");
assert(isRtdiffResponse("PREAMBLE_REPLACE: src/a.ts\n---\ncode\n---"), "Detects PREAMBLE_REPLACE");
assert(isRtdiffResponse("RTDIFF/1\n\nBLOCK_DELETE: src/a.ts :: fn:foo"), "Detects RTDIFF header");
assert(!isRtdiffResponse("Just some text with no operations"), "Rejects plain text");
assert(!isRtdiffResponse("EDIT: src/a.ts\n<<<< SEARCH\nfoo\n====\nbar\n>>>> REPLACE"), "Rejects EDIT: format");

// --- Test: isLegacyEditResponse ---

console.log("\n\x1b[1m\x1b[36m--- isLegacyEditResponse ---\x1b[0m\n");

assert(isLegacyEditResponse("EDIT: src/a.ts\n<<<< SEARCH\nfoo\n====\nbar\n>>>> REPLACE"), "Detects EDIT: at line start");
assert(!isLegacyEditResponse("BLOCK_REPLACE: src/a.ts :: fn:foo"), "Rejects BLOCK ops");
assert(!isLegacyEditResponse("some text with EDIT: inside"), "Rejects EDIT: mid-line");

// --- Test: PREAMBLE_REPLACE apply ---

console.log("\n\x1b[1m\x1b[36m--- applyBlockOperations: PREAMBLE_REPLACE ---\x1b[0m\n");

const preambleOps = [{
  type: "PREAMBLE_REPLACE" as const,
  filePath: "src/test.ts",
  segmentKey: "preamble",
  content: `import { newThing } from "new-package";`,
}];

const preambleApply = applyBlockOperations(sourceContent, preambleOps, segments);
assert(preambleApply.success, "PREAMBLE_REPLACE succeeded");
assert(preambleApply.content!.includes("newThing"), "New preamble content present");
assert(!preambleApply.content!.includes("import { foo }"), "Old preamble replaced");
assert(preambleApply.content!.includes("hello"), "Functions still intact");

// --- Results ---

console.log(`\n\x1b[1m==================================================\x1b[0m`);
console.log(`\x1b[1m  Results: ${passed} passed, ${failed} failed, ${passed + failed} total\x1b[0m`);
console.log(`\x1b[1m==================================================\x1b[0m`);

if (failed > 0) process.exit(1);
