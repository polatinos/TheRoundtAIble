/**
 * Tests for block-scanner.ts — bracket-balanced block scanner
 */
import { describe, it, expect } from "vitest";
import { scanBlocks, generateBlockMap, findSegment } from "../src/utils/block-scanner.js";

// ============================================================
// Simple function detection
// ============================================================

describe("Simple function detection", () => {
  const simpleFunctions = `import { foo } from "bar";
import { baz } from "qux";

export function hello(): void {
  console.log("hello");
}

export async function world(): Promise<string> {
  return "world";
}
`;

  const result = scanBlocks(simpleFunctions);

  it("finds preamble + 2 functions", () => {
    expect(result.segments.length).toBeGreaterThanOrEqual(3);
  });

  it("detects preamble", () => {
    expect(findSegment(result.segments, "preamble")).toBeDefined();
  });

  it("detects fn:hello", () => {
    expect(findSegment(result.segments, "fn:hello")).toBeDefined();
  });

  it("detects fn:world", () => {
    expect(findSegment(result.segments, "fn:world")).toBeDefined();
  });

  it("preamble starts at line 1", () => {
    expect(findSegment(result.segments, "preamble")!.startLine).toBe(1);
  });

  it("preamble ends at line 3", () => {
    expect(findSegment(result.segments, "preamble")!.endLine).toBe(3);
  });

  it("fn:hello starts at line 4", () => {
    expect(findSegment(result.segments, "fn:hello")!.startLine).toBe(4);
  });

  it("fn:hello ends at line 6", () => {
    expect(findSegment(result.segments, "fn:hello")!.endLine).toBe(6);
  });
});

// ============================================================
// Class with methods
// ============================================================

describe("Class with methods", () => {
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

  const result = scanBlocks(classCode);

  it("detects preamble", () => {
    expect(findSegment(result.segments, "preamble")).toBeDefined();
  });

  it("detects class:MyService", () => {
    expect(findSegment(result.segments, "class:MyService")).toBeDefined();
  });

  it("detects class:MyService#constructor", () => {
    expect(findSegment(result.segments, "class:MyService#constructor")).toBeDefined();
  });

  it("detects class:MyService#run", () => {
    expect(findSegment(result.segments, "class:MyService#run")).toBeDefined();
  });

  it("detects class:MyService#create", () => {
    expect(findSegment(result.segments, "class:MyService#create")).toBeDefined();
  });
});

// ============================================================
// Arrow function exports
// ============================================================

describe("Arrow function exports", () => {
  const arrowCode = `import chalk from "chalk";

export const handler = async (req: Request): Promise<Response> => {
  return new Response("ok");
};

export const helper = (x: number) => {
  return x * 2;
};
`;

  const result = scanBlocks(arrowCode);

  it("detects fn:handler (arrow export)", () => {
    expect(findSegment(result.segments, "fn:handler")).toBeDefined();
  });

  it("detects fn:helper (arrow export)", () => {
    expect(findSegment(result.segments, "fn:helper")).toBeDefined();
  });
});

// ============================================================
// Gap detection
// ============================================================

describe("Gap detection", () => {
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

  const result = scanBlocks(gapCode);

  it("detects gap:1 between functions", () => {
    expect(findSegment(result.segments, "gap:1")).toBeDefined();
  });

  it("gap:1 starts at line 6", () => {
    expect(findSegment(result.segments, "gap:1")!.startLine).toBe(6);
  });

  it("gap:1 ends at line 9", () => {
    expect(findSegment(result.segments, "gap:1")!.endLine).toBe(9);
  });
});

// ============================================================
// String/comment awareness
// ============================================================

describe("String/comment awareness", () => {
  const stringCode = `export function tricky(): string {
  const a = "{ not a real brace }";
  const b = '[ also not real ]';
  const c = \`template { literal }\`;
  // { this is a comment }
  /* { block comment } */
  return "done";
}
`;

  const result = scanBlocks(stringCode);
  const trickyFn = findSegment(result.segments, "fn:tricky");

  it("detects fn:tricky despite braces in strings/comments", () => {
    expect(trickyFn).toBeDefined();
  });

  it("fn:tricky starts at line 1", () => {
    expect(trickyFn!.startLine).toBe(1);
  });

  it("fn:tricky ends at line 8", () => {
    expect(trickyFn!.endLine).toBe(8);
  });
});

// ============================================================
// Interface and enum detection
// ============================================================

describe("Interface and enum detection", () => {
  const typeCode = `export interface Config {
  name: string;
  value: number;
}

export enum Status {
  Active = "active",
  Inactive = "inactive",
}
`;

  const result = scanBlocks(typeCode);

  it("detects interface Config", () => {
    expect(findSegment(result.segments, "fn:Config")).toBeDefined();
  });

  it("detects enum Status", () => {
    expect(findSegment(result.segments, "fn:Status")).toBeDefined();
  });
});

// ============================================================
// No named blocks (all preamble)
// ============================================================

describe("No named blocks (all preamble)", () => {
  const preambleOnly = `import { foo } from "bar";
import { baz } from "qux";

const X = 42;
`;

  const result = scanBlocks(preambleOnly);

  it("only 1 segment", () => {
    expect(result.segments.length).toBe(1);
  });

  it("it's a preamble segment", () => {
    expect(result.segments[0].key).toBe("preamble");
  });
});

// ============================================================
// generateBlockMap
// ============================================================

describe("generateBlockMap output", () => {
  const simpleFunctions = `import { foo } from "bar";
import { baz } from "qux";

export function hello(): void {
  console.log("hello");
}

export async function world(): Promise<string> {
  return "world";
}
`;
  const result = scanBlocks(simpleFunctions);
  const blockMap = generateBlockMap("src/test.ts", result.segments);

  it("has correct header", () => {
    expect(blockMap).toContain("[BLOCK_MAP] src/test.ts");
  });

  it("contains preamble", () => {
    expect(blockMap).toContain("preamble");
  });

  it("contains fn:hello", () => {
    expect(blockMap).toContain("fn:hello");
  });

  it("contains fn:world", () => {
    expect(blockMap).toContain("fn:world");
  });
});

// ============================================================
// findSegment
// ============================================================

describe("findSegment", () => {
  const simpleFunctions = `import { foo } from "bar";

export function hello(): void {
  console.log("hello");
}
`;
  const result = scanBlocks(simpleFunctions);

  it("finds existing segment", () => {
    expect(findSegment(result.segments, "fn:hello")).toBeDefined();
  });

  it("returns undefined for missing segment", () => {
    expect(findSegment(result.segments, "fn:nonexistent")).toBeUndefined();
  });
});

// ============================================================
// Empty file
// ============================================================

describe("Empty file", () => {
  it("has no segments", () => {
    const result = scanBlocks("");
    expect(result.segments.length).toBe(0);
  });
});

// ============================================================
// Nested functions
// ============================================================

describe("Nested functions", () => {
  const nestedCode = `export function outer(): void {
  function inner(): void {
    console.log("inner");
  }
  inner();
}
`;

  const result = scanBlocks(nestedCode);

  it("outer function detected", () => {
    expect(findSegment(result.segments, "fn:outer")).toBeDefined();
  });

  it("inner function NOT detected (nested, not top-level)", () => {
    expect(findSegment(result.segments, "fn:inner")).toBeUndefined();
  });
});
