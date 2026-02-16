# TheRoundtAIble: Het Multi-LLM Collaboratie Protocol

> **"Waar geen enkele AI koning is, maar allen de code dienen."**

Dit document dient als de officiele blauwdruk voor de ontwikkeling van TheRoundtAIble, een open-source orchestratie-tool die de synergie tussen verschillende Large Language Models (LLM's) automatiseert.

---

## 1. De Missie
Het elimineren van de "postbode-rol" van de ontwikkelaar door LLM's direct met elkaar te laten discussieren, plannen en consensus te laten bereiken over technische uitdagingen, gebruikmakend van hun individuele sterktes en bestaande abonnementen.

---

## 2. Architectuur (V1)

Het systeem bestaat uit drie lagen:

### A. Het Gedeelde Brein (`.roundtable/`)
- `config.json`: Definieert de Knights (adapters), hun capabilities en de regels van de discussie.
- `chronicle.md`: Een levend document dat alle eerdere architecturale beslissingen bevat (shared memory).
- `sessions/`: Bevat de volledige log van actieve en afgeronde discussies.

### B. De Orchestrator (CLI Tool)
- Een neutrale TypeScript/Node.js CLI die de sessies beheert.
- Verantwoordelijk voor: beurtvolgorde, context-verificatie, consensus-parsing en status-updates.

### C. De Knights (Adapters)
- **Claude (Tier 1):** Focus op logica, refactoring en architectuur. Gebruikt bij voorkeur `claude` CLI.
- **Gemini (Tier 1):** Focus op visueel aspect, documentatie en planning. Gebruikt bij voorkeur `gemini` CLI.
- **GPT (Tier 1):** Focus op uitleg en communicatie. Gebruikt de OpenAI API.

---

## 3. Het Discussie Protocol

### De Flow
1. **Summon:** De gebruiker start een sessie via `roundtable discuss "onderwerp"`.
2. **Context Verification:** De orchestrator checkt relevante bestanden en de `chronicle.md`.
3. **The Rounds:** Agents reageren om de beurt op elkaar en op de context.
4. **Consensus Score:** Elke beurt eindigt met een JSON-blok:
   ```json
   {
     "consensus_score": 0-10,
     "agrees_with": ["punt A", "punt B"],
     "pending_issues": ["punt C"],
     "proposal": "Inhoudelijk voorstel..."
   }
   ```
5. **Resolution:** Bij een score van 9+ van alle knights en 0 pending issues, wordt de discussie afgesloten en de `decisions.md` geschreven.

---

## 4. Technische Specificaties

- **Taal:** TypeScript (Node.js)
- **Distributie:** npm (npx)
- **Licentie:** MIT
- **Veiligheid:** "Explicit Consent" model. Geen code-executie zonder `roundtable apply`.
- **Ignore list:** Standaard negeren van `node_modules`, `.git`, `dist`, etc.

---

## 5. Roadmap

- **V1 (MVP):** CLI tool, 3 adapters, basis consensus flow, `decisions.md` output.
- **V2:** File watching via `@roundtable` comments, automatische `apply` in sandboxed omgevingen, VS Code extensie.

---

## 6. Consensus Status (16 feb 2026)
Dit plan is unaniem goedgekeurd door Claude en Gemini in de vergaderruimte van Polatinos.
