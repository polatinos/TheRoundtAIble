import chalk from "chalk";
import ora from "ora";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import type { RoundtableConfig, KnightConfig } from "../types.js";
import { BaseAdapter } from "../adapters/base.js";
import { executeWithFallback } from "../orchestrator.js";
import { buildContext } from "../utils/context.js";
import {
  buildProposerPrompt,
  buildCriticPrompt,
  buildSynthesizerPrompt,
  RoleContext,
} from "./prompts.js";
import {
  parseProposal,
  parseCritique,
  parseSynthesis,
  stripJsonBlock,
} from "./parse.js";
import { renderDecisionMarkdown, DecisionRecord } from "./decision-record.js";
import { ConfigError } from "../utils/errors.js";

export interface AdviseOptions {
  proposerName?: string;
  criticName?: string;
  synthesizerName?: string;
  readSourceCode?: boolean;
}

export interface AdviseResult {
  sessionPath: string;
  decisionPath: string;
  record: DecisionRecord;
}

interface RoleAssignment {
  proposer: KnightConfig;
  critic: KnightConfig;
  synthesizer: KnightConfig;
}

/**
 * Assign the three roles based on options or priority order.
 *
 * Default rule (deliberately simple — capability matching is v0.7 work):
 *   proposer  = priority 1 (most-trusted first take)
 *   critic    = priority 2 (independent perspective)
 *   synth     = priority 3 (neutral final voice — no ego in the proposal)
 *
 * If only 2 knights are configured: synth = proposer (the proposer
 * writes the synthesis after seeing the critique). Acceptable degraded
 * mode — flagged in the result.
 *
 * If only 1 knight: error. The whole point is multiple voices.
 */
export function assignRoles(
  knights: KnightConfig[],
  options: AdviseOptions = {}
): RoleAssignment {
  if (knights.length === 0) {
    throw new ConfigError("No knights configured.");
  }

  const byName = new Map(knights.map((k) => [k.name.toLowerCase(), k]));
  const sorted = [...knights].sort((a, b) => a.priority - b.priority);

  function pickByName(name: string | undefined, fallback: KnightConfig): KnightConfig {
    if (!name) return fallback;
    const found = byName.get(name.toLowerCase());
    if (!found) {
      throw new ConfigError(
        `No knight named "${name}" in config.`,
        { hint: `Available: ${knights.map((k) => k.name).join(", ")}` }
      );
    }
    return found;
  }

  if (sorted.length === 1) {
    throw new ConfigError(
      "advise needs at least 2 knights — the whole point is multiple voices.",
      { hint: "Configure a second knight in .roundtable/config.json or use 'discuss' for single-knight queries." }
    );
  }

  if (sorted.length === 2) {
    const proposer = pickByName(options.proposerName, sorted[0]);
    const critic = pickByName(options.criticName, sorted[1]);
    const synthesizer = pickByName(options.synthesizerName, proposer);
    return { proposer, critic, synthesizer };
  }

  const proposer = pickByName(options.proposerName, sorted[0]);
  const critic = pickByName(options.criticName, sorted[1]);
  const synthesizer = pickByName(options.synthesizerName, sorted[2]);
  return { proposer, critic, synthesizer };
}

/** Produce a slug for the session folder name. */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

async function createAdviseSession(projectRoot: string, topic: string): Promise<string> {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const time = now.toISOString().slice(11, 16).replace(":", "");
  const sessionName = `${date}-${time}-advise-${slugify(topic)}`;
  const sessionPath = join(projectRoot, ".roundtable", "sessions", sessionName);
  await mkdir(sessionPath, { recursive: true });
  await writeFile(join(sessionPath, "topic.md"), `# Topic\n\n${topic}\n`, "utf-8");
  return sessionPath;
}

const KNIGHT_COLORS: Record<string, (text: string) => string> = {
  Claude: chalk.hex("#D97706"),
  Gemini: chalk.hex("#3B82F6"),
  GPT: chalk.hex("#10B981"),
};

function colorFor(name: string): (text: string) => string {
  return KNIGHT_COLORS[name] || chalk.white;
}

function printRoleHeader(role: string, knight: string): void {
  const c = colorFor(knight);
  const divider = c("─".repeat(50));
  console.log(divider);
  console.log(`  ${chalk.bold(role.toUpperCase())} — ${c(knight)}`);
  console.log(divider);
}

function printRoleProse(text: string): void {
  const indented = stripJsonBlock(text)
    .split("\n")
    .map((l) => `  ${l}`)
    .join("\n");
  console.log(chalk.white(indented));
  console.log("");
}

/**
 * Run the proposer → critic → synthesizer pipeline. Three sequential
 * LLM calls. No rounds, no scores.
 */
export async function runAdvise(
  topic: string,
  config: RoundtableConfig,
  adapters: Map<string, BaseAdapter>,
  projectRoot: string,
  options: AdviseOptions = {}
): Promise<AdviseResult> {
  const roles = assignRoles(config.knights, options);

  // Verify all three role-knights have a working adapter
  for (const role of [roles.proposer, roles.critic, roles.synthesizer]) {
    if (!adapters.has(role.adapter)) {
      throw new ConfigError(
        `Knight "${role.name}" has no working adapter ("${role.adapter}").`,
        { hint: "Run 'roundtable init' or check that the CLI tool is installed." }
      );
    }
  }

  const sessionPath = await createAdviseSession(projectRoot, topic);
  console.log(chalk.dim(`  Session: ${sessionPath}`));
  console.log(chalk.dim(
    `  Proposer: ${colorFor(roles.proposer.name)(roles.proposer.name)}` +
    `  →  Critic: ${colorFor(roles.critic.name)(roles.critic.name)}` +
    `  →  Synthesizer: ${colorFor(roles.synthesizer.name)(roles.synthesizer.name)}\n`
  ));

  // Build project context once — shared across all three roles
  const ctxSpinner = ora("  Gathering project context...").start();
  const ctx = await buildContext(projectRoot, config, options.readSourceCode || false);
  ctxSpinner.succeed("  Context assembled");

  const projectContext = [
    ctx.gitBranch ? `Git branch: ${ctx.gitBranch}` : "",
    ctx.gitDiff ? `Git diff:\n\`\`\`\n${ctx.gitDiff.slice(0, 3000)}\n\`\`\`` : "",
    ctx.recentCommits ? `Recent commits:\n${ctx.recentCommits}` : "",
    ctx.keyFileContents ? `Key files:\n${ctx.keyFileContents}` : "",
    ctx.sourceFileContents
      ? `\nSOURCE CODE (read-only reference, do not call tools, only analyze as text):\n${ctx.sourceFileContents}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const roleCtx: RoleContext = {
    topic,
    participants: {
      proposer: roles.proposer.name,
      critic: roles.critic.name,
      synthesizer: roles.synthesizer.name,
    },
    projectContext,
  };

  const timeoutMs = config.rules.timeout_per_turn_seconds * 1000;

  // ── Proposer ────────────────────────────────────────────────────────
  const proposerPrompt = buildProposerPrompt(roleCtx, roles.proposer.name);
  const propSpinner = ora(colorFor(roles.proposer.name)(`  ${roles.proposer.name} drafts a proposal...`)).start();
  const proposerRaw = await executeWithFallback(
    adapters.get(roles.proposer.adapter)!,
    roles.proposer,
    config,
    proposerPrompt,
    timeoutMs,
    adapters
  );
  propSpinner.stop();
  printRoleHeader("Proposer", roles.proposer.name);
  printRoleProse(proposerRaw);

  const proposalParsed = parseProposal(proposerRaw);
  if (!proposalParsed) {
    throw new ConfigError(
      `Proposer (${roles.proposer.name}) returned no parseable JSON block.`,
      { hint: "Check the raw response in the session folder. The model may have ignored the format instructions." }
    );
  }

  // ── Critic ──────────────────────────────────────────────────────────
  const criticPrompt = buildCriticPrompt(roleCtx, roles.critic.name, proposerRaw);
  const critSpinner = ora(colorFor(roles.critic.name)(`  ${roles.critic.name} hunts for the strongest objection...`)).start();
  const criticRaw = await executeWithFallback(
    adapters.get(roles.critic.adapter)!,
    roles.critic,
    config,
    criticPrompt,
    timeoutMs,
    adapters
  );
  critSpinner.stop();
  printRoleHeader("Critic", roles.critic.name);
  printRoleProse(criticRaw);

  const critiqueParsed = parseCritique(criticRaw);
  if (!critiqueParsed) {
    throw new ConfigError(
      `Critic (${roles.critic.name}) returned no parseable JSON block.`,
      { hint: "Check the raw response in the session folder." }
    );
  }

  // ── Synthesizer ─────────────────────────────────────────────────────
  const synthPrompt = buildSynthesizerPrompt(
    roleCtx,
    roles.synthesizer.name,
    proposerRaw,
    criticRaw
  );
  const synthSpinner = ora(
    colorFor(roles.synthesizer.name)(`  ${roles.synthesizer.name} writes the decision...`)
  ).start();
  const synthRaw = await executeWithFallback(
    adapters.get(roles.synthesizer.adapter)!,
    roles.synthesizer,
    config,
    synthPrompt,
    timeoutMs,
    adapters
  );
  synthSpinner.stop();
  printRoleHeader("Synthesizer", roles.synthesizer.name);
  printRoleProse(synthRaw);

  const synthParsed = parseSynthesis(synthRaw);
  if (!synthParsed) {
    throw new ConfigError(
      `Synthesizer (${roles.synthesizer.name}) returned no parseable JSON block.`,
      { hint: "Check the raw response in the session folder." }
    );
  }

  const record: DecisionRecord = {
    topic,
    date: new Date().toISOString().slice(0, 10),
    proposer: { knight: roles.proposer.name, raw: proposerRaw, parsed: proposalParsed },
    critic: { knight: roles.critic.name, raw: criticRaw, parsed: critiqueParsed },
    synth: { knight: roles.synthesizer.name, raw: synthRaw, parsed: synthParsed },
  };

  const decisionPath = join(sessionPath, "decision.md");
  await writeFile(decisionPath, renderDecisionMarkdown(record), "utf-8");

  return { sessionPath, decisionPath, record };
}
