/**
 * Tests for diff-parser.ts — RTDIFF v1.1 parser + executor
 */
import { describe, it, expect } from "vitest";
import { parseRtdiff, applyBlockOperations, isRtdiffResponse, isLegacyEditResponse } from "../src/utils/diff-parser.js";
import type { SegmentInfo } from "../src/types.js";

// Shared source content and segments for apply tests
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

// ============================================================
// parseRtdiff — BLOCK_REPLACE
// ============================================================

describe("parseRtdiff: BLOCK_REPLACE", () => {
  const input = `RTDIFF/1

BLOCK_REPLACE: src/utils/file-writer.ts :: fn:writeFiles
---
export async function writeFiles(files: FileChange[]): Promise<void> {
  for (const f of files) {
    await fs.writeFile(f.path, f.content, "utf-8");
  }
}
---
`;

  const result = parseRtdiff(input);

  it("parses one operation", () => {
    expect(result.operations.length).toBe(1);
  });

  it("operation type is BLOCK_REPLACE", () => {
    expect(result.operations[0].type).toBe("BLOCK_REPLACE");
  });

  it("file path is correct", () => {
    expect(result.operations[0].filePath).toBe("src/utils/file-writer.ts");
  });

  it("segment key is fn:writeFiles", () => {
    expect(result.operations[0].segmentKey).toBe("fn:writeFiles");
  });

  it("content contains function name", () => {
    expect(result.operations[0].content).toContain("writeFiles");
  });

  it("content contains implementation", () => {
    expect(result.operations[0].content).toContain("fs.writeFile");
  });

  it("no new files", () => {
    expect(result.newFiles.length).toBe(0);
  });
});

// ============================================================
// parseRtdiff — BLOCK_INSERT_AFTER
// ============================================================

describe("parseRtdiff: BLOCK_INSERT_AFTER", () => {
  const input = `BLOCK_INSERT_AFTER: src/orchestrator.ts :: fn:runDiscussion
---
export function summarizeRound(round: number): string {
  return \`Round \${round} complete\`;
}
---
`;

  const result = parseRtdiff(input);

  it("parses one operation", () => {
    expect(result.operations.length).toBe(1);
  });

  it("operation type is BLOCK_INSERT_AFTER", () => {
    expect(result.operations[0].type).toBe("BLOCK_INSERT_AFTER");
  });

  it("file path correct", () => {
    expect(result.operations[0].filePath).toBe("src/orchestrator.ts");
  });

  it("segment key correct", () => {
    expect(result.operations[0].segmentKey).toBe("fn:runDiscussion");
  });
});

// ============================================================
// parseRtdiff — BLOCK_DELETE
// ============================================================

describe("parseRtdiff: BLOCK_DELETE", () => {
  const input = `BLOCK_DELETE: src/utils/old.ts :: fn:deprecatedHelper
`;

  const result = parseRtdiff(input);

  it("parses one operation", () => {
    expect(result.operations.length).toBe(1);
  });

  it("operation type is BLOCK_DELETE", () => {
    expect(result.operations[0].type).toBe("BLOCK_DELETE");
  });

  it("file path correct", () => {
    expect(result.operations[0].filePath).toBe("src/utils/old.ts");
  });

  it("segment key correct", () => {
    expect(result.operations[0].segmentKey).toBe("fn:deprecatedHelper");
  });

  it("DELETE has no content", () => {
    expect(result.operations[0].content).toBeUndefined();
  });
});

// ============================================================
// parseRtdiff — PREAMBLE_REPLACE
// ============================================================

describe("parseRtdiff: PREAMBLE_REPLACE", () => {
  const input = `PREAMBLE_REPLACE: src/index.ts
---
import { Command } from "commander";
import { version } from "./version.js";
import { runDiscussion } from "./orchestrator.js";
---
`;

  const result = parseRtdiff(input);

  it("parses one operation", () => {
    expect(result.operations.length).toBe(1);
  });

  it("operation type is PREAMBLE_REPLACE", () => {
    expect(result.operations[0].type).toBe("PREAMBLE_REPLACE");
  });

  it("file path correct", () => {
    expect(result.operations[0].filePath).toBe("src/index.ts");
  });

  it("segment key is preamble", () => {
    expect(result.operations[0].segmentKey).toBe("preamble");
  });

  it("content has import", () => {
    expect(result.operations[0].content).toContain("commander");
  });
});

// ============================================================
// parseRtdiff — Multiple operations
// ============================================================

describe("parseRtdiff: Multiple operations", () => {
  const input = `RTDIFF/1

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

  const result = parseRtdiff(input);

  it("three operations parsed", () => {
    expect(result.operations.length).toBe(3);
  });

  it("first op: BLOCK_REPLACE", () => {
    expect(result.operations[0].type).toBe("BLOCK_REPLACE");
  });

  it("second op: BLOCK_DELETE", () => {
    expect(result.operations[1].type).toBe("BLOCK_DELETE");
  });

  it("third op: BLOCK_INSERT_AFTER", () => {
    expect(result.operations[2].type).toBe("BLOCK_INSERT_AFTER");
  });
});

// ============================================================
// parseRtdiff — FILE: blocks for new files
// ============================================================

describe("parseRtdiff: FILE: blocks for new files", () => {
  const input = `RTDIFF/1

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

  const result = parseRtdiff(input);

  it("one BLOCK operation parsed", () => {
    expect(result.operations.length).toBe(1);
  });

  it("one new FILE: detected", () => {
    expect(result.newFiles.length).toBe(1);
  });

  it("new file path correct", () => {
    expect(result.newFiles[0].path).toBe("src/brand-new.ts");
  });

  it("new file has content", () => {
    expect(result.newFiles[0].content).toContain("hello");
  });
});

// ============================================================
// parseRtdiff — Empty/invalid input
// ============================================================

describe("parseRtdiff: Empty/invalid input", () => {
  it("empty input: no operations", () => {
    const result = parseRtdiff("");
    expect(result.operations.length).toBe(0);
    expect(result.newFiles.length).toBe(0);
  });

  it("junk input: no operations", () => {
    const result = parseRtdiff("This is just some text with no operations.");
    expect(result.operations.length).toBe(0);
  });
});

// ============================================================
// applyBlockOperations — BLOCK_REPLACE
// ============================================================

describe("applyBlockOperations: BLOCK_REPLACE", () => {
  const ops = [{
    type: "BLOCK_REPLACE" as const,
    filePath: "src/test.ts",
    segmentKey: "fn:hello",
    content: `export function hello(): void {\n  console.log("REPLACED");\n}`,
  }];

  const result = applyBlockOperations(sourceContent, ops, segments);

  it("succeeds", () => {
    expect(result.success).toBe(true);
  });

  it("content was replaced", () => {
    expect(result.content).toContain("REPLACED");
  });

  it("other function untouched", () => {
    expect(result.content).toContain("world");
  });

  it("preamble untouched", () => {
    expect(result.content).toContain("import { foo }");
  });
});

// ============================================================
// applyBlockOperations — BLOCK_INSERT_AFTER
// ============================================================

describe("applyBlockOperations: BLOCK_INSERT_AFTER", () => {
  const ops = [{
    type: "BLOCK_INSERT_AFTER" as const,
    filePath: "src/test.ts",
    segmentKey: "fn:hello",
    content: `export function newFunc(): void {\n  console.log("new");\n}`,
  }];

  const result = applyBlockOperations(sourceContent, ops, segments);

  it("succeeds", () => {
    expect(result.success).toBe(true);
  });

  it("new function was inserted", () => {
    expect(result.content).toContain("newFunc");
  });

  it("original hello still exists", () => {
    expect(result.content).toContain("hello");
  });

  it("original world still exists", () => {
    expect(result.content).toContain("world");
  });

  it("hello before newFunc, newFunc before world", () => {
    const helloIdx = result.content!.indexOf("hello");
    const newFuncIdx = result.content!.indexOf("newFunc");
    const worldIdx = result.content!.indexOf("world");
    expect(helloIdx).toBeLessThan(newFuncIdx);
    expect(newFuncIdx).toBeLessThan(worldIdx);
  });
});

// ============================================================
// applyBlockOperations — BLOCK_DELETE
// ============================================================

describe("applyBlockOperations: BLOCK_DELETE", () => {
  const ops = [{
    type: "BLOCK_DELETE" as const,
    filePath: "src/test.ts",
    segmentKey: "fn:hello",
  }];

  const result = applyBlockOperations(sourceContent, ops, segments);

  it("succeeds", () => {
    expect(result.success).toBe(true);
  });

  it("hello function was deleted", () => {
    expect(result.content).not.toContain("fn hello");
  });

  it("world function still exists", () => {
    expect(result.content).toContain("world");
  });

  it("preamble still exists", () => {
    expect(result.content).toContain("import { foo }");
  });
});

// ============================================================
// applyBlockOperations — Missing segment error
// ============================================================

describe("applyBlockOperations: Missing segment error", () => {
  const ops = [{
    type: "BLOCK_REPLACE" as const,
    filePath: "src/test.ts",
    segmentKey: "fn:nonexistent",
    content: "whatever",
  }];

  const result = applyBlockOperations(sourceContent, ops, segments);

  it("fails", () => {
    expect(result.success).toBe(false);
  });

  it("error mentions PatchTargetError", () => {
    expect(result.error).toContain("PatchTargetError");
  });

  it("error mentions the missing key", () => {
    expect(result.error).toContain("fn:nonexistent");
  });

  it("error lists available segments", () => {
    expect(result.error).toContain("fn:hello");
  });
});

// ============================================================
// applyBlockOperations — Multiple ops (bottom-to-top)
// ============================================================

describe("applyBlockOperations: Multiple ops (bottom-to-top)", () => {
  const ops = [
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

  const result = applyBlockOperations(sourceContent, ops, segments);

  it("succeeds", () => {
    expect(result.success).toBe(true);
  });

  it("first replacement applied", () => {
    expect(result.content).toContain("HELLO_V2");
  });

  it("second replacement applied", () => {
    expect(result.content).toContain("WORLD_V2");
  });

  it("preamble intact", () => {
    expect(result.content).toContain("import { foo }");
  });
});

// ============================================================
// isRtdiffResponse
// ============================================================

describe("isRtdiffResponse", () => {
  it("detects BLOCK_REPLACE", () => {
    expect(isRtdiffResponse("BLOCK_REPLACE: src/a.ts :: fn:foo\n---\ncode\n---")).toBe(true);
  });

  it("detects PREAMBLE_REPLACE", () => {
    expect(isRtdiffResponse("PREAMBLE_REPLACE: src/a.ts\n---\ncode\n---")).toBe(true);
  });

  it("detects RTDIFF header", () => {
    expect(isRtdiffResponse("RTDIFF/1\n\nBLOCK_DELETE: src/a.ts :: fn:foo")).toBe(true);
  });

  it("rejects plain text", () => {
    expect(isRtdiffResponse("Just some text with no operations")).toBe(false);
  });

  it("rejects EDIT: format", () => {
    expect(isRtdiffResponse("EDIT: src/a.ts\n<<<< SEARCH\nfoo\n====\nbar\n>>>> REPLACE")).toBe(false);
  });
});

// ============================================================
// isLegacyEditResponse
// ============================================================

describe("isLegacyEditResponse", () => {
  it("detects EDIT: at line start", () => {
    expect(isLegacyEditResponse("EDIT: src/a.ts\n<<<< SEARCH\nfoo\n====\nbar\n>>>> REPLACE")).toBe(true);
  });

  it("rejects BLOCK ops", () => {
    expect(isLegacyEditResponse("BLOCK_REPLACE: src/a.ts :: fn:foo")).toBe(false);
  });

  it("rejects EDIT: mid-line", () => {
    expect(isLegacyEditResponse("some text with EDIT: inside")).toBe(false);
  });
});

// ============================================================
// PREAMBLE_REPLACE apply
// ============================================================

describe("applyBlockOperations: PREAMBLE_REPLACE", () => {
  const ops = [{
    type: "PREAMBLE_REPLACE" as const,
    filePath: "src/test.ts",
    segmentKey: "preamble",
    content: `import { newThing } from "new-package";`,
  }];

  const result = applyBlockOperations(sourceContent, ops, segments);

  it("succeeds", () => {
    expect(result.success).toBe(true);
  });

  it("new preamble content present", () => {
    expect(result.content).toContain("newThing");
  });

  it("old preamble replaced", () => {
    expect(result.content).not.toContain("import { foo }");
  });

  it("functions still intact", () => {
    expect(result.content).toContain("hello");
  });
});
