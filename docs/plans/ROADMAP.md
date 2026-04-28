# Roadmap

This file is the index for active and upcoming work on TheRoundtAIble. Each milestone has its own plan file in this directory. Anyone (human or AI) picking up the project should start here.

## Vision

TheRoundtAIble is a **decision support tool** for software engineers who want a second, third, or fourth opinion before committing to an architectural choice, refactor, or design decision. It is not a code generator. It is not an agent. It is a structured way to extract genuinely useful disagreement from multiple LLMs.

The current implementation (v0.5.x) treats consensus as the goal. That is wrong. Polite agreement between LLMs is the failure mode of multi-LLM tooling, not its product. The product is **signal** — a clear recommendation, an honest description of what could go wrong, and a confidence level.

## Current state (v0.5.1)

- `roundtable discuss` runs N rounds of round-robin debate until knights score ≥ 9/10
- Output is a session folder with the full transcript and a `decisions.md` containing the last knight's proposal
- Three CLI adapters in working order: claude-cli, gemini-cli, openai-cli (Codex)
- API fallbacks: claude-api, gemini-api, openai-api
- Local LLM adapter (Ollama / LM Studio) for offline use

What works: chronicle as long-term memory, neutral orchestrator, no-API-key default.
What does not work well enough: convergence-by-politeness, transcript-shaped output, one-size-fits-all command.

## Active milestone

### v0.6 — Adversarial review

See [`v0.6-redesign.md`](./v0.6-redesign.md).

Replace the round-robin consensus loop with a fixed three-role pipeline:
**Proposer → Critic → Synthesizer**. Output is a structured decision record, not a transcript. New command `roundtable advise` is built next to `discuss`; `discuss` stays untouched until the new shape is proven.

## Backlog (no active plan yet)

- **Modes per use case.** `advise`, `check <file>`, `brainstorm`, `decide --record` (ADR-style). Each shape solves a different problem.
- **Disagreement health check.** Synthesizer flags when knights agreed too easily (potential shared blindspot).
- **Capability-driven role assignment.** The `capabilities` field in config currently does almost nothing. It should pick proposer/critic/synth automatically based on the topic.
- **Chronicle replacement.** Append-forever chronicle becomes context bloat. Split into `decisions/` (auto, archival) + curated `principles.md` (short, hand-edited, the only thing prompts read).
- **Cost/time preview before runs.** Show estimated calls + duration + cost (or "free, via subscriptions"), confirm before executing.
- **Personality as opt-in.** Default professional output. `--theatre` flag for "FOR KING AND KONG!".
- **Drop half-implemented agent features.** `file_requests` and `verify_commands` are stuck between "advise tool" and "agent". Pick one. The redesign picks advise.

## Workflow

1. Each session, open this file. Read "Active milestone" and the linked plan.
2. Pick the next unchecked task in that plan.
3. Do the task. Update the plan with what changed and what is still open.
4. End the session by writing the next concrete next-up at the bottom of the active plan file.

## Versioning

- `main` always stays in a publishable state for the current released version.
- Major redesigns happen on a `vX.Y-redesign` branch.
- A redesign branch only merges to `main` when the new shape is verified end-to-end and the corresponding npm version is ready to publish.
- Breaking changes get a major-equivalent bump (during 0.x: minor bump with `feat!:` prefix and migration notes).

## Last updated

2026-04-28 — initial roadmap, v0.6 redesign opened.
