/**
 * Role-specific prompt templates for the proposer / critic / synthesizer
 * pipeline introduced in v0.6.
 *
 * Each role:
 *   1. Receives the topic and (optionally) project context.
 *   2. Sees only what it needs — the critic sees the proposal, the
 *      synthesizer sees the proposal AND the critique.
 *   3. Returns plain prose followed by a fenced JSON block with
 *      structured fields. Adapters already return raw text; we parse
 *      the trailing JSON ourselves.
 *
 * The instruction to "end with a JSON block" mirrors the consensus
 * pattern that already works reliably across all three CLI adapters.
 */

const JSON_RULES = `
RESPONSE FORMAT (strict):
1. First, write your prose response. Be concrete and brief.
2. Then, on its own line, write a fenced JSON block with the exact fields specified for your role.
3. Do not write anything after the JSON block.
4. The JSON must be valid — no trailing commas, no comments, double quotes on keys.
`.trim();

export interface RoleContext {
  topic: string;
  /** Knight names that participate, so each role knows who else is at the table. */
  participants: { proposer: string; critic: string; synthesizer: string };
  /** Project context (git, key files, optional source). Same shape as discuss uses. */
  projectContext: string;
}

export function buildProposerPrompt(role: RoleContext, knightName: string): string {
  return [
    `You are ${knightName}, acting as the PROPOSER in a TheRoundtAIble advisory session.`,
    "",
    "Your job: produce a single concrete proposal that answers the topic.",
    "- Take a clear position. Hedging is not useful here.",
    "- Aim for ~250 words of prose. No filler.",
    "- A different knight will attack your proposal next, so your reasoning must hold up under scrutiny.",
    "",
    `The CRITIC will be ${role.participants.critic}.`,
    `The SYNTHESIZER will be ${role.participants.synthesizer}.`,
    "",
    "REQUIRED JSON FIELDS (after your prose):",
    "- recommendation: one sentence stating what to do",
    "- why: 2–4 bullet strings explaining the reasoning",
    "- risks: 1–3 bullet strings naming what could go wrong",
    "",
    JSON_RULES,
    "",
    "---",
    "",
    `Topic: ${role.topic}`,
    role.projectContext ? `\nProject context:\n${role.projectContext}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildCriticPrompt(
  role: RoleContext,
  knightName: string,
  proposalText: string
): string {
  return [
    `You are ${knightName}, acting as the CRITIC in a TheRoundtAIble advisory session.`,
    "",
    `The PROPOSER (${role.participants.proposer}) has just delivered a proposal. Your job is NOT to summarize it, NOT to agree, and NOT to list small nitpicks.`,
    "",
    "Find the SINGLE STRONGEST objection. The one knockout punch that — if true — would change the recommendation.",
    "- One objection, not three. Pick the most serious one.",
    "- Explain it concretely, in ~150 words.",
    "- If the proposal is genuinely sound, say so honestly and explain why the obvious objections do not apply. Polite agreement when warranted is fine — manufactured disagreement is not.",
    "",
    "REQUIRED JSON FIELDS (after your prose):",
    "- strongest_objection: one paragraph string, the objection itself",
    "- severity: one of \"low\" | \"medium\" | \"high\"",
    "- would_change_recommendation: true | false (does this objection, if accepted, flip the recommendation?)",
    "",
    JSON_RULES,
    "",
    "---",
    "",
    `Topic: ${role.topic}`,
    "",
    `PROPOSER's full output (${role.participants.proposer}):`,
    "```",
    proposalText.trim(),
    "```",
    role.projectContext ? `\nProject context:\n${role.projectContext}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildSynthesizerPrompt(
  role: RoleContext,
  knightName: string,
  proposalText: string,
  critiqueText: string
): string {
  return [
    `You are ${knightName}, acting as the SYNTHESIZER in a TheRoundtAIble advisory session.`,
    "",
    `Your job: write the final decision record. You have seen the proposal from ${role.participants.proposer} and the critique from ${role.participants.critic}.`,
    "",
    "Produce the actual decision the user is here for:",
    "- State a clear final recommendation. Take a side.",
    "- Acknowledge the critic's strongest objection in one sentence.",
    "- State whether that objection changes the recommendation, and how.",
    "- Estimate confidence: low / medium / high.",
    "- Flag disagreement health honestly:",
    "  - \"healthy\" — proposal and critique offered substantively different views and you resolved between them",
    "  - \"suspicious-agreement\" — they agreed too easily, possible shared blindspot, recommendation may be wrong unanimously",
    "  - \"unresolved-conflict\" — you could not pick a side cleanly, the user must decide",
    "",
    "Aim for ~200 words of prose followed by the JSON block. No transcript, no quoting at length — write a decision.",
    "",
    "REQUIRED JSON FIELDS (after your prose):",
    "- final_recommendation: one sentence",
    "- addresses_objection: one sentence stating how (or whether) you handle the critic's strongest objection",
    "- confidence: \"low\" | \"medium\" | \"high\"",
    "- disagreement_health: \"healthy\" | \"suspicious-agreement\" | \"unresolved-conflict\"",
    "- open_questions: array of strings (may be empty)",
    "",
    JSON_RULES,
    "",
    "---",
    "",
    `Topic: ${role.topic}`,
    "",
    `PROPOSER's full output (${role.participants.proposer}):`,
    "```",
    proposalText.trim(),
    "```",
    "",
    `CRITIC's full output (${role.participants.critic}):`,
    "```",
    critiqueText.trim(),
    "```",
    role.projectContext ? `\nProject context:\n${role.projectContext}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
