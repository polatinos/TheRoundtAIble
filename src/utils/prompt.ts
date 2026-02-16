import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { KnightConfig, RoundEntry } from "../types.js";

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
