import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import type { RoundtableConfig, AdapterCliConfig } from "../types.js";
import { BaseAdapter } from "../adapters/base.js";
import { ClaudeCliAdapter } from "../adapters/claude-cli.js";
import { runDiscussion } from "../orchestrator.js";

/**
 * Create adapter instances based on config.
 * Only returns adapters that are available.
 */
async function initializeAdapters(
  config: RoundtableConfig
): Promise<Map<string, BaseAdapter>> {
  const adapters = new Map<string, BaseAdapter>();
  const timeoutMs = config.rules.timeout_per_turn_seconds * 1000;

  for (const knight of config.knights) {
    let adapter: BaseAdapter | null = null;

    switch (knight.adapter) {
      case "claude-cli": {
        const adapterConfig = config.adapter_config["claude-cli"] as AdapterCliConfig | undefined;
        const command = adapterConfig?.command || "claude";
        adapter = new ClaudeCliAdapter(command, timeoutMs);
        break;
      }
      // Gemini and OpenAI adapters will be added in future phases
      case "gemini-cli":
      case "openai-api":
        console.log(
          chalk.dim(`  ${knight.name}: adapter "${knight.adapter}" not yet implemented`)
        );
        continue;
      default:
        console.log(
          chalk.yellow(`  Unknown adapter: ${knight.adapter}`)
        );
        continue;
    }

    if (adapter) {
      const available = await adapter.isAvailable();
      if (available) {
        adapters.set(knight.adapter, adapter);
        console.log(chalk.green(`  ✓ ${knight.name} ready`));
      } else {
        console.log(chalk.yellow(`  ✗ ${knight.name} not available`));
      }
    }
  }

  return adapters;
}

/**
 * The `roundtable discuss` command.
 */
export async function discussCommand(topic: string): Promise<void> {
  const projectRoot = process.cwd();
  const configPath = join(projectRoot, ".roundtable", "config.json");

  // Check if initialized
  if (!existsSync(configPath)) {
    console.log(
      chalk.red('No .roundtable/config.json found. Run "roundtable init" first.')
    );
    process.exit(1);
  }

  // Load config
  const configRaw = await readFile(configPath, "utf-8");
  let config: RoundtableConfig;
  try {
    config = JSON.parse(configRaw);
  } catch {
    console.log(chalk.red("Invalid config.json — could not parse."));
    process.exit(1);
  }

  console.log(chalk.bold(`\nTopic: "${topic}"\n`));
  console.log(chalk.dim("Initializing knights...\n"));

  // Initialize adapters
  const adapters = await initializeAdapters(config);

  if (adapters.size === 0) {
    console.log(
      chalk.red(
        "\nNo adapters available. Make sure at least one AI CLI tool is installed."
      )
    );
    console.log(
      chalk.dim(
        "  Supported: claude (Claude Code), gemini (Gemini CLI)"
      )
    );
    process.exit(1);
  }

  console.log(chalk.dim(`\n${adapters.size} knight(s) ready. Starting discussion...\n`));

  // Run the discussion
  const result = await runDiscussion(topic, config, adapters, projectRoot);

  // Final output
  console.log(chalk.bold("\n═══════════════════════════════════════"));

  if (result.consensus) {
    console.log(chalk.bold.green("  CONSENSUS REACHED"));
    console.log(chalk.dim(`  Rounds: ${result.rounds}`));
    console.log(chalk.dim(`  Session: ${result.sessionPath}`));
    console.log(
      chalk.dim('  Run "roundtable apply" to execute the decision.')
    );
  } else {
    console.log(chalk.bold.yellow("  NO CONSENSUS — ESCALATED TO USER"));
    console.log(chalk.dim(`  Rounds: ${result.rounds}`));
    console.log(chalk.dim(`  Session: ${result.sessionPath}`));
    console.log(
      chalk.dim("  Review the discussion in the session folder.")
    );
  }

  console.log(chalk.bold("═══════════════════════════════════════\n"));
}
