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
- [ ] package.json + tsconfig.json
- [ ] Git repo initialiseren (wacht op Tarik)
- [ ] README.md voor open source

---

## Fase 1: Core Orchestrator

- [ ] CLI entry point (`commander.js`)
  - [ ] `roundtable init`
  - [ ] `roundtable discuss "vraag"`
  - [ ] `roundtable status`
  - [ ] `roundtable apply`
  - [ ] `roundtable summon`
  - [ ] `roundtable chronicle`
- [ ] Orchestrator: ronde-logica + turn management
- [ ] Consensus engine: score parsing + detectie
- [ ] System prompt builder (template + context injection)

---

## Fase 2: Adapters (Tier 1)

- [ ] BaseAdapter abstracte klasse
- [ ] Claude Code CLI adapter (`claude -p`)
- [ ] Gemini CLI adapter (`gemini -p`)
- [ ] OpenAI API adapter (REST, API key)
- [ ] Adapter auto-detectie (`which claude`, `which gemini`)
- [ ] Fallback logica (CLI -> API)

---

## Fase 3: Context & Chronicle

- [ ] Git context extractie (diff, branch, commits)
- [ ] Project file reader (met ignore filters)
- [ ] Context verification (bestanden checken voor tokens)
- [ ] Chronicle lezen/schrijven/samenvatten
- [ ] Session management (folders aanmaken, status bijhouden)

---

## Fase 4: Polish & Release

- [ ] Error handling + graceful failures
- [ ] Interactieve `init` wizard
- [ ] Mooie terminal output (chalk/ora spinners)
- [ ] npm package publiceren
- [ ] README.md met installatie + quick start
- [ ] GitHub repo aanmaken + eerste release

---

*Laatst bijgewerkt: 16 feb 2026*
