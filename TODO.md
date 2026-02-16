# TODO.md - TheRoundtAIble

## Status Legenda
- `[ ]` Open
- `[~]` In Progress
- `[x]` Done

---

## Fase 0: Concept & Setup

- [x] Vergaderruimte discussie (Claude + Gemini consensus)
- [x] CLAUDE.md "Bible" schrijven
- [x] Project folder aanmaken
- [x] package.json + tsconfig.json
- [x] Git repo initialiseren
- [ ] README.md voor open source

---

## Fase 1: Core Orchestrator

- [x] CLI entry point (`commander.js`)
  - [x] `roundtable init`
  - [x] `roundtable discuss "vraag"`
  - [x] `roundtable status` (placeholder)
  - [x] `roundtable apply` (placeholder)
  - [x] `roundtable summon` (placeholder)
  - [x] `roundtable chronicle` (placeholder)
- [x] Orchestrator: ronde-logica + turn management
- [x] Consensus engine: score parsing + detectie
- [x] System prompt builder (template + context injection)

---

## Fase 2: Adapters (Tier 1)

- [x] BaseAdapter abstracte klasse
- [x] Claude Code CLI adapter (`claude -p`)
- [ ] Gemini CLI adapter (`gemini -p`)
- [ ] OpenAI API adapter (REST, API key)
- [x] Adapter auto-detectie (`which claude`, `which gemini`)
- [ ] Fallback logica (CLI -> API)

---

## Fase 3: Context & Chronicle

- [x] Git context extractie (diff, branch, commits)
- [x] Project file reader (met ignore filters)
- [x] Context verification (bestanden checken voor tokens)
- [x] Chronicle lezen/schrijven/samenvatten
- [x] Session management (folders aanmaken, status bijhouden)

---

## Fase 4: Polish & Release

- [x] Error handling + graceful failures
- [ ] Interactieve `init` wizard
- [x] Mooie terminal output (chalk/ora spinners)
- [ ] npm package publiceren
- [ ] README.md met installatie + quick start
- [ ] GitHub repo aanmaken + eerste release

---

*Laatst bijgewerkt: 16 feb 2026*
