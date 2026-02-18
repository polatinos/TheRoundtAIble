/**
 * Live test for the validation pipeline.
 * Tests: parsing, staging, validation (bracket balance, artifacts, duplicate imports)
 * Run: npx tsx tests/validation-pipeline.test.ts
 */

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

// --- Test runner ---

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, testName: string) {
  if (condition) {
    passed++;
    console.log(`  \x1b[32m PASS \x1b[0m ${testName}`);
  } else {
    failed++;
    failures.push(testName);
    console.log(`  \x1b[31m FAIL \x1b[0m ${testName}`);
  }
}

function section(name: string) {
  console.log(`\n\x1b[1m\x1b[36m--- ${name} ---\x1b[0m\n`);
}

// ============================================================
// 1. BRACKET BALANCE
// ============================================================

section("Bracket Balance — Should CATCH bad code");

// Missing closing brace
assert(
  checkBracketBalance(`function foo() {\n  if (true) {\n    return;\n  }\n`).length > 0,
  "Catches missing closing brace"
);

// Extra closing bracket
assert(
  checkBracketBalance(`const x = [1, 2, 3]];\n`).length > 0,
  "Catches extra closing bracket"
);

// Missing closing paren
assert(
  checkBracketBalance(`console.log("hello"\n`).length > 0,
  "Catches missing closing paren"
);

// Multiple issues
const multiIssues = checkBracketBalance(`function foo() {\n  const x = [1, 2\n`);
assert(multiIssues.length >= 2, "Catches multiple bracket issues at once");

section("Bracket Balance — Should PASS clean code");

// Clean TypeScript
assert(
  checkBracketBalance(`
import { foo } from "bar";

export function hello(name: string): string {
  const items = [1, 2, 3];
  if (items.length > 0) {
    return \`Hello, \${name}!\`;
  }
  return "World";
}
`).length === 0,
  "Clean TypeScript passes"
);

// Brackets inside strings should be ignored
assert(
  checkBracketBalance(`
const x = "this has { braces } inside";
const y = 'and ( parens ] too';
const z = \`template \${ "nested" } literal\`;
`).length === 0,
  "Brackets in strings are ignored"
);

// Brackets in comments should be ignored
assert(
  checkBracketBalance(`
// This comment has { an unclosed brace
/* And this block { comment [ too */
const x = 42;
`).length === 0,
  "Brackets in comments are ignored"
);

// Empty file
assert(
  checkBracketBalance("").length === 0,
  "Empty file passes"
);

// Complex nested code
assert(
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
`).length === 0,
  "Complex nested code passes"
);

// ============================================================
// 2. ARTIFACT DETECTION
// ============================================================

section("Artifact Detection — Should CATCH leaked markers");

// Leaked SEARCH marker
assert(
  detectArtifacts(`const x = 1;\n<<<< SEARCH\nconst y = 2;`).length > 0,
  "Catches leaked <<<< SEARCH"
);

// Leaked REPLACE marker
assert(
  detectArtifacts(`const x = 1;\n>>>> REPLACE\nconst y = 2;`).length > 0,
  "Catches leaked >>>> REPLACE"
);

// Leaked separator
assert(
  detectArtifacts(`const x = 1;\n====\nconst y = 2;`).length > 0,
  "Catches leaked ==== separator"
);

// Merge conflict markers
assert(
  detectArtifacts(`<<<<<<< HEAD\nconst x = 1;\n=======\nconst x = 2;\n>>>>>>> feature`).length > 0,
  "Catches merge conflict markers"
);

// Leaked EDIT: directive
assert(
  detectArtifacts(`EDIT: src/foo.ts\nconst x = 1;`).length > 0,
  "Catches leaked EDIT: directive"
);

section("Artifact Detection — Should PASS clean code");

// Code with < and > operators (not markers)
assert(
  detectArtifacts(`
if (x < 10 && y > 5) {
  return x << 2;
}
`).length === 0,
  "Comparison operators pass"
);

// Code with = in assignments
assert(
  detectArtifacts(`
const x = 1;
const y = x === 2 ? "a" : "b";
`).length === 0,
  "Assignment operators pass"
);

// String containing EDIT-like text (not at start of line)
assert(
  detectArtifacts(`const msg = "Use EDIT: format for changes";`).length === 0,
  "EDIT: inside string (not at line start) passes"
);

// ============================================================
// 3. DUPLICATE IMPORT DETECTION
// ============================================================

section("Duplicate Imports — Should CATCH duplicates");

// Exact duplicate
assert(
  detectDuplicateImports(`
import { foo } from "bar";
import { baz } from "qux";
import { foo } from "bar";
`).length > 0,
  "Catches exact duplicate imports"
);

// Duplicate with whitespace diff
assert(
  detectDuplicateImports(`
import { foo } from "bar";
import {  foo  }  from  "bar";
`).length > 0,
  "Catches duplicate with different whitespace"
);

section("Duplicate Imports — Should PASS clean code");

// Different imports
assert(
  detectDuplicateImports(`
import { foo } from "bar";
import { baz } from "bar";
import { qux } from "other";
`).length === 0,
  "Different imports pass"
);

// No imports
assert(
  detectDuplicateImports(`const x = 1;\nconst y = 2;\n`).length === 0,
  "Code without imports passes"
);

// ============================================================
// 4. EDIT PARSER
// ============================================================

section("Edit Parser — Parse EDIT: blocks");

const singleEdit = `
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

const parsed1 = parseEditBlocks(singleEdit);
assert(parsed1.length === 1, "Parses single EDIT: block");
assert(parsed1[0]?.path === "src/utils/foo.ts", "Correct file path");
assert(parsed1[0]?.edits.length === 1, "One edit operation");
assert(parsed1[0]?.edits[0]?.search === "const x = 1;\nconst y = 2;", "Correct search content");
assert(parsed1[0]?.edits[0]?.replace === "const x = 10;\nconst y = 20;", "Correct replace content");

// Multiple edits for same file
const multiEdit = `
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

const parsed2 = parseEditBlocks(multiEdit);
assert(parsed2.length === 1, "Multiple edits grouped under one file");
assert(parsed2[0]?.edits.length === 2, "Two edit operations for same file");

// Multiple files
const multiFile = `
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

const parsed3 = parseEditBlocks(multiFile);
assert(parsed3.length === 2, "Parses edits for two different files");

// Delete operation (empty replace)
const deleteEdit = `
EDIT: src/cleanup.ts
<<<< SEARCH
// TODO: remove this later
const debug = true;
>>>> REPLACE
====
`;

const parsed4 = parseEditBlocks(deleteEdit);
assert(parsed4.length === 1, "Parses delete operation");
assert(parsed4[0]?.edits[0]?.replace === "", "Empty replace for delete");

// ============================================================
// 5. APPLY EDITS
// ============================================================

section("Apply Edits — Exact match");

const original1 = `import { foo } from "bar";\n\nconst x = 1;\nconst y = 2;\n\nexport { x, y };\n`;
const result1 = applyEdits(original1, [{ search: "const x = 1;", replace: "const x = 42;" }], "test.ts");
assert(result1.success, "Exact match edit succeeds");
assert(result1.content!.includes("const x = 42;"), "Content updated correctly");
assert(!result1.content!.includes("const x = 1;"), "Old content removed");

section("Apply Edits — Fuzzy match (whitespace)");

const original2 = `  const   x = 1;\n  const   y = 2;\n`;
const result2 = applyEdits(original2, [{ search: "const x = 1;", replace: "const x = 42;" }], "test.ts");
assert(result2.success, "Fuzzy whitespace match succeeds");

section("Apply Edits — Failed match");

const original3 = `const a = "hello";\n`;
const result3 = applyEdits(original3, [{ search: "THIS DOES NOT EXIST", replace: "nope" }], "test.ts");
assert(!result3.success, "Non-existent search fails");
assert(result3.failedEdits!.length === 1, "Reports failed edit index");

// ============================================================
// 6. COMBINED PARSER (parseKnightOutput)
// ============================================================

section("Combined Parser — EDIT: + FILE: blocks");

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
assert(combined.edits.length === 1, "Parsed 1 EDIT: block");
assert(combined.files.length === 1, "Parsed 1 FILE: block");
assert(combined.edits[0]?.path === "src/existing.ts", "EDIT: path correct");
assert(combined.files[0]?.path === "src/new-file.ts", "FILE: path correct");

// ============================================================
// 7. SCOPE FILTER
// ============================================================

section("Scope Filter");

const scopeFiles = [
  { path: "src/a.ts", content: "a", language: "ts" },
  { path: "src/b.ts", content: "b", language: "ts" },
  { path: "src/evil.ts", content: "evil", language: "ts" },
];

const scopeResult = filterByScope(scopeFiles, ["src/a.ts", "src/b.ts"]);
assert(scopeResult.allowed.length === 2, "2 files allowed by scope");
assert(scopeResult.rejected.length === 1, "1 file rejected by scope");
assert(scopeResult.rejected[0]?.path === "src/evil.ts", "Correct file rejected");

// NEW: prefix support
const newFileScope = filterByScope(
  [{ path: "src/brand-new.ts", content: "new", language: "ts" }],
  ["NEW:src/brand-new.ts"]
);
assert(newFileScope.allowed.length === 1, "NEW: prefix allows new file path");

// No scope = everything allowed
const noScope = filterByScope(scopeFiles);
assert(noScope.allowed.length === 3, "No scope means everything allowed");

// ============================================================
// 8. FULL PIPELINE SIMULATION
// ============================================================

section("Full Pipeline — BAD knight output should be BLOCKED");

// Simulate a knight that outputs code with issues
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

// Parse
const badParsed = parseKnightOutput(badKnightOutput);
assert(badParsed.files.length >= 1, "Bad output still parses FILE: blocks");

// Stage the FILE: block directly (simulating what apply.ts does)
const badStaged = new Map<string, string>();
for (const file of badParsed.files) {
  badStaged.set(file.path, file.content);
}

// Validate
if (badStaged.size > 0) {
  const badReports = validateAll(badStaged);
  const badFailed = badReports.filter((r) => !r.passed);
  assert(badFailed.length > 0, "Validation catches bad FILE: output");

  // Check which issues were found
  const allIssues = badFailed.flatMap((r) => r.issues);
  const issueTypes = new Set(allIssues.map((i) => i.type));

  assert(issueTypes.has("bracket_balance"), "Caught bracket imbalance in bad output");
  assert(issueTypes.has("duplicate_import"), "Caught duplicate import in bad output");

  // Show the report
  const report = formatValidationReport(badReports);
  console.log("\n  Validation report for BAD output:");
  console.log(report);
} else {
  assert(false, "Bad output should have produced staged files");
}

section("Full Pipeline — GOOD knight output should PASS");

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
assert(goodFailed.length === 0, "Clean code passes all validation checks");
assert(goodReports.length === 2, "Both files were validated");

// ============================================================
// 9. EDGE CASES
// ============================================================

section("Edge Cases");

// JSX with self-closing tags (should not confuse bracket counter)
assert(
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
`).length === 0,
  "JSX with self-closing tags passes"
);

// Regex with brackets
assert(
  checkBracketBalance(`
const pattern = /[a-z]{2,5}/g;
const result = "hello".match(pattern);
`).length === 0,
  "Regex brackets pass (inside string context)"
);

// Escaped quotes in strings
assert(
  checkBracketBalance(`
const x = "he said \\"hello\\"";
const y = 'it\\'s fine';
`).length === 0,
  "Escaped quotes in strings pass"
);

// Real-world knight bad output: artifact in code
const artifactInCode = `
import { readFile } from "node:fs/promises";

export async function loadData(path: string): Promise<string> {
  const content = await readFile(path, "utf-8");
EDIT: src/utils/data.ts
  return content;
}
`;
assert(
  detectArtifacts(artifactInCode).length > 0,
  "Catches EDIT: directive leaked into code body"
);

// Bracket balance with template literals and expressions
assert(
  checkBracketBalance(`
const msg = \`Hello \${user.name}, you have \${items.length} items\`;
const nested = \`\${fn({ key: "val" })}\`;
`).length === 0,
  "Template literals with expressions pass"
);

// ============================================================
// RESULTS
// ============================================================

console.log(`\n\x1b[1m${"=".repeat(50)}\x1b[0m`);
console.log(`\x1b[1m  Results: ${passed} passed, ${failed} failed, ${passed + failed} total\x1b[0m`);

if (failures.length > 0) {
  console.log(`\n\x1b[31m  Failures:\x1b[0m`);
  for (const f of failures) {
    console.log(`\x1b[31m    - ${f}\x1b[0m`);
  }
}

console.log(`\x1b[1m${"=".repeat(50)}\x1b[0m\n`);

process.exit(failed > 0 ? 1 : 0);
