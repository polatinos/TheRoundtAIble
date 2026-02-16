# CLAUDE.md - TheRoundtAIble

> **"Where no AI is King, but all serve the Code."**

Dit is het complete referentiedocument voor TheRoundtAIble — een open source multi-LLM collaboration protocol.

---

## Wat is TheRoundtAIble?

TheRoundtAIble is een CLI tool waarmee verschillende AI-modellen (Claude, Gemini, GPT-4, DeepSeek, etc.) automatisch met elkaar sparren over softwareproblemen. In plaats van dat een ontwikkelaar handmatig tussen AI's schakelt, orkestreert TheRoundtAIble het gesprek automatisch totdat consensus is bereikt. De beste AI voor de taak voert vervolgens het besluit uit.

**Kernprincipe:** Geen API keys nodig als standaard. Werkt met bestaande abonnementen (Claude Pro/Max, Gemini Advanced, ChatGPT Plus). API keys zijn een optionele fallback.

**Naam:** TheRound**tAI**ble (met AI erin).

---

## Oorsprong

Dit project is ontstaan uit de dagelijkse werkwijze van ontwikkelaar Tarik Polat, die met Claude (Anthropic) en Gemini (Google) samenwerkt via een gedeeld `vergaderruimte.md` bestand. De AI's schrijven hun analyses en voorstellen in dit bestand, lezen elkaars reacties, en komen tot consensus. Het probleem: Tarik moest handmatig als "postbode" fungeren tussen de AI's. TheRoundtAIble automatiseert dit proces.

**Eigenaar:** Tarik Polat
**GitHub:** github.com/polatinos/TheRoundtAIble
**Licentie:** MIT

---

## Architectuur (3 Lagen)

### Laag 1: Het Gedeelde Brein (`.roundtable/`)

Elk project dat TheRoundtAIble gebruikt heeft een `.roundtable/` folder in de root:

```
project-root/
  .roundtable/
    config.json              # Welke LLMs, capabilities, regels
    chronicle.md             # Levende samenvatting van alle beslissingen
    sessions/
      2026-02-16-auth-refactor/
        topic.md             # Het onderwerp/de vraag
        discussion.md        # De volledige discussie (alle rondes)
        decisions.md         # Het consensusbesluit
        status.json          # Fase, wie is aan de beurt, scores
```

**chronicle.md** is het collectieve geheugen. Nieuwe sessies beginnen met het lezen hiervan zodat eerder gemaakte architectuurbeslissingen niet herhaald worden.

### Laag 2: De Orchestrator (`roundtable` CLI)

Een lichtgewicht CLI tool (TypeScript/Node.js) die:
- De `.roundtable/` folder beheert
- LLMs om de beurt aanroept (round-robin)
- Consensus detecteert via scores
- De juiste LLM selecteert voor uitvoering (Lead Knight)
- Escaleert naar de gebruiker als geen consensus bereikt wordt

**De orchestrator is de neutrale voorzitter.** Geen LLM is voorzitter — dat zou het gesprek bevooroordelen naar de sterktes van die LLM.

### Laag 3: LLM Adapters (Knights)

Elke LLM heeft een adapter die weet HOE die LLM aan te roepen. Adapters zijn plug-and-play.

**Prioriteit per adapter:** Eerst CLI/abonnement proberen, dan fallback naar API key.

| Adapter | Methode | Abonnement? | Fallback |
|---------|---------|-------------|----------|
| `claude-cli` | `claude -p "prompt" --print` | Ja (Claude Pro/Max) | `claude-api` |
| `gemini-cli` | `gemini -p "prompt"` | Ja (Gemini Advanced) | `gemini-api` |
| `openai-api` | OpenAI REST API | Nee (API key) | - |
| `openai-cli` | `codex "prompt"` | Ja (ChatGPT Pro) | `openai-api` |

Alle 3 zijn "Tier 1 Adapters" voor v1.

---

## Config Specificatie (V1)

```json
{
  "version": "1.0",
  "project": "MijnProject",
  "language": "nl",
  "knights": [
    {
      "name": "Claude",
      "adapter": "claude-cli",
      "capabilities": ["architecture", "refactoring", "logic", "debugging", "testing"],
      "priority": 1,
      "fallback": "claude-api"
    },
    {
      "name": "Gemini",
      "adapter": "gemini-cli",
      "capabilities": ["docs", "ui-ux", "summarization", "review", "planning"],
      "priority": 2,
      "fallback": "gemini-api"
    },
    {
      "name": "GPT",
      "adapter": "openai-api",
      "capabilities": ["communication", "content", "explanation"],
      "priority": 3
    }
  ],
  "rules": {
    "max_rounds": 5,
    "consensus_threshold": 9,
    "timeout_per_turn_seconds": 120,
    "escalate_to_user_after": 3,
    "auto_execute": false,
    "ignore": [".git", "node_modules", "dist", "build", ".next"]
  },
  "chronicle": ".roundtable/chronicle.md",
  "adapter_config": {
    "claude-cli": {
      "command": "claude",
      "args": ["-p", "{prompt}", "--print"]
    },
    "gemini-cli": {
      "command": "gemini",
      "args": ["-p", "{prompt}"]
    },
    "openai-api": {
      "model": "gpt-4o",
      "env_key": "OPENAI_API_KEY"
    }
  }
}
```

### Capabilities

Capabilities zijn tags die beschrijven waar een Knight goed in is. De orchestrator gebruikt deze om de "Lead Knight" te kiezen voor uitvoering. Gebruikers kunnen ze aanpassen in config.

**Standaard capabilities:**
- `architecture` — systeemontwerp, structuur
- `refactoring` — code herstructureren
- `logic` — algoritmes, business logic
- `debugging` — bugs vinden en fixen
- `testing` — tests schrijven
- `docs` — documentatie
- `ui-ux` — gebruikersinterface, design
- `summarization` — samenvatten
- `review` — code review
- `planning` — project planning
- `communication` — uitleg, presentatie
- `content` — tekst schrijven
- `explanation` — complexe concepten uitleggen
- `security` — beveiligingsanalyse

---

## Discussie Flow

```
User: roundtable discuss "Hoe refactoren we de auth module?"
  |
  v
[Context Verification]
  Orchestrator checkt:
  - Bestaan de relevante project files?
  - Is chronicle.md leesbaar?
  - Zijn alle geconfigureerde adapters beschikbaar?
  -> Zo niet: vraag gebruiker om verduidelijking VOORDAT tokens verbruikt worden
  |
  v
[Context Opbouw]
  Orchestrator leest:
  - chronicle.md (eerdere beslissingen)
  - Relevante project files (package.json, src/lib/auth/, etc.)
  - Git context (huidige branch, recente commits, diff)
  |
  v
[Ronde 1]
  -> Knight #1 (Claude): [context] + [vraag] + "Geef je voorstel"
  <- Claude antwoordt met voorstel + consensus JSON
  -> Knight #2 (Gemini): [context] + [vraag] + [Claude's voorstel] + "Reageer"
  <- Gemini antwoordt met reactie + consensus JSON
  |
  v
[Ronde 2...N]
  -> Elke Knight reageert op de vorige rondes
  -> Orchestrator checkt na elke ronde: consensus bereikt?
  |
  v
[Consensus Check]
  Alle scores >= 9 EN geen pending_issues?
  -> JA: Schrijf decisions.md + update chronicle.md
  -> NEE + max rondes bereikt: Escaleer naar gebruiker
  -> NEE + rondes over: Volgende ronde
  |
  v
[Resultaat]
  User krijgt melding: "Consensus bereikt! Lees decisions.md"
  User kan `roundtable apply` draaien voor uitvoering door Lead Knight
```

---

## Consensus Systeem

Elke Knight eindigt zijn beurt met een gestructureerd JSON-blok:

```json
{
  "knight": "Claude",
  "round": 2,
  "consensus_score": 8,
  "agrees_with": ["JWT basis", "NextAuth wrapper"],
  "pending_issues": ["Token refresh strategie nog open"],
  "proposal": "De inhoudelijke tekst van het voorstel..."
}
```

**Regels:**
- Score 0-5: Fundamentele bezwaren
- Score 6-8: Gedeeltelijk eens, maar open punten
- Score 9-10: Volledig akkoord
- **Consensus = alle actieve Knights score >= 9 EN pending_issues leeg**
- Na `max_rounds` zonder consensus: escalatie naar gebruiker

---

## System Prompt Template

Elke Knight krijgt dit als system prompt bij elke beurt:

```
Je neemt deel aan een TheRoundtAIble discussie.
Je naam is: {knight_name}
Je capabilities: {capabilities}
Andere knights: {other_knights_with_capabilities}
Onderwerp: {topic}

REGELS:
1. Geef je eerlijke mening — wees het oneens als je het oneens bent.
2. Eindig ALTIJD met een JSON blok:
   { "consensus_score": 0-10, "agrees_with": [...], "pending_issues": [...] }
3. Score 9-10 = je bent het volledig eens met het huidige voorstel.
4. Score 0-5 = je hebt fundamentele bezwaren.
5. Lees de eerdere rondes voordat je reageert.
6. Wees beknopt — max 500 woorden per beurt.
7. Focus op het 'Waarom' achter je keuzes, niet alleen de code.

CHRONICLE (eerdere beslissingen van dit project):
{chronicle_content}

HUIDIGE DISCUSSIE:
{previous_rounds}
```

---

## CLI Commando's (V1)

```bash
# Initialiseer TheRoundtAIble in een project
roundtable init

# Start een discussie
roundtable discuss "Hoe moeten we de auth refactoren?"

# Start een sessie op basis van huidige git diff
roundtable summon

# Bekijk status van huidige discussie
roundtable status

# Pas het consensusbesluit toe (Lead Knight voert uit)
roundtable apply

# Bekijk de chronicle (beslissingenlog)
roundtable chronicle
```

### `roundtable init`
- Maakt `.roundtable/` folder
- Genereert `config.json` met interactieve wizard (welke LLMs heb je?)
- Detecteert beschikbare CLI tools (`claude --version`, `gemini --version`)
- Voegt `.roundtable/sessions/` toe aan `.gitignore` (optioneel)

### `roundtable discuss "vraag"`
- Start een nieuwe sessie in `.roundtable/sessions/`
- Bouwt context op (chronicle + project files + git)
- Voert rondes uit totdat consensus of max_rounds
- Output: `decisions.md` + bijgewerkte `chronicle.md`

### `roundtable summon`
- Leest huidige `git diff` en ongecommitte wijzigingen
- Formuleert automatisch een discussievraag op basis van de diff
- Start een discuss sessie

### `roundtable apply`
- Leest `decisions.md` van de laatste sessie
- Selecteert Lead Knight op basis van capabilities + taaktype
- Geeft het besluit aan de Lead Knight met instructie om uit te voeren
- **Vereist expliciet user consent** (v1 safety)

---

## Project Structuur

```
TheRoundtAIble/
  src/
    index.ts              # CLI entry point (commander.js)
    orchestrator.ts       # Ronde-logica, turn management
    consensus.ts          # Score parsing, consensus detectie
    adapters/
      base.ts             # Abstracte BaseAdapter klasse
      claude-cli.ts       # Claude Code CLI adapter
      gemini-cli.ts       # Gemini/Antigravity CLI adapter
      openai-api.ts       # OpenAI REST API adapter
    utils/
      chronicle.ts        # Chronicle lezen/schrijven/samenvatten
      git.ts              # Git diff, branch info, recent commits
      context.ts          # Project context opbouwen (files lezen, filteren)
      prompt.ts           # System prompt templating
  templates/
    config.default.json   # Default config template
    system-prompt.md      # System prompt template
  package.json
  tsconfig.json
  CLAUDE.md               # Dit bestand
  TODO.md                 # Taken tracking
```

---

## Tech Stack

| Component | Keuze | Reden |
|-----------|-------|-------|
| Taal | TypeScript | Type safety, npm ecosystem |
| Runtime | Node.js 20+ | Universeel, CLI tooling standaard |
| CLI framework | commander.js | Meest gebruikte CLI framework |
| Process spawning | execa | Betere child_process wrapper |
| HTTP client | fetch (native) | Geen extra dependency voor API calls |
| File watching | chokidar | Voor toekomstige v2 features |
| Packaging | npm | `npx theroundtaible init` installatie |

---

## Veiligheidsmodel (V1)

**Explicit Consent:** De orchestrator mag discussieren en plannen, maar code-uitvoering vereist `roundtable apply` van de gebruiker.

- Discussie-fase: alleen lezen van project files, schrijven naar `.roundtable/`
- Apply-fase: Lead Knight krijgt write-toegang via zijn eigen sandbox (Claude Code permissions, etc.)
- De tool leunt op de bestaande sandboxing van de onderliggende adapters
- Geen eigen sandbox in v1

**File locking:** De orchestrator houdt in `state.json` bij welke Knight actief is. Voorkomt dat twee agents tegelijk hetzelfde bestand bewerken.

---

## Roadmap

### V1 (MVP)
- [x] Concept & architectuur (deze CLAUDE.md)
- [ ] `roundtable init` — project initialisatie
- [ ] `roundtable discuss` — discussie starten
- [ ] `roundtable status` — status bekijken
- [ ] `roundtable apply` — besluit uitvoeren
- [ ] `roundtable summon` — git-diff gebaseerde sessie
- [ ] `roundtable chronicle` — beslissingenlog bekijken
- [ ] Claude Code CLI adapter
- [ ] Gemini CLI adapter
- [ ] OpenAI API adapter
- [ ] Consensus detectie (score parsing)
- [ ] Chronicle management
- [ ] Git context extractie
- [ ] npm package publiceren

### V2 (Na community feedback)
- [ ] `@roundtable` code comments (file watcher / git hook)
- [ ] VS Code / Antigravity extension
- [ ] Real-time streaming output
- [ ] Meer adapters (DeepSeek, Llama, Mistral)
- [ ] Web dashboard voor sessie-visualisatie
- [ ] Team mode (meerdere gebruikers, zelfde roundtable)
- [ ] CI/CD integratie (GitHub Actions)

### V3 (Toekomst)
- [ ] Auto-execute mode (geen `apply` nodig, met safeguards)
- [ ] Adapter marketplace (community adapters)
- [ ] Multi-project chronicles (gedeeld geheugen over projecten)
- [ ] Performance benchmarks (welke LLM-combinatie werkt het best?)

---

## Conventies

### Code Style
- TypeScript strict mode
- ESLint + Prettier
- Engelse code, Engelse comments (open source project)
- camelCase variabelen, PascalCase types/interfaces

### Git
- Commit messages: Engels, `type(scope): description`
- Branch: `feat/`, `fix/`, `docs/`
- PR's voor alle wijzigingen (na v1 release)

### Documentatie
- README.md voor gebruikers (installatie, quick start)
- CLAUDE.md voor AI-agenten en bijdragers (architectuur, internals)
- JSDoc comments op publieke functies

---

## Beslissingen Log (Chronicle van dit project)

| ID | Beslissing | Reden | Datum |
|----|-----------|-------|-------|
| RT-001 | TypeScript + Node.js | npm ecosystem, CLI tooling standaard | 16 feb 2026 |
| RT-002 | Orchestrator als voorzitter, niet een LLM | Neutraliteit — LLM als voorzitter is bevooroordeeld | 16 feb 2026 |
| RT-003 | Consensus Score 0-10 + PENDING_ISSUES | Makkelijker te parsen dan vrije tekst | 16 feb 2026 |
| RT-004 | Capabilities i.p.v. vaste rollen | Flexibeler, gebruiker kan aanpassen | 16 feb 2026 |
| RT-005 | MIT License onder Polatinos | Maximale openheid | 16 feb 2026 |
| RT-006 | Explicit Consent model (roundtable apply) | Veiligheid v1 — geen automatische code executie | 16 feb 2026 |
| RT-007 | CLI/abonnement eerst, API key als fallback | Tarik's kerneis: geen API keys als standaard | 16 feb 2026 |
| RT-008 | @roundtable comments naar v2 | Scope beperken voor v1 | 16 feb 2026 |
| RT-009 | Context verification voor token-besparing | Check of bestanden bestaan voordat LLMs aanroept | 16 feb 2026 |
| RT-010 | "Waarom" focus in system prompt | Helpt andere agents en gebruiker de logica te begrijpen | 16 feb 2026 |
| RT-011 | Ignore filters in config | Voorkomt tokens verspillen aan node_modules etc. | 16 feb 2026 |
| RT-012 | Naam: TheRoundtAIble | AI zit in de naam. Tarik's keuze. | 16 feb 2026 |

---

*Laatst bijgewerkt: 16 feb 2026 — Initieel concept door Claude & Gemini in consensus*
