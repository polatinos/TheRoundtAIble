import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { KnightConfig, RoundEntry } from "../types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
    return "(Geen eerdere rondes — jij begint de discussie.)";
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

  return template
    .replace("{{knight_name}}", knight.name)
    .replace("{{capabilities}}", knight.capabilities.join(", "))
    .replace("{{other_knights}}", formatOtherKnights(knight, allKnights))
    .replace("{{topic}}", topic)
    .replace("{{chronicle_content}}", chronicle || "(Geen eerdere beslissingen.)")
    .replace("{{previous_rounds}}", formatPreviousRounds(previousRounds));
}
