# Architecture — TheRoundtAIble

> **"Where no AI is King, but all serve the Code."**

This document describes the internal architecture of TheRoundtAIble for contributors and AI agents working on the codebase.

---

## What is TheRoundtAIble?

A CLI tool that orchestrates discussions between multiple AI models (Claude, Gemini, GPT). Instead of manually switching between AIs, TheRoundtAIble automates the conversation until consensus is reached. The best AI for the task then executes the decision.

**Core principle:** No API keys required by default. Works with existing subscriptions (Claude Pro/Max, Gemini Advanced, ChatGPT Plus). API keys are an optional fallback.

---

## Architecture (3 Layers)

### Layer 1: The Shared Brain (`.roundtable/`)

Every project using TheRoundtAIble has a `.roundtable/` folder:

```
project-root/
  .roundtable/
    config.json              # Which LLMs, capabilities, rules
    chronicle.md             # Living summary of all decisions
    error-log.md             # Code-red diagnostic log
    sessions/
      2026-02-16-auth-refactor/
        topic.md             # The topic/question
        discussion.md        # Full discussion (all rounds)
        decisions.md         # The consensus decision
        status.json          # Phase, current knight, scores
```

**chronicle.md** is the collective memory. New sessions start by reading it so past decisions aren't repeated.

### Layer 2: The Orchestrator (`roundtable` CLI)

A lightweight CLI tool (TypeScript/Node.js) that:
- Manages the `.roundtable/` folder
- Calls LLMs in round-robin turns
- Detects consensus via scores
- Selects the right LLM for execution (Lead Knight)
- Escalates to the user if no consensus is reached

**The orchestrator is the neutral chairman.** No LLM is chairman — that would bias the discussion toward that LLM's strengths.

### Layer 3: LLM Adapters (Knights)

Each LLM has an adapter that knows HOW to call it. Adapters are plug-and-play.

**Priority per adapter:** Try CLI/subscription first, then fall back to API key.

| Adapter | Method | Subscription? | Fallback |
|---------|--------|---------------|----------|
| `claude-cli` | `claude -p "prompt" --print` | Yes (Claude Pro/Max) | `claude-api` |
| `gemini-cli` | `gemini -p "prompt"` | Yes (Gemini Advanced) | `gemini-api` |
| `openai-cli` | `codex "prompt"` | Yes (ChatGPT Pro) | `openai-api` |
| `openai-api` | OpenAI REST API | No (API key) | — |

---

## Project Structure

```
TheRoundtAIble/
  src/
    index.ts              # CLI entry point (commander.js)
    orchestrator.ts       # Round logic, turn management, diagnostic mode
    consensus.ts          # Score parsing, consensus detection, diagnostic convergence
    types.ts              # All TypeScript interfaces and types
    adapters/
      base.ts             # Abstract BaseAdapter class
      claude-cli.ts       # Claude Code CLI adapter
      gemini-cli.ts       # Gemini CLI adapter
      openai-api.ts       # OpenAI REST API adapter
      openai-cli.ts       # OpenAI/Codex CLI adapter
    commands/
      init.ts             # roundtable init — interactive wizard
      discuss.ts          # roundtable discuss — start discussion
      apply.ts            # roundtable apply — execute decision
      code-red.ts         # roundtable code-red — emergency diagnostics
      summon.ts           # roundtable summon — git-diff discussion
      status.ts           # roundtable status — show session status
      list.ts             # roundtable list — list sessions
      chronicle.ts        # roundtable chronicle — view decision log
    utils/
      config.ts           # Config loading and validation
      adapters.ts         # Adapter factory and initialization
      chronicle.ts        # Chronicle read/write/summarize
      context.ts          # Project context building
      decree.ts           # Shared UI prompts (King's decree, parley mode)
      error-log.ts        # Code-red error log management
      file-writer.ts      # Parse and write code blocks from knight output
      git.ts              # Git diff, branch info, recent commits
      prompt.ts           # System prompt and diagnostic prompt templating
      session.ts          # Session folder management
  templates/
    system-prompt.md      # Discussion prompt template
    code-red-prompt.md    # Diagnostic prompt template
```

---

## Discussion Flow

```
User: roundtable discuss "How to refactor auth?"
  → Context build (chronicle + git + project files)
  → Round 1: Each knight responds + consensus JSON
  → Round 2..N: Knights respond to previous rounds
  → Consensus check after each round
  → Consensus reached OR max rounds → escalate to user
  → King's Choice: apply now, do it yourself, or decide later
```

## Code-Red Flow (Diagnostic Mode)

```
User: roundtable code-red "login crashes on submit"
  → Triage round: initial assessment
  → Blind round: independent diagnosis (no anchoring bias)
  → Convergence rounds: compare root_cause_keys
  → FILE_REQUEST protocol: knights request specific files
  → Convergence: 2+ knights same key + confidence >= 8
  → Fix now / Report only / Log for later
```

---

## Consensus System

Each knight ends their turn with a structured JSON block:

```json
{
  "consensus_score": 8,
  "agrees_with": ["JWT basis", "NextAuth wrapper"],
  "pending_issues": ["Token refresh strategy still open"]
}
```

**Rules:**
- Score 0-5: Fundamental objections
- Score 6-8: Partially agrees, open points
- Score 9-10: Fully agrees
- **Consensus = all active knights score >= 9 AND pending_issues empty**

## Diagnostic System (Code-Red)

Each doctor ends their turn with:

```json
{
  "confidence_score": 8,
  "root_cause_key": "stale-auth-token-not-refreshed",
  "evidence": ["token expires after 1h", "no refresh logic found"],
  "rules_out": ["network-error", "cors-issue"],
  "confirms": ["auth module handles login correctly"],
  "file_requests": ["src/auth/token.ts:10-50"],
  "next_test": "check if refresh endpoint exists"
}
```

**Convergence = 2+ doctors same root_cause_key (exact or fuzzy) + confidence >= 8**

---

## Config Specification

```json
{
  "version": "1.0",
  "project": "MyProject",
  "language": "en",
  "knights": [
    {
      "name": "Claude",
      "adapter": "claude-cli",
      "capabilities": ["architecture", "refactoring", "debugging"],
      "priority": 1,
      "fallback": "claude-api"
    }
  ],
  "rules": {
    "max_rounds": 5,
    "consensus_threshold": 9,
    "timeout_per_turn_seconds": 120,
    "escalate_to_user_after": 3,
    "auto_execute": false,
    "ignore": [".git", "node_modules", "dist"]
  }
}
```

---

## Tech Stack

| Component | Choice | Reason |
|-----------|--------|--------|
| Language | TypeScript | Type safety, npm ecosystem |
| Runtime | Node.js 20+ | Universal CLI standard |
| CLI framework | commander.js | Most popular CLI framework |
| Process spawning | execa | Better child_process wrapper |
| HTTP client | fetch (native) | No extra dependency |
| Terminal UI | chalk + ora | Colors and spinners |

---

## Safety Model

- **Discussion phase:** Read-only access to project files, writes only to `.roundtable/`
- **Apply phase:** Requires explicit `roundtable apply` from the user
- **Parley mode (default):** Each file shown for approval before writing
- **No Parley mode:** Writes everything directly (opt-in, dangerous)

---

## License

MIT — [polatinos](https://github.com/polatinos)
