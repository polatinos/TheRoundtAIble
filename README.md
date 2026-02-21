# TheRoundtAIble

> **"Where no AI is King, but all serve the Code."**

A CLI tool that lets multiple AI models (Claude, Gemini, GPT) automatically discuss software problems and reach consensus — so you don't have to be the messenger between them.

## How it works

1. You ask a question
2. TheRoundtAIble sends it to your configured AI "knights"
3. Each knight responds with their proposal and scores agreement (0-10)
4. Rounds continue until **consensus** is reached or max rounds hit
5. You choose: let the Lead Knight execute, do it yourself, or decide later

```
You: roundtable discuss "How should we refactor the auth module?"

  ROUND 1 — KNIGHTS! DRAW YOUR KEYBOARDS!

    Claude (7/10) → proposes JWT with NextAuth wrapper
    Gemini (8/10) → agrees, suggests refresh token strategy
    GPT    (6/10) → "Can we just ship it?"

  ROUND 2 — FOR KING AND KONG!

    Claude (9/10) → accepts refresh strategy
    Gemini (10/10) → fully agrees
    GPT    (9/10)  → "Fine, let's do it properly"

  Against all odds... they actually agree.

  What is your decree, Your Majesty?
  1. Let the knights forge it — they write the code
  2. I'll wield the sword myself — just show me the plan
  3. Adjourn the court — decide later
```

## Key principle

**No API keys required by default.** Works with your existing AI subscriptions (Claude Pro/Max, Gemini Advanced, ChatGPT Plus). API keys are an optional fallback.

## Installation

```bash
npm install -g theroundtaible
```

Or use without installing:

```bash
npx theroundtaible init
```

### Updating

```bash
npm update -g theroundtaible
```

Check your version:

```bash
roundtable --version
```

### Prerequisites

- Node.js 20+
- At least one AI tool:
  - [Claude Code](https://docs.anthropic.com/en/docs/claude-code) — `claude` command
  - [Gemini CLI](https://github.com/google-gemini/gemini-cli) — `gemini` command
  - [Codex CLI](https://github.com/openai/codex) — `codex` command
  - OpenAI API key (`OPENAI_API_KEY` env var) as fallback
  - [Ollama](https://ollama.com/) or [LM Studio](https://lmstudio.ai/) for local models

## Quick start

```bash
# Initialize in your project (run this once per project)
cd your-project
roundtable init

# Start a discussion
roundtable discuss "How should we structure the database schema?"

# Review based on current git changes
roundtable summon

# Apply the consensus decision
roundtable apply

# Emergency bug diagnosis
roundtable code-red "login page crashes on submit"
```

> **Note:** Each project needs its own `roundtable init`. This creates a `.roundtable/` folder with project-specific config, chronicle (decision history), and session data. Your API keys are stored globally (`~/.theroundtaible/keys.json`), so you only enter them once.

## Commands

| Command | Description |
|---------|-------------|
| `roundtable init` | Interactive setup wizard — detects your AI tools |
| `roundtable discuss "topic"` | Start a multi-AI discussion |
| `roundtable summon` | Start a discussion based on your `git diff` |
| `roundtable apply` | Execute the consensus decision (Lead Knight writes code) — **BETA** |
| `roundtable apply --noparley` | Execute without file-by-file review (dangerous) |
| `roundtable apply --dry-run` | Run full pipeline without writing files — see what would happen |
| `roundtable apply --override-scope` | Bypass file scope enforcement (requires reason) |
| `roundtable code-red "symptoms"` | Emergency diagnostic mode — knights become doctors |
| `roundtable manifest list` | Show all tracked features in the implementation manifest |
| `roundtable manifest check` | Check manifest for stale entries (deleted files) |
| `roundtable manifest add <id> --files` | Manually add a feature to the manifest |
| `roundtable manifest deprecate <id>` | Mark a feature as deprecated |
| `roundtable status` | Show current session status |
| `roundtable list` | List all discussion sessions |
| `roundtable chronicle` | View the decision log |

## Configuration

After `roundtable init`, your `.roundtable/config.json` controls everything:

```json
{
  "knights": [
    {
      "name": "Claude",
      "adapter": "claude-cli",
      "capabilities": ["architecture", "debugging", "testing"],
      "priority": 1,
      "fallback": "claude-api"
    },
    {
      "name": "Gemini",
      "adapter": "gemini-cli",
      "capabilities": ["docs", "ui-ux", "planning"],
      "priority": 2
    }
  ],
  "rules": {
    "max_rounds": 5,
    "consensus_threshold": 9,
    "timeout_per_turn_seconds": 120
  }
}
```

**Consensus threshold:** All knights must score >= this value AND have no pending issues.

## Adapters

| Adapter | Method | Subscription? | Fallback |
|---------|--------|---------------|----------|
| `claude-cli` | `claude -p "prompt" --print` | Claude Pro/Max | `claude-api` |
| `gemini-cli` | `gemini -p "prompt"` | Gemini Advanced | `gemini-api` |
| `openai-cli` | `codex "prompt"` | ChatGPT Pro | `openai-api` |
| `openai-api` | OpenAI REST API | No (API key) | — |
| `local-llm` | OpenAI-compat or Ollama native | No (runs locally) | — |

## Code-Red mode

When a bug won't die, call in the doctors:

```bash
roundtable code-red "the API returns 500 on user creation"
```

The knights switch to diagnostic mode:
- **Triage round:** Initial assessment of symptoms
- **Blind round:** Each doctor diagnoses independently (prevents groupthink)
- **Convergence rounds:** Doctors compare findings and converge on root cause
- **File requests:** Doctors can request specific source files as evidence

When they agree on a diagnosis, you choose: **Fix now**, **Report only**, or **Log for later**.

All diagnoses are tracked in `.roundtable/error-log.md` with CR-XXX IDs.

## Implementation Manifest

TheRoundtAIble tracks what has been built. After each `roundtable apply`, the manifest is automatically updated so knights don't re-propose features that already exist.

```bash
# See what's been built
roundtable manifest list

  [+] auth-refactor — JWT with NextAuth wrapper
      Status: implemented | Knight: Claude | 2026-02-17
      Files: src/lib/auth.ts, src/middleware.ts

  [~] user-dashboard — Dashboard component with charts
      Status: partial | Knight: Gemini | 2026-02-17
      Files: src/components/Dashboard.tsx
      Skipped: src/components/Charts.tsx

# Check for stale entries (files that no longer exist)
roundtable manifest check
```

Knights see the manifest in their system prompt, preventing duplicate proposals.

### Scoped Apply

When knights reach consensus (score >= 9), they declare which files they intend to modify. The `apply` command enforces this scope:

- Files outside the agreed scope are **blocked** (shown in red)
- Use `--override-scope` to bypass (requires typing "YES" + a reason, logged for audit)
- Old sessions without scope data work normally (no enforcement)

## Project structure

```
your-project/
  .roundtable/
    config.json          # Which knights, rules, capabilities
    chronicle.md         # Decision log (persistent memory)
    manifest.json        # Implementation manifest (what's been built)
    error-log.md         # Code-red diagnostic log
    sessions/
      2026-02-16-auth-refactor/
        topic.md         # The question
        discussion.md    # Full discussion (all rounds)
        decisions.md     # The consensus decision
        status.json      # Current phase and progress
```

## Architecture

See [architecture-docs.md](architecture-docs.md) for the full technical architecture, project structure, and contribution guide.

## Roadmap

- [x] Multi-AI discussions with consensus
- [x] Claude, Gemini, and OpenAI adapters
- [x] Knight personalities (they roast each other)
- [x] Apply decisions with Parley/No Parley modes
- [x] Code-Red emergency diagnostic mode
- [x] Git-diff based discussions (`summon`)
- [x] Chronicle (persistent decision memory)
- [x] Implementation Manifest (tracks what's been built)
- [x] Scoped Apply (knights declare files, apply enforces scope)
- [x] Local LLM support (Ollama, LM Studio)
- [ ] VS Code extension
- [ ] Web dashboard for session visualization
- [ ] More adapters (DeepSeek, Llama, Mistral)
- [ ] CI/CD integration (GitHub Actions)

## Local LLMs

TheRoundtAIble supports local models through [Ollama](https://ollama.com/) and [LM Studio](https://lmstudio.ai/). Run `roundtable init` and any running local server will be auto-detected.

### Which platform should I use?

**We recommend Ollama.** Here's why:

| | Ollama | LM Studio |
|---|---|---|
| Context window | Auto-detected, set programmatically | Manual setup required |
| Headless / CI | Yes (`ollama serve`) | No (GUI required) |
| Model switching | Automatic via API | Manual in GUI |
| Multi-model | Run multiple models concurrently | One model at a time |
| Setup | `ollama pull model-name` | Download through GUI |

Ollama gives TheRoundtAIble full programmatic control — context window size is detected automatically and allocated dynamically per prompt. LM Studio requires you to manually configure Context Length and Response Limit in the GUI.

### Hardware requirements

Local models run on your GPU. Bigger models = better discussion quality, but more VRAM:

| Model size | VRAM needed | Discussion quality |
|---|---|---|
| 7B parameters | ~4-6 GB | Basic responses, limited reasoning |
| 14B parameters | ~8-10 GB | Can participate, but may repeat itself |
| 30B+ parameters | ~16-24 GB | Meaningful contributions, can hold multi-round debates |
| 70B+ parameters | ~32-48 GB | Comparable to cloud models |

**Our honest take:** Models under 30B struggle with multi-round discussions. They tend to repeat themselves, ignore other knights' arguments, and miss the collaborative spirit (no roasting!). Cloud knights (Claude, Gemini, GPT) handle 100K+ tokens and produce richer debates. Local models shine when you want privacy or offline access — but for best results, mix them with at least one cloud knight.

### LM Studio setup

If you choose LM Studio, you **must** manually adjust these settings (Developer tab > Model Settings):

- **Context Length:** increase to at least 16384 (default 4096 is too small)
- **Response Limit:** uncheck the limit, or set to 4096+

Higher context = more VRAM and slower responses. Find the sweet spot for your GPU.

### How it works under the hood

- **Ollama:** Uses the native `/api/chat` endpoint with dynamic `num_ctx` — only allocates as much context as the prompt needs, saving GPU memory
- **LM Studio:** Uses the OpenAI-compatible `/v1/chat/completions` endpoint
- **Auto-detection:** `roundtable init` probes `localhost:11434` (Ollama) and `localhost:1234` (LM Studio), discovers loaded models, and filters out non-chat models (embeddings, TTS, etc.)
- **Context budgeting:** The orchestrator detects each local model's context window and adjusts the source code payload so it fits — cloud knights get the full context, local knights get a trimmed version

## Known Limitations

### `roundtable apply` — BETA, use at own risk

`roundtable apply` works but is in beta. The block-level system (RTDIFF/1) lets knights target specific functions and classes instead of rewriting entire files, which solved the reliability issues with large files. Validation catches bad output before anything is written — your code is safe.

**What works:**
- `roundtable discuss` — multi-AI discussions work reliably
- `roundtable apply` — writes code via block-level operations (tested on 600+ line files)
- `roundtable apply --dry-run` — test the full pipeline without writing anything
- Validation pipeline — blocks bad output (157 tests, no corrupted files)
- Scope enforcement + backup system

**Known risks:**
- Output quality depends on the LLM — validation blocks bad code but nothing gets written
- Single attempt, no retry — if the knight fails, you re-run or apply manually
- More real-world testing needed

If apply fails, read the decision in `.roundtable/sessions/*/decisions.md` and apply manually.

## License

MIT — Tarik Polat ([polatinos](https://github.com/polatinos))
