import { ClaudeCliAdapter } from "../dist/adapters/claude-cli.js";
import { GeminiCliAdapter } from "../dist/adapters/gemini-cli.js";
import { OpenAICliAdapter } from "../dist/adapters/openai-cli.js";

const PROMPT = `Reply with EXACTLY this JSON and nothing else:
{"consensus_score": 9, "agrees_with": ["test"], "pending_issues": [], "proposal": "ok"}`;

async function test(name, adapter) {
  console.log(`\n=== ${name} ===`);
  try {
    const t0 = Date.now();
    const out = await adapter.execute(PROMPT, 90_000);
    const ms = Date.now() - t0;
    console.log(`OK (${ms}ms), length=${out.length}`);
    console.log(`---OUTPUT START---\n${out}\n---OUTPUT END---`);
    if (/"consensus_score"\s*:\s*9/.test(out)) {
      console.log("✓ Contains expected consensus_score=9");
    } else {
      console.log("✗ MISSING expected consensus_score=9");
    }
  } catch (e) {
    console.log(`FAIL: ${e.message}`);
  }
}

await test("Claude", new ClaudeCliAdapter("claude", 90_000));
await test("Gemini", new GeminiCliAdapter("gemini", undefined, 90_000));
await test("Codex", new OpenAICliAdapter("codex", 90_000));
