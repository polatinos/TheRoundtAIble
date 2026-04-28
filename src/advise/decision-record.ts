import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ProposalShape,
  CritiqueShape,
  SynthesisShape,
} from "./parse.js";

export interface DecisionRecord {
  topic: string;
  date: string;
  proposer: { knight: string; raw: string; parsed: ProposalShape };
  critic: { knight: string; raw: string; parsed: CritiqueShape };
  synth: { knight: string; raw: string; parsed: SynthesisShape };
}

function bullets(items: string[]): string {
  if (!items.length) return "_(none)_";
  return items.map((i) => `- ${i}`).join("\n");
}

/**
 * Render a DecisionRecord to markdown.
 * Format defined in docs/plans/v0.6-redesign.md — keep them in sync.
 */
export function renderDecisionMarkdown(record: DecisionRecord): string {
  const { proposer, critic, synth, topic, date } = record;

  const healthLine =
    synth.parsed.disagreement_health === "suspicious-agreement"
      ? "_Disagreement health flagged as **suspicious-agreement** — the proposer and critic converged easily. Treat with caution: shared blindspots are possible._"
      : synth.parsed.disagreement_health === "unresolved-conflict"
        ? "_Disagreement health flagged as **unresolved-conflict** — synthesizer could not pick a side. The decision is yours._"
        : "_Disagreement health: healthy._";

  return [
    `# Decision: ${topic}`,
    "",
    `**Date:** ${date}`,
    `**Proposer:** ${proposer.knight}`,
    `**Critic:** ${critic.knight}`,
    `**Synthesizer:** ${synth.knight}`,
    `**Confidence:** ${synth.parsed.confidence}`,
    "",
    healthLine,
    "",
    "## Recommendation",
    "",
    synth.parsed.final_recommendation,
    "",
    "## Reasoning",
    "",
    bullets(proposer.parsed.why),
    "",
    "## Risks named by proposer",
    "",
    bullets(proposer.parsed.risks),
    "",
    "## Strongest counter-argument",
    "",
    `> ${critic.parsed.strongest_objection.replace(/\n/g, "\n> ")}`,
    "",
    `**Severity:** ${critic.parsed.severity}  `,
    `**Would change the recommendation if accepted:** ${critic.parsed.would_change_recommendation ? "yes" : "no"}`,
    "",
    "## How the synthesizer handles this objection",
    "",
    synth.parsed.addresses_objection || "_(synthesizer did not state how the objection was handled)_",
    "",
    "## Open questions",
    "",
    bullets(synth.parsed.open_questions),
    "",
    "---",
    "",
    "<details><summary>Appendix — full role outputs</summary>",
    "",
    `### Proposer — ${proposer.knight}`,
    "",
    "```",
    proposer.raw.trim(),
    "```",
    "",
    `### Critic — ${critic.knight}`,
    "",
    "```",
    critic.raw.trim(),
    "```",
    "",
    `### Synthesizer — ${synth.knight}`,
    "",
    "```",
    synth.raw.trim(),
    "```",
    "",
    "</details>",
    "",
  ].join("\n");
}

/**
 * Write the decision record to disk under the session folder.
 */
export async function writeDecisionRecord(
  sessionPath: string,
  record: DecisionRecord
): Promise<string> {
  await mkdir(sessionPath, { recursive: true });
  const filePath = join(sessionPath, "decision.md");
  await writeFile(filePath, renderDecisionMarkdown(record), "utf-8");
  return filePath;
}
