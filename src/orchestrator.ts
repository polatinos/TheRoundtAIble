import chalk from "chalk";
import ora from "ora";
import type {
  RoundtableConfig,
  KnightConfig,
  RoundEntry,
  ConsensusBlock,
  SessionResult,
} from "./types.js";
import { BaseAdapter } from "./adapters/base.js";
import { checkConsensus, summarizeConsensus } from "./consensus.js";
import { buildSystemPrompt } from "./utils/prompt.js";
import { buildContext } from "./utils/context.js";
import {
  createSession,
  writeDiscussion,
  writeDecisions,
  updateStatus,
} from "./utils/session.js";
import { appendToChronicle } from "./utils/chronicle.js";

/**
 * Select the Lead Knight based on capabilities matching the topic.
 * Falls back to highest priority knight.
 */
function selectLeadKnight(
  knights: KnightConfig[],
  blocks: ConsensusBlock[]
): KnightConfig {
  // The knight with the highest consensus_score in the last round is the lead
  const lastRoundBlocks = blocks.filter(
    (b) => b.round === Math.max(...blocks.map((x) => x.round))
  );

  if (lastRoundBlocks.length > 0) {
    const best = lastRoundBlocks.reduce((a, b) =>
      a.consensus_score >= b.consensus_score ? a : b
    );
    const lead = knights.find((k) => k.name === best.knight);
    if (lead) return lead;
  }

  // Fallback: highest priority (lowest number)
  return [...knights].sort((a, b) => a.priority - b.priority)[0];
}

/**
 * Run a full discussion between knights until consensus or max rounds.
 */
export async function runDiscussion(
  topic: string,
  config: RoundtableConfig,
  adapters: Map<string, BaseAdapter>,
  projectRoot: string
): Promise<SessionResult> {
  const { max_rounds, consensus_threshold } = config.rules;

  // Build project context
  const contextSpinner = ora("Building project context...").start();
  const context = await buildContext(projectRoot, config);
  contextSpinner.succeed("Context ready");

  // Create session
  const sessionPath = await createSession(projectRoot, topic);
  console.log(chalk.dim(`Session: ${sessionPath}`));

  // Sort knights by priority
  const sortedKnights = [...config.knights].sort(
    (a, b) => a.priority - b.priority
  );

  const allRounds: RoundEntry[] = [];
  const latestBlocks: Map<string, ConsensusBlock> = new Map();

  for (let round = 1; round <= max_rounds; round++) {
    console.log(chalk.bold.blue(`\n--- Round ${round}/${max_rounds} ---\n`));

    for (const knight of sortedKnights) {
      const adapter = adapters.get(knight.adapter);
      if (!adapter) {
        console.log(chalk.yellow(`  Skipping ${knight.name}: adapter not available`));
        continue;
      }

      // Update status
      await updateStatus(sessionPath, {
        phase: "discussing",
        current_knight: knight.name,
        round,
      });

      // Build prompt
      const systemPrompt = await buildSystemPrompt(
        knight,
        config.knights,
        topic,
        context.chronicle,
        allRounds
      );

      const fullPrompt = [
        systemPrompt,
        "",
        "---",
        "",
        `Onderwerp: ${topic}`,
        "",
        context.gitBranch ? `Git branch: ${context.gitBranch}` : "",
        context.recentCommits
          ? `Recente commits:\n${context.recentCommits}`
          : "",
        context.keyFileContents
          ? `\nProject bestanden:\n${context.keyFileContents}`
          : "",
      ]
        .filter(Boolean)
        .join("\n");

      // Execute
      const spinner = ora(`${knight.name} is thinking...`).start();

      try {
        const timeoutMs = config.rules.timeout_per_turn_seconds * 1000;
        const response = await adapter.execute(fullPrompt, timeoutMs);
        spinner.succeed(`${knight.name} responded`);

        // Parse consensus
        const consensus = adapter.parseConsensus(response, round);

        const entry: RoundEntry = {
          knight: knight.name,
          round,
          response,
          consensus,
          timestamp: new Date().toISOString(),
        };

        allRounds.push(entry);

        if (consensus) {
          latestBlocks.set(knight.name, consensus);
          console.log(
            chalk.dim(
              `  Score: ${consensus.consensus_score}/10` +
                (consensus.pending_issues.length > 0
                  ? ` | Pending: ${consensus.pending_issues.join(", ")}`
                  : "")
            )
          );
        } else {
          console.log(chalk.yellow(`  No consensus block found in response`));
        }
      } catch (error) {
        spinner.fail(`${knight.name} failed`);
        const errMsg = error instanceof Error ? error.message : String(error);
        console.log(chalk.red(`  Error: ${errMsg}`));
      }
    }

    // Write discussion so far
    await writeDiscussion(sessionPath, allRounds);

    // Check consensus after each complete round
    const currentBlocks = Array.from(latestBlocks.values());
    if (checkConsensus(currentBlocks, consensus_threshold)) {
      console.log(chalk.bold.green("\nConsensus reached!"));
      console.log(summarizeConsensus(currentBlocks));

      // Find the proposal from the last round
      const lastProposal =
        allRounds
          .slice()
          .reverse()
          .find((r) => r.consensus?.proposal)?.consensus?.proposal ||
        allRounds[allRounds.length - 1]?.response ||
        "No proposal text available.";

      // Write decisions
      await writeDecisions(sessionPath, topic, lastProposal, allRounds);
      await updateStatus(sessionPath, {
        phase: "consensus_reached",
        consensus_reached: true,
        round,
      });

      // Update chronicle
      const leadKnight = selectLeadKnight(config.knights, currentBlocks);
      await appendToChronicle(projectRoot, config.chronicle, {
        topic,
        outcome: `Consensus bereikt in ${round} ronde(s). Lead Knight: ${leadKnight.name}.\n\n${lastProposal}`,
        knights: currentBlocks.map((b) => b.knight),
        date: new Date().toISOString().slice(0, 10),
      });

      return {
        sessionPath,
        consensus: true,
        rounds: round,
        decision: lastProposal,
        blocks: currentBlocks,
      };
    }

    // Escalation warning
    if (round >= config.rules.escalate_to_user_after && round < max_rounds) {
      console.log(
        chalk.yellow(
          `\nRound ${round}: No consensus yet. ${max_rounds - round} round(s) remaining.`
        )
      );
    }
  }

  // Max rounds reached without consensus
  console.log(chalk.bold.yellow("\nMax rounds reached — no consensus."));
  console.log(summarizeConsensus(Array.from(latestBlocks.values())));

  await updateStatus(sessionPath, {
    phase: "escalated",
    consensus_reached: false,
    round: max_rounds,
  });

  return {
    sessionPath,
    consensus: false,
    rounds: max_rounds,
    decision: null,
    blocks: Array.from(latestBlocks.values()),
  };
}
