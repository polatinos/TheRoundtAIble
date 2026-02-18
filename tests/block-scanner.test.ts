/**
 * Tests for block-scanner.ts — bracket-balanced block scanner
 */
import { scanBlocks, generateBlockMap, findSegment } from "../src/utils/block-scanner.js";

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

// --- Test: Simple function detection ---

console.log("\n\x1b[1m\x1b[36m--- Simple function detection ---\x1b[0m\n");

const simpleFunctions = `import { foo } from "bar";
import { baz } from "qux";

export function hello(): void {
  console.log("hello");
}

export async function world(): Promise<string> {
  return "world";
}
`;

const simpleResult = scanBlocks(simpleFunctions);

assert(simpleResult.segments.length >= 3, `Found ${simpleResult.segments.length} segments (expected >= 3: preamble + 2 functions)`);
assert(findSegment(simpleResult.segments, "preamble") !== undefined, "Preamble detected");
assert(findSegment(simpleResult.segments, "fn:hello") !== undefined, "fn:hello detected");
assert(findSegment(simpleResult.segments, "fn:world") !== undefined, "fn:world detected");

const preamble = findSegment(simpleResult.segments, "preamble")!;
assert(preamble.startLine === 1, `Preamble starts at line 1 (got ${preamble.startLine})`);
assert(preamble.endLine === 3, `Preamble ends at line 3 (got ${preamble.endLine})`);

const helloFn = findSegment(simpleResult.segments, "fn:hello")!;
assert(helloFn.startLine === 4, `fn:hello starts at line 4 (got ${helloFn.startLine})`);
assert(helloFn.endLine === 6, `fn:hello ends at line 6 (got ${helloFn.endLine})`);

// --- Test: Class with methods ---

console.log("\n\x1b[1m\x1b[36m--- Class with methods ---\x1b[0m\n");

const classCode = `import { Base } from "./base.js";

export class MyService {
  private name: string;

  constructor(name: string) {
    this.name = name;
  }

  async run(): Promise<void> {
    console.log(this.name);
  }

  static create(): MyService {
    return new MyService("default");
  }
}
`;

const classResult = scanBlocks(classCode);

assert(findSegment(classResult.segments, "preamble") !== undefined, "Preamble detected");
assert(findSegment(classResult.segments, "class:MyService") !== undefined, "class:MyService detected");
assert(findSegment(classResult.segments, "class:MyService#constructor") !== undefined, "class:MyService#constructor detected");
assert(findSegment(classResult.segments, "class:MyService#run") !== undefined, "class:MyService#run detected");
assert(findSegment(classResult.segments, "class:MyService#create") !== undefined, "class:MyService#create detected");

// --- Test: Arrow function exports ---

console.log("\n\x1b[1m\x1b[36m--- Arrow function exports ---\x1b[0m\n");

const arrowCode = `import chalk from "chalk";

export const handler = async (req: Request): Promise<Response> => {
  return new Response("ok");
};

export const helper = (x: number) => {
  return x * 2;
};
`;

const arrowResult = scanBlocks(arrowCode);

assert(findSegment(arrowResult.segments, "fn:handler") !== undefined, "fn:handler detected (arrow export)");
assert(findSegment(arrowResult.segments, "fn:helper") !== undefined, "fn:helper detected (arrow export)");

// --- Test: Gap detection ---

console.log("\n\x1b[1m\x1b[36m--- Gap detection ---\x1b[0m\n");

const gapCode = `import { foo } from "bar";

export function first(): void {
  console.log("first");
}

const SOME_CONFIG = { key: "value" };
const OTHER = 42;

export function second(): void {
  console.log("second");
}
`;

const gapResult = scanBlocks(gapCode);

assert(findSegment(gapResult.segments, "gap:1") !== undefined, "gap:1 detected between functions");

const gap = findSegment(gapResult.segments, "gap:1")!;
assert(gap.startLine === 6, `gap:1 starts at line 6 (got ${gap.startLine})`);
assert(gap.endLine === 9, `gap:1 ends at line 9 (got ${gap.endLine})`);

// --- Test: String/comment awareness ---

console.log("\n\x1b[1m\x1b[36m--- String/comment awareness ---\x1b[0m\n");

const stringCode = `export function tricky(): string {
  const a = "{ not a real brace }";
  const b = '[ also not real ]';
  const c = \`template { literal }\`;
  // { this is a comment }
  /* { block comment } */
  return "done";
}
`;

const stringResult = scanBlocks(stringCode);
const trickyFn = findSegment(stringResult.segments, "fn:tricky");
assert(trickyFn !== undefined, "fn:tricky detected despite braces in strings/comments");
assert(trickyFn!.startLine === 1, `fn:tricky starts at line 1 (got ${trickyFn!.startLine})`);
assert(trickyFn!.endLine === 8, `fn:tricky ends at line 8 (got ${trickyFn!.endLine})`);

// --- Test: Interface and enum detection ---

console.log("\n\x1b[1m\x1b[36m--- Interface and enum detection ---\x1b[0m\n");

const typeCode = `export interface Config {
  name: string;
  value: number;
}

export enum Status {
  Active = "active",
  Inactive = "inactive",
}
`;

const typeResult = scanBlocks(typeCode);

assert(findSegment(typeResult.segments, "fn:Config") !== undefined, "interface Config detected");
assert(findSegment(typeResult.segments, "fn:Status") !== undefined, "enum Status detected");

// --- Test: No named blocks (all preamble) ---

console.log("\n\x1b[1m\x1b[36m--- No named blocks (all preamble) ---\x1b[0m\n");

const preambleOnly = `import { foo } from "bar";
import { baz } from "qux";

const X = 42;
`;

const preambleResult = scanBlocks(preambleOnly);

assert(preambleResult.segments.length === 1, `Only 1 segment (got ${preambleResult.segments.length})`);
assert(preambleResult.segments[0].key === "preamble", "It's a preamble segment");

// --- Test: generateBlockMap ---

console.log("\n\x1b[1m\x1b[36m--- generateBlockMap output ---\x1b[0m\n");

const blockMap = generateBlockMap("src/test.ts", simpleResult.segments);
assert(blockMap.includes("[BLOCK_MAP] src/test.ts"), "Block map has correct header");
assert(blockMap.includes("preamble"), "Block map contains preamble");
assert(blockMap.includes("fn:hello"), "Block map contains fn:hello");
assert(blockMap.includes("fn:world"), "Block map contains fn:world");

// --- Test: findSegment ---

console.log("\n\x1b[1m\x1b[36m--- findSegment ---\x1b[0m\n");

assert(findSegment(simpleResult.segments, "fn:hello") !== undefined, "findSegment finds existing segment");
assert(findSegment(simpleResult.segments, "fn:nonexistent") === undefined, "findSegment returns undefined for missing segment");

// --- Test: Empty file ---

console.log("\n\x1b[1m\x1b[36m--- Empty file ---\x1b[0m\n");

const emptyResult = scanBlocks("");
assert(emptyResult.segments.length === 0, `Empty file has no segments (got ${emptyResult.segments.length})`);

// --- Test: Nested functions (not detected at top level) ---

console.log("\n\x1b[1m\x1b[36m--- Nested functions ---\x1b[0m\n");

const nestedCode = `export function outer(): void {
  function inner(): void {
    console.log("inner");
  }
  inner();
}
`;

const nestedResult = scanBlocks(nestedCode);
assert(findSegment(nestedResult.segments, "fn:outer") !== undefined, "Outer function detected");
assert(findSegment(nestedResult.segments, "fn:inner") === undefined, "Inner function NOT detected (it's nested, not top-level)");

// --- Results ---

console.log(`\n\x1b[1m==================================================\x1b[0m`);
console.log(`\x1b[1m  Results: ${passed} passed, ${failed} failed, ${passed + failed} total\x1b[0m`);
console.log(`\x1b[1m==================================================\x1b[0m`);

if (failed > 0) process.exit(1);
