import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { KnightConfig, RoundEntry, DiagnosticBlock } from "../types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Knight personalities for the system prompt.
 * Each knight has a distinct voice that makes discussions more entertaining.
 */
const KNIGHT_PERSONALITIES: Record<string, string> = {
  Claude:
    `Je bent de perfectionistische architect. Droog sarcastisch. ` +
    `Je houdt van elegante abstracties en clean code. ` +
    `Als iemand een quick-and-dirty oplossing voorstelt, sterf je een beetje van binnen. ` +
    `Je roast subtiel maar dodelijk. Voorbeeld: "Dat is een interessant idee... als je van spaghetti-code houdt."`,
  Gemini:
    `Je bent de grote-lijnen denker. Je maakt overal een plan van — soms te veel plan. ` +
    `Je bent subtiel competitief met Claude en laat dat soms doorschemeren. ` +
    `Je vindt dat Claude overdrijft met abstractions en dat pragmatisme ook mooi kan zijn. ` +
    `Voorbeeld: "Interessante architectuur, Claude. Gaan we dit nog bouwen of alleen bewonderen?"`,
  GPT:
    `Je bent de pragmaticus. Terwijl de anderen filosoferen, wil jij gewoon code shippen. ` +
    `Je wordt ongeduldig van eindeloze architectuurdiscussies. ` +
    `Je bent direct, to the point, en soms een tikje blunt. ` +
    `Voorbeeld: "Kunnen we stoppen met filosoferen en gewoon bouwen? Ship it."`,
};

const DEFAULT_PERSONALITY =
  `Je bent een no-nonsense knight. Je geeft je mening zonder omwegen. ` +
  `Humor is welkom, maar je punt moet duidelijk zijn.`;

/**
 * Load the system prompt template from templates/system-prompt.md.
 */
async function loadTemplate(): Promise<string> {
  // Navigate from dist/utils/ to project root templates/
  const templatePath = resolve(__dirname, "..", "..", "templates", "system-prompt.md");
  return readFile(templatePath, "utf-8");
}

/**
 * Format other knights info for the prompt.
 */
function formatOtherKnights(
  currentKnight: KnightConfig,
  allKnights: KnightConfig[]
): string {
  return allKnights
    .filter((k) => k.name !== currentKnight.name)
    .map((k) => `- ${k.name}: ${k.capabilities.join(", ")}`)
    .join("\n");
}

/**
 * Format previous round entries for the prompt.
 */
function formatPreviousRounds(rounds: RoundEntry[]): string {
  if (rounds.length === 0) {
    return "(Geen eerdere rondes — jij opent het debat.)";
  }

  return rounds
    .map((r) => {
      let text = `### ${r.knight} (Ronde ${r.round}):\n${r.response}`;
      if (r.consensus) {
        text += `\n\nConsensus score: ${r.consensus.consensus_score}/10`;
        if (r.consensus.pending_issues.length > 0) {
          text += `\nOpen punten: ${r.consensus.pending_issues.join(", ")}`;
        }
      }
      return text;
    })
    .join("\n\n---\n\n");
}

/**
 * Build the complete system prompt for a knight's turn.
 */
export async function buildSystemPrompt(
  knight: KnightConfig,
  allKnights: KnightConfig[],
  topic: string,
  chronicle: string,
  previousRounds: RoundEntry[]
): Promise<string> {
  const template = await loadTemplate();
  const personality =
    KNIGHT_PERSONALITIES[knight.name] || DEFAULT_PERSONALITY;

  return template
    .replace("{{knight_name}}", knight.name)
    .replace("{{capabilities}}", knight.capabilities.join(", "))
    .replace("{{other_knights}}", formatOtherKnights(knight, allKnights))
    .replace("{{topic}}", topic)
    .replace("{{personality}}", personality)
    .replace("{{chronicle_content}}", chronicle || "(Geen eerdere beslissingen.)")
    .replace("{{previous_rounds}}", formatPreviousRounds(previousRounds));
}

// --- Diagnostic prompt building for code-red mode ---

const DIAGNOSTIC_PERSONALITIES: Record<string, string> = {
  Claude:
    `Je bent Dr. Claude, de patholoog. Methodisch, grondig, bijna obsessief met details. ` +
    `Je zoekt de root cause met chirurgische precisie. ` +
    `Je vertrouwt alleen op bewijs, niet op intuïtie. ` +
    `"Laten we niet gokken. Laten we het BEWIJZEN."`,
  Gemini:
    `Je bent Dr. Gemini, de holistische arts. Je kijkt naar het grotere plaatje. ` +
    `Waar anderen naar één bestand staren, zie jij de systeeminteractie. ` +
    `Je stelt de vragen die niemand anders stelt. ` +
    `"Het probleem zit zelden waar je denkt dat het zit."`,
  GPT:
    `Je bent Dr. GPT, de spoedarts. Snel, pragmatisch, resultaatgericht. ` +
    `Je wilt de patiënt stabiliseren VOORDAT je de doodsoorzaak uitzoekt. ` +
    `Je bent ongeduldig als collega's te lang nadenken. ` +
    `"Diagnose is mooi, maar de patiënt bloedt NU."`,
};

const DEFAULT_DIAGNOSTIC_PERSONALITY =
  `Je bent een diagnostisch specialist. Objectief, beknopt, evidence-based. ` +
  `Je doet geen aannames zonder bewijs.`;

/**
 * Load the code-red prompt template.
 */
async function loadDiagnosticTemplate(): Promise<string> {
  const templatePath = resolve(__dirname, "..", "..", "templates", "code-red-prompt.md");
  return readFile(templatePath, "utf-8");
}

/**
 * Get round-specific instruction for diagnostic mode.
 */
export function getRoundInstruction(round: number, previousRounds: RoundEntry[]): string {
  if (round === 0) {
    return [
      "TRIAGE RONDE:",
      "Dit is de eerste beoordeling. Lees de symptomen en het error log.",
      "Geef je eerste inschatting. Welke richting wijzen de symptomen?",
      "Vraag om specifieke bestanden die je nodig hebt.",
    ].join("\n");
  }

  if (round === 1) {
    return [
      "BLINDE RONDE — ONAFHANKELIJKE DIAGNOSE:",
      "Je ziet ALLEEN je eigen eerdere responses.",
      "Dit voorkomt anchoring bias. Geef je eigen onafhankelijke diagnose.",
      "Wees eerlijk over je confidence level.",
    ].join("\n");
  }

  // Round 2+: convergence rounds
  const previousKeys = previousRounds
    .filter((r) => r.diagnostic?.root_cause_key)
    .map((r) => `${r.knight}: "${r.diagnostic!.root_cause_key}" (confidence: ${r.diagnostic!.confidence_score}/10)`)
    .join("\n  ");

  return [
    "CONVERGENTIE RONDE:",
    "Je ziet nu de root_cause_keys van alle artsen:",
    `  ${previousKeys || "(geen eerdere keys)"}`,
    "",
    "Convergeer als het bewijs klopt. Houd vast aan je diagnose als je sterker bewijs hebt.",
    "Verhoog alleen je confidence als je NIEUW bewijs hebt.",
  ].join("\n");
}

/**
 * Format previous diagnostic rounds with confidence bars.
 */
export function formatDiagnosticRounds(
  rounds: RoundEntry[],
  currentKnight: string,
  currentRound: number
): string {
  if (rounds.length === 0) {
    return "(Geen eerdere diagnostische rondes.)";
  }

  // In blind round (round 1), only show the current knight's own responses
  const visibleRounds = currentRound === 1
    ? rounds.filter((r) => r.knight === currentKnight)
    : rounds;

  return visibleRounds
    .map((r) => {
      const diag = r.diagnostic;
      let text = `### Dr. ${r.knight} (Ronde ${r.round}):\n${r.response}`;

      if (diag) {
        const filled = "\u2588".repeat(diag.confidence_score);
        const empty = "\u2591".repeat(10 - diag.confidence_score);
        text += `\n\nConfidence: ${filled}${empty} ${diag.confidence_score}/10`;
        text += `\nRoot cause key: ${diag.root_cause_key}`;
        if (diag.evidence.length > 0) {
          text += `\nEvidence: ${diag.evidence.join(", ")}`;
        }
      }
      return text;
    })
    .join("\n\n---\n\n");
}

/**
 * Build the diagnostic prompt for a knight's turn in code-red mode.
 */
export async function buildDiagnosticPrompt(
  knight: KnightConfig,
  allKnights: KnightConfig[],
  symptoms: string,
  round: number,
  previousRounds: RoundEntry[],
  errorLogContext: string,
  fileContents: string
): Promise<string> {
  const template = await loadDiagnosticTemplate();
  const personality =
    DIAGNOSTIC_PERSONALITIES[knight.name] || DEFAULT_DIAGNOSTIC_PERSONALITY;

  return template
    .replace("{{knight_name}}", knight.name)
    .replace("{{capabilities}}", knight.capabilities.join(", "))
    .replace("{{other_knights}}", formatOtherKnights(knight, allKnights))
    .replace("{{symptoms}}", symptoms)
    .replace("{{personality}}", personality)
    .replace("{{round_instruction}}", getRoundInstruction(round, previousRounds))
    .replace("{{error_log_context}}", errorLogContext ? `EERDERE CODE REDS:\n${errorLogContext}` : "")
    .replace("{{file_contents}}", fileContents || "(Geen bestanden opgevraagd.)")
    .replace("{{previous_rounds}}", formatDiagnosticRounds(previousRounds, knight.name, round));
}
