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
  - [x] `roundtable decrees` (King's Decree Log)
  - [x] `roundtable manifest` (implementation tracking)
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

- [x] Error handling + graceful failures (centralized errors.ts)
- [x] Interactive `init` wizard
- [x] Terminal output (chalk/ora spinners, knight personalities)
- [x] King's Choice flow (consensus → apply in one flow)
- [x] Dynamic version from package.json (DRY)
- [x] .gitignore — no personal files in repo
- [x] README.md with installation + quick start
- [x] architecture-docs.md for public repo
- [x] npm package publish
- [x] GitHub first release

---

## Phase 5: Safety & Integrity (added 17 feb 2026)

### Scoped Apply (knight consensus — session 1224)
- [x] Add `files_to_modify` to ConsensusBlock (required at score >= 9)
- [x] `NEW:path` prefix for new file creation
- [x] Light validation (warn) at consensus claim, hard fail at `apply`
- [x] Orchestrator scope enforcement — reject writes outside allowed list
- [x] `--override-scope` flag with confirmation + reason + audit log
- [ ] Diff-mode output (v2, opt-in experiment — RTDIFF/1 format designed)

### Source Context Injection (session 1718)
- [x] Read allowed_files content into apply prompt
- [x] sha256 hash per file for integrity
- [x] 150KB hard limit with actionable error
- [x] 7 mandatory editing rules ("EDIT, DON'T REWRITE")

### King's Decree Log (session 1620)
- [x] decree-log.json append-only storage
- [x] 3 event types: rejected_no_apply, deferred, override_scope
- [x] Prompt injection (max 5 recent, revoked: false)
- [x] `roundtable decrees` read-only command
- [x] Log on "self"/"later" in discuss + on scope override in apply

### Implementation Manifest
- [x] manifest.json append-only storage
- [x] `roundtable manifest list/add/deprecate/check` commands
- [x] Manifest summary injected into knight system prompt
- [x] Partial apply tracking (implemented vs partial)

### Centralized Error Handling (session 1550)
- [x] RoundtableError hierarchy (5 subclasses + exit codes 1-5, 99)
- [x] Single `handleCliError()` in index.ts — only process.exit location
- [x] classifyError mandatory in all adapters
- [x] Hints for user-actionable error messages

---

## Open Issues

- [x] DRY refactor: parseConsensus duplication in base.ts + consensus.ts (fixed session 18 feb)
- [x] Regex fallback for consensus JSON fails with nested braces (fixed: balanced brace state machine)
- [x] discuss.ts still has process.exit(1) — should use typed throws (fixed: ConfigError)
- [ ] Tests (~40 cases, plan via consensus session)
- [ ] 150KB source context limit too small for large projects — need diff-mode or increase

### Known Limitation: `roundtable apply` unreliable on large files (>200 lines)

**Status:** Work in progress — USE AT OWN RISK

**Problem:** When the Lead Knight needs to edit large files (e.g. apply.ts at 600 lines), the EDIT: blocks consistently have bracket balance errors (missing `}`, extra `]`, unclosed `(`). The validation pipeline correctly blocks these bad edits (0 files written), but the knight cannot reliably produce clean output for large files.

**What works:**
- `roundtable discuss` — works reliably, knights produce good text output
- `roundtable apply` on small files (<200 lines) — generally works
- Validation pipeline — correctly blocks bad output (57/57 tests pass)
- Scope enforcement — correctly blocks out-of-scope writes
- Backup system — creates backups before any write

**What doesn't work yet:**
- `roundtable apply` on large files — knight EDIT: output has bracket errors
- Fix-call retry (sends broken code back to knight for targeted fix) — knight either makes the same errors or breaks character
- Knights sometimes ignore EDIT: format and output plain code blocks

**Current mitigations:**
- Validation pipeline blocks ALL bad output (all-or-nothing)
- Fix-call retry: up to 2 retries with broken code + specific errors (experimental)
- `--disallowedTools` flag on Claude CLI prevents tool-use instead of text output

**Planned solutions:**
- Per-function apply (send only relevant functions, not entire files)
- Smarter fix-call (smaller scope, only the broken section)
- Better prompt engineering for EDIT: format compliance

---

## Future (Post-Release)

- [ ] VS Code extension
- [ ] Web dashboard
- [ ] More adapters (DeepSeek, Llama, Mistral)
- [ ] CI/CD integration (GitHub Actions)
- [ ] `@roundtable` code comments (file watcher / git hook)
- [ ] Real-time streaming output
- [ ] Auto-execute mode (with safeguards)

---

*Last updated: 18 feb 2026*
