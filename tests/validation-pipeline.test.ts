/**
 * Tests for the validation pipeline.
 * Covers: bracket balance, artifact detection, duplicate imports,
 * edit parsing, scope filtering, and full pipeline simulation.
 */

import { describe, it, expect } from "vitest";

import {
  checkBracketBalance,
  detectArtifacts,
  detectDuplicateImports,
  validateStagedFile,
  validateAll,
  formatValidationReport,
} from "../src/utils/validation.js";

import { parseEditBlocks, applyEdits, parseKnightOutput } from "../src/utils/edit-parser.js";
import { parseCodeBlocks, filterByScope } from "../src/utils/file-writer.js";

// ============================================================
// 1. BRACKET BALANCE
// ============================================================

describe("Bracket Balance — Should CATCH bad code", () => {
  it("catches missing closing brace", () => {
    expect(
      checkBracketBalance(`function foo() {\n  if (true) {\n    return;\n  }\n`).length
    ).toBeGreaterThan(0);
  });

  it("catches extra closing bracket", () => {
    expect(
      checkBracketBalance(`const x = [1, 2, 3]];\n`).length
    ).toBeGreaterThan(0);
  });

  it("catches missing closing paren", () => {
    expect(
      checkBracketBalance(`console.log("hello"\n`).length
    ).toBeGreaterThan(0);
  });

  it("catches multiple bracket issues at once", () => {
    const issues = checkBracketBalance(`function foo() {\n  const x = [1, 2\n`);
    expect(issues.length).toBeGreaterThanOrEqual(2);
  });
});

describe("Bracket Balance — Should PASS clean code", () => {
  it("clean TypeScript passes", () => {
    expect(
      checkBracketBalance(`
import { foo } from "bar";

export function hello(name: string): string {
  const items = [1, 2, 3];
  if (items.length > 0) {
    return \`Hello, \${name}!\`;
  }
  return "World";
}
`).length
    ).toBe(0);
  });

  it("brackets in strings are ignored", () => {
    expect(
      checkBracketBalance(`
const x = "this has { braces } inside";
const y = 'and ( parens ] too';
const z = \`template \${ "nested" } literal\`;
`).length
    ).toBe(0);
  });

  it("brackets in comments are ignored", () => {
    expect(
      checkBracketBalance(`
// This comment has { an unclosed brace
/* And this block { comment [ too */
const x = 42;
`).length
    ).toBe(0);
  });

  it("empty file passes", () => {
    expect(checkBracketBalance("").length).toBe(0);
  });

  it("complex nested code passes", () => {
    expect(
      checkBracketBalance(`
export class Validator {
  private rules: Map<string, (val: unknown) => boolean> = new Map();

  validate(data: Record<string, unknown>): boolean {
    for (const [key, rule] of this.rules) {
      if (!rule(data[key])) {
        return false;
      }
    }
    return true;
  }
}
`).length
    ).toBe(0);
  });
});

// ============================================================
// 2. ARTIFACT DETECTION
// ============================================================

describe("Artifact Detection — Should CATCH leaked markers", () => {
  it("catches leaked <<<< SEARCH", () => {
    expect(
      detectArtifacts(`const x = 1;\n<<<< SEARCH\nconst y = 2;`).length
    ).toBeGreaterThan(0);
  });

  it("catches leaked >>>> REPLACE", () => {
    expect(
      detectArtifacts(`const x = 1;\n>>>> REPLACE\nconst y = 2;`).length
    ).toBeGreaterThan(0);
  });

  it("catches leaked ==== separator", () => {
    expect(
      detectArtifacts(`const x = 1;\n====\nconst y = 2;`).length
    ).toBeGreaterThan(0);
  });

  it("catches merge conflict markers", () => {
    expect(
      detectArtifacts(`<<<<<<< HEAD\nconst x = 1;\n=======\nconst x = 2;\n>>>>>>> feature`).length
    ).toBeGreaterThan(0);
  });

  it("catches leaked EDIT: directive", () => {
    expect(
      detectArtifacts(`EDIT: src/foo.ts\nconst x = 1;`).length
    ).toBeGreaterThan(0);
  });
});

describe("Artifact Detection — Should PASS clean code", () => {
  it("comparison operators pass", () => {
    expect(
      detectArtifacts(`
if (x < 10 && y > 5) {
  return x << 2;
}
`).length
    ).toBe(0);
  });

  it("assignment operators pass", () => {
    expect(
      detectArtifacts(`
const x = 1;
const y = x === 2 ? "a" : "b";
`).length
    ).toBe(0);
  });

  it("EDIT: inside string (not at line start) passes", () => {
    expect(
      detectArtifacts(`const msg = "Use EDIT: format for changes";`).length
    ).toBe(0);
  });
});

// ============================================================
// 3. DUPLICATE IMPORT DETECTION
// ============================================================

describe("Duplicate Imports — Should CATCH duplicates", () => {
  it("catches exact duplicate imports", () => {
    expect(
      detectDuplicateImports(`
import { foo } from "bar";
import { baz } from "qux";
import { foo } from "bar";
`).length
    ).toBeGreaterThan(0);
  });

  it("catches duplicate with different whitespace", () => {
    expect(
      detectDuplicateImports(`
import { foo } from "bar";
import {  foo  }  from  "bar";
`).length
    ).toBeGreaterThan(0);
  });
});

describe("Duplicate Imports — Should PASS clean code", () => {
  it("different imports pass", () => {
    expect(
      detectDuplicateImports(`
import { foo } from "bar";
import { baz } from "bar";
import { qux } from "other";
`).length
    ).toBe(0);
  });

  it("code without imports passes", () => {
    expect(
      detectDuplicateImports(`const x = 1;\nconst y = 2;\n`).length
    ).toBe(0);
  });
});

// ============================================================
// 4. EDIT PARSER
// ============================================================

describe("Edit Parser — Parse EDIT: blocks", () => {
  it("parses single EDIT: block", () => {
    const input = `
Here is the fix:

EDIT: src/utils/foo.ts
<<<< SEARCH
const x = 1;
const y = 2;
>>>> REPLACE
const x = 10;
const y = 20;
====
`;
    const parsed = parseEditBlocks(input);
    expect(parsed.length).toBe(1);
    expect(parsed[0]?.path).toBe("src/utils/foo.ts");
    expect(parsed[0]?.edits.length).toBe(1);
    expect(parsed[0]?.edits[0]?.search).toBe("const x = 1;\nconst y = 2;");
    expect(parsed[0]?.edits[0]?.replace).toBe("const x = 10;\nconst y = 20;");
  });

  it("groups multiple edits under one file", () => {
    const input = `
EDIT: src/index.ts
<<<< SEARCH
import { foo } from "./foo";
>>>> REPLACE
import { foo, bar } from "./foo";
====

<<<< SEARCH
console.log("hello");
>>>> REPLACE
console.log("hello world");
====
`;
    const parsed = parseEditBlocks(input);
    expect(parsed.length).toBe(1);
    expect(parsed[0]?.edits.length).toBe(2);
  });

  it("parses edits for two different files", () => {
    const input = `
EDIT: src/a.ts
<<<< SEARCH
const a = 1;
>>>> REPLACE
const a = 2;
====

EDIT: src/b.ts
<<<< SEARCH
const b = 1;
>>>> REPLACE
const b = 2;
====
`;
    const parsed = parseEditBlocks(input);
    expect(parsed.length).toBe(2);
  });

  it("parses delete operation (empty replace)", () => {
    const input = `
EDIT: src/cleanup.ts
<<<< SEARCH
// TODO: remove this later
const debug = true;
>>>> REPLACE
====
`;
    const parsed = parseEditBlocks(input);
    expect(parsed.length).toBe(1);
    expect(parsed[0]?.edits[0]?.replace).toBe("");
  });
});

// ============================================================
// 5. APPLY EDITS
// ============================================================

describe("Apply Edits", () => {
  const original = `import { foo } from "bar";\n\nconst x = 1;\nconst y = 2;\n\nexport { x, y };\n`;

  it("exact match edit succeeds", () => {
    const result = applyEdits(original, [{ search: "const x = 1;", replace: "const x = 42;" }], "test.ts");
    expect(result.success).toBe(true);
    expect(result.content).toContain("const x = 42;");
    expect(result.content).not.toContain("const x = 1;");
  });

  it("fuzzy whitespace match succeeds", () => {
    const original2 = `  const   x = 1;\n  const   y = 2;\n`;
    const result = applyEdits(original2, [{ search: "const x = 1;", replace: "const x = 42;" }], "test.ts");
    expect(result.success).toBe(true);
  });

  it("non-existent search fails", () => {
    const result = applyEdits(`const a = "hello";\n`, [{ search: "THIS DOES NOT EXIST", replace: "nope" }], "test.ts");
    expect(result.success).toBe(false);
    expect(result.failedEdits!.length).toBe(1);
  });
});

// ============================================================
// 6. COMBINED PARSER (parseKnightOutput)
// ============================================================

describe("Combined Parser — EDIT: + FILE: blocks", () => {
  it("parses mixed EDIT: and FILE: output", () => {
    const knightOutput = `
I'll implement the changes now.

EDIT: src/existing.ts
<<<< SEARCH
const version = "1.0";
>>>> REPLACE
const version = "2.0";
====

FILE: src/new-file.ts
\`\`\`typescript
export function newHelper(): string {
  return "I'm new here";
}
\`\`\`
`;
    const combined = parseKnightOutput(knightOutput);
    expect(combined.edits.length).toBe(1);
    expect(combined.files.length).toBe(1);
    expect(combined.edits[0]?.path).toBe("src/existing.ts");
    expect(combined.files[0]?.path).toBe("src/new-file.ts");
  });
});

// ============================================================
// 7. SCOPE FILTER
// ============================================================

describe("Scope Filter", () => {
  const scopeFiles = [
    { path: "src/a.ts", content: "a", language: "ts" },
    { path: "src/b.ts", content: "b", language: "ts" },
    { path: "src/evil.ts", content: "evil", language: "ts" },
  ];

  it("filters files by scope", () => {
    const result = filterByScope(scopeFiles, ["src/a.ts", "src/b.ts"]);
    expect(result.allowed.length).toBe(2);
    expect(result.rejected.length).toBe(1);
    expect(result.rejected[0]?.path).toBe("src/evil.ts");
  });

  it("NEW: prefix allows new file path", () => {
    const result = filterByScope(
      [{ path: "src/brand-new.ts", content: "new", language: "ts" }],
      ["NEW:src/brand-new.ts"]
    );
    expect(result.allowed.length).toBe(1);
  });

  it("no scope means everything allowed", () => {
    const result = filterByScope(scopeFiles);
    expect(result.allowed.length).toBe(3);
  });
});

// ============================================================
// 8. FULL PIPELINE SIMULATION
// ============================================================

describe("Full Pipeline — BAD knight output should be BLOCKED", () => {
  it("validation catches bad FILE: output", () => {
    const badKnightOutput = `
EDIT: src/broken.ts
<<<< SEARCH
const x = 1;
>>>> REPLACE
const x = 2;
// Oops, knight left a marker
<<<< SEARCH
====

FILE: src/new-broken.ts
\`\`\`typescript
import { foo } from "bar";
import { baz } from "qux";
import { foo } from "bar";

export function broken() {
  if (true) {
    console.log("missing closing brace");

\`\`\`
`;
    const badParsed = parseKnightOutput(badKnightOutput);
    expect(badParsed.files.length).toBeGreaterThanOrEqual(1);

    const badStaged = new Map<string, string>();
    for (const file of badParsed.files) {
      badStaged.set(file.path, file.content);
    }

    const badReports = validateAll(badStaged);
    const badFailed = badReports.filter((r) => !r.passed);
    expect(badFailed.length).toBeGreaterThan(0);

    const allIssues = badFailed.flatMap((r) => r.issues);
    const issueTypes = new Set(allIssues.map((i) => i.type));
    expect(issueTypes.has("bracket_balance")).toBe(true);
    expect(issueTypes.has("duplicate_import")).toBe(true);
  });
});

describe("Full Pipeline — GOOD knight output should PASS", () => {
  it("clean code passes all validation checks", () => {
    const goodStaged = new Map<string, string>();
    goodStaged.set("src/clean.ts", `
import { foo } from "bar";
import { baz } from "qux";

export function clean(): string {
  const items = [1, 2, 3];
  if (items.length > 0) {
    return "clean!";
  }
  return "empty";
}
`);
    goodStaged.set("src/another-clean.ts", `
export class Helper {
  private data: Map<string, number> = new Map();

  add(key: string, value: number): void {
    this.data.set(key, value);
  }

  get(key: string): number | undefined {
    return this.data.get(key);
  }
}
`);

    const goodReports = validateAll(goodStaged);
    const goodFailed = goodReports.filter((r) => !r.passed);
    expect(goodFailed.length).toBe(0);
    expect(goodReports.length).toBe(2);
  });
});

// ============================================================
// 9. EDGE CASES
// ============================================================

describe("Edge Cases", () => {
  it("JSX with self-closing tags passes", () => {
    expect(
      checkBracketBalance(`
function App() {
  return (
    <div className="app">
      <Header />
      <Main>
        <p>Hello</p>
      </Main>
    </div>
  );
}
`).length
    ).toBe(0);
  });

  it("regex brackets pass", () => {
    expect(
      checkBracketBalance(`
const pattern = /[a-z]{2,5}/g;
const result = "hello".match(pattern);
`).length
    ).toBe(0);
  });

  it("escaped quotes in strings pass", () => {
    expect(
      checkBracketBalance(`
const x = "he said \\"hello\\"";
const y = 'it\\'s fine';
`).length
    ).toBe(0);
  });

  it("catches EDIT: directive leaked into code body", () => {
    const artifactInCode = `
import { readFile } from "node:fs/promises";

export async function loadData(path: string): Promise<string> {
  const content = await readFile(path, "utf-8");
EDIT: src/utils/data.ts
  return content;
}
`;
    expect(detectArtifacts(artifactInCode).length).toBeGreaterThan(0);
  });

  it("template literals with expressions pass", () => {
    expect(
      checkBracketBalance(`
const msg = \`Hello \${user.name}, you have \${items.length} items\`;
const nested = \`\${fn({ key: "val" })}\`;
`).length
    ).toBe(0);
  });
});
