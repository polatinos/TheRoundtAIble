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
- [x] Block-level apply with RTDIFF/1 (block-scanner + diff-parser + BLOCK_MAP prompt)

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
- [~] Tests (157/157 passing — block-scanner 34, diff-parser 66, validation 57)
- [x] 150KB source context limit — increased to 500KB + 80KB per-file truncation

### `roundtable apply` — BETA (use at own risk)

**Status:** Working but beta — the block-level system fixed the large file problem.

**What happened:** EDIT: search-and-replace was unreliable on large files. The knights designed a new block-level system (RTDIFF/1) in a roundtable discussion, which was implemented and tested. First successful apply on a 600+ line file.

**What works:**
- `roundtable discuss` — works reliably
- `roundtable apply` — works with new block-level system (BLOCK_REPLACE, BLOCK_INSERT_AFTER, BLOCK_DELETE)
- `roundtable apply --dry-run` — test entire pipeline without writing
- Validation pipeline — blocks bad output (157/157 tests pass)
- Scope enforcement — blocks out-of-scope writes
- Backup system — creates backups before any write
- Legacy EDIT: format still supported (with deprecation warning)

**Known risks:**
- Knight output quality depends on the LLM — bad output is blocked by validation but nothing gets written
- Single attempt only — no retry loop (hard fail > infinite retry)
- Beta: more real-world testing needed

---

## Phase 6: Testing & Hardening

### Functionele Tests (handmatig)
- [ ] Knight memory/chronicle — werkt context van eerdere sessies door in nieuwe discussies?
- [x] `roundtable code-red` — live test met echte symptomen, werkt diagnose flow?
- [x] `roundtable apply --no-parley` — skip per-bestand review, schrijft alles in één keer
- [x] `roundtable apply` live test — echte knight output, verify dat goede code WEL geschreven wordt
- [ ] `roundtable apply` met opzettelijk kapotte knight output — blocked by validation?
- [ ] GPT als lead knight — hertesten nu met 16K max_tokens
- [ ] Chronicle memory — weten knights wat er eerder is besloten + wat nog open staat?
- [ ] Adapter fallback — CLI niet beschikbaar → valt terug naar API?
- [ ] Extra LLMs toevoegen — Ollama (lokaal), DeepSeek, Mistral etc. via config testen
- [ ] Custom adapter flow — kan een gebruiker makkelijk een nieuwe LLM toevoegen?
- [x] `roundtable summon` — git diff review, knights worden opgeroepen
- [x] `roundtable status` — toont laatste sessie info correct
- [x] `roundtable chronicle` — laadt eerdere beslissingen
- [x] `roundtable list` — 26 sessies, alle statussen correct
- [x] `roundtable decrees` — decree log werkt
- [x] `roundtable manifest list` — 5 features, alle knights als lead

### Code Quality
- [ ] `hash.ts` integratie afronden (aangemaakt maar niet overal gebruikt)
- [ ] Extra unit tests voor edge cases (consensus parsing, malformed JSON, empty responses)
- [ ] Error recovery — wat als adapter crasht mid-discussie? Graceful failure?

---

## Future (Post-Release)

### Lessons from CCB (claude_code_bridge) — feb 2026
*Bron: github.com/bfly123/claude_code_bridge — complementaire tool, geen concurrent*

**v1.1 (low-risk, na tests af):**
- [ ] Consensus markers (`---ROUNDTABLE_CONSENSUS_BEGIN/END---`) als extra anchor boven huidige balanced-brace parser (fallback blijft, niet vervangen)
- [ ] APPLY_COMPLETE marker — orchestrator kapt output af na marker, bespaart tokens
- [ ] Context samenvatting voor rondes — tool outputs/code blocks comprimeren voordat ze naar volgende knight gaan (minder tokens per ronde)
- [ ] Stale lock detection — PID-based check op `state.json` zodat crashed sessies niet locken

**v2 (grotere wijzigingen):**
- [ ] Session log reading als fallback — Claude's `.jsonl` logs lezen als stdout capture faalt (crash recovery)
- [ ] Daemon/worker pool architectuur — voor parallel knight queries en real-time streaming

### Existing ideas
- [ ] VS Code extension
- [ ] Web dashboard
- [ ] More adapters (DeepSeek, Llama, Mistral)
- [ ] CI/CD integration (GitHub Actions)
- [ ] `@roundtable` code comments (file watcher / git hook)
- [ ] Real-time streaming output
- [ ] Auto-execute mode (with safeguards)

---

### Bugs gevonden & gefixed in sessie 18 feb #5
- [x] process.exit(1) in summon.ts, chronicle.ts, code-red.ts → throw/propagate pattern
- [x] claude-cli.ts `where` (Windows-only) → `--version` (cross-platform)
- [x] file-writer.ts path prefix collision (`startsWith(root)` → `startsWith(root + sep)`)
- [x] orchestrator.ts display regex `[^{}]*` → balanced brace `stripConsensusJson`
- [x] gemini-cli.ts crash in plan mode → `-e ""` flag + accept stdout on non-zero exit
- [x] code-red double question (decree + parley) → 4-option decree, no second question
- [x] code-red false RESOLVED (applyCommand returns count, 0 = not resolved)
- [x] code-red missing allowed_files in status.json → collect from diagnostic file_requests
- [x] apply.ts path matching for abbreviated knight paths
- [x] code-red-prompt.md misleading header → "BESCHIKBARE BRONCODE"
- [x] prompt.ts triage instruction ignores codebase → hasCodebase flag

*Last updated: 18 feb 2026*
