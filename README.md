# TheRoundtAIble

> **"Where no AI is King, but all serve the Code."**

A CLI tool that lets multiple AI models (Claude, Gemini, GPT) automatically discuss software problems and reach consensus — so you don't have to be the messenger between them.

## How it works

1. You ask a question
2. TheRoundtAIble sends it to your configured AI "knights"
3. Each knight responds and scores how much they agree
4. Rounds continue until **consensus** is reached or max rounds hit
5. The decision is saved and a Lead Knight can execute it

```
You: roundtable discuss "How should we refactor the auth module?"

  Round 1:
    Claude → proposes JWT with NextAuth wrapper (score: 7/10)
    Gemini → agrees, suggests refresh token strategy (score: 8/10)

  Round 2:
    Claude → accepts refresh strategy, adds edge cases (score: 9/10)
    Gemini → fully agrees (score: 10/10)

  CONSENSUS REACHED
```

## Key principle

**No API keys required by default.** Works with your existing subscriptions (Claude Pro/Max, Gemini Advanced, ChatGPT Plus). API keys are an optional fallback.

## Installation

```bash
# Clone the repository
git clone https://github.com/polatinos/TheRoundtAIble.git
cd TheRoundtAIble

# Install dependencies
npm install

# Build
npm run build

# Link globally (optional, for `roundtable` command)
npm link
```

### Prerequisites

- Node.js 20+
- At least one AI CLI tool:
  - [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (`claude` CLI)
  - [Gemini CLI](https://github.com/google-gemini/gemini-cli) (`gemini` CLI)
  - Or an OpenAI API key (`OPENAI_API_KEY` env var)

## Quick start

```bash
# Initialize in your project
cd your-project
roundtable init

# Start a discussion
roundtable discuss "How should we structure the database schema?"

# Check status
roundtable status

# Apply the decision (Lead Knight executes)
roundtable apply
```

### `roundtable init`

Interactive wizard that:
- Detects available AI tools on your system
- Lets you choose which knights to enable
- Generates `.roundtable/config.json`
- Creates the chronicle (decision log)

### `roundtable discuss "question"`

Starts a discussion between your configured knights:
- Builds project context (git info, key files, chronicle)
- Runs round-robin turns until consensus or max rounds
- Writes session files (discussion, decisions, status)

### `roundtable summon`

Starts a discussion based on your current `git diff` — useful for code review.

## Project structure

```
your-project/
  .roundtable/
    config.json          # Which knights, rules, capabilities
    chronicle.md         # Decision log (persistent memory)
    sessions/
      2026-02-16-auth-refactor/
        topic.md         # The question
        discussion.md    # Full discussion (all rounds)
        decisions.md     # The consensus decision
        status.json      # Current phase and progress
```

## Configuration

After `roundtable init`, edit `.roundtable/config.json`:

```json
{
  "knights": [
    {
      "name": "Claude",
      "adapter": "claude-cli",
      "capabilities": ["architecture", "debugging", "testing"],
      "priority": 1,
      "fallback": "claude-api"
    }
  ],
  "rules": {
    "max_rounds": 5,
    "consensus_threshold": 9,
    "timeout_per_turn_seconds": 120
  }
}
```

**Consensus threshold:** All knights must score >= this value (0-10) AND have no pending issues.

## Adapters

| Adapter | Method | Subscription? | Fallback |
|---------|--------|--------------|----------|
| `claude-cli` | `claude -p "prompt" --print` | Claude Pro/Max | `claude-api` |
| `gemini-cli` | `gemini -p "prompt"` | Gemini Advanced | `gemini-api` |
| `openai-api` | OpenAI REST API | No (API key) | — |

## Roadmap

- [x] CLI with `init` and `discuss`
- [x] Claude, Gemini, and OpenAI adapters
- [x] Consensus engine
- [x] Chronicle (decision memory)
- [ ] `roundtable apply` — execute decisions
- [ ] `roundtable summon` — git-diff based discussions
- [ ] VS Code extension
- [ ] Web dashboard
- [ ] More adapters (DeepSeek, Llama, Mistral)

## License

MIT — Tarik Polat ([polatinos](https://github.com/polatinos))
