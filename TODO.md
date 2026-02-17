# TODO.md - TheRoundtAIble

## Status Legend
- `[ ]` Open
- `[~]` In Progress
- `[x]` Done

---

## Phase 0: Concept & Setup

- [x] Architecture design (consensus between Claude + Gemini)
- [x] Project folder + package.json + tsconfig.json
- [x] Git repo initialized
- [x] README.md for open source
- [x] architecture-docs.md for contributors

---

## Phase 1: Core Orchestrator

- [x] CLI entry point (`commander.js`)
  - [x] `roundtable init`
  - [x] `roundtable discuss "topic"`
  - [x] `roundtable status`
  - [x] `roundtable apply` (parley / no parley)
  - [x] `roundtable summon` (git diff based)
  - [x] `roundtable chronicle`
  - [x] `roundtable list`
  - [x] `roundtable code-red "symptoms"` (diagnostic mode)
- [x] Orchestrator: round logic + turn management
- [x] Consensus engine: score parsing + detection
- [x] Diagnostic engine: convergence + fuzzy matching
- [x] System prompt builder (template + context injection)
- [x] Diagnostic prompt builder (medical theme + blind rounds)

---

## Phase 2: Adapters (Tier 1)

- [x] BaseAdapter abstract class
- [x] Claude Code CLI adapter (`claude -p`)
- [x] Gemini CLI adapter (`gemini -p`)
- [x] OpenAI API adapter (REST, API key)
- [x] OpenAI CLI adapter (`codex`)
- [x] Adapter auto-detection (`which claude`, `which gemini`)
- [x] Fallback logic (CLI -> API)

---

## Phase 3: Context & Chronicle

- [x] Git context extraction (diff, branch, commits)
- [x] Project file reader (with ignore filters)
- [x] Context verification (check files before spending tokens)
- [x] Chronicle read/write/summarize
- [x] Session management (folder creation, status tracking)
- [x] Error log management (CR-XXX, OPEN/RESOLVED/PARKED)

---

## Phase 4: Polish & Release

- [x] Error handling + graceful failures
- [x] Interactive `init` wizard
- [x] Terminal output (chalk/ora spinners, knight personalities)
- [x] King's Choice flow (consensus → apply in one flow)
- [x] Dynamic version from package.json (DRY)
- [x] .gitignore — no personal files in repo
- [x] README.md with installation + quick start
- [x] architecture-docs.md for public repo
- [ ] npm package publish
- [ ] GitHub first release

---

## Future (Post-Release)

### Scoped Apply (knight consensus — session 1224)
- [ ] Add `files_to_modify` to ConsensusBlock (required at score >= 9)
- [ ] `NEW:path` prefix for new file creation
- [ ] Light validation (warn) at consensus claim, hard fail at `apply`
- [ ] Orchestrator scope enforcement — reject writes outside allowed list
- [ ] `--override-scope` flag with confirmation + reason + audit log
- [ ] Diff-mode output (v2, opt-in experiment)

### Other
- [ ] Tests (~40 cases, plan via consensus session)
- [ ] DRY refactor: parseConsensus duplication in base.ts + consensus.ts
- [ ] Integrate `src/utils/hash.ts` (created by knight apply, unused)
- [ ] VS Code extension
- [ ] Web dashboard
- [ ] More adapters (DeepSeek, Llama, Mistral)
- [ ] CI/CD integration (GitHub Actions)

---

*Last updated: 17 feb 2026*
