import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import type { RoundtableConfig, AdapterCliConfig, AdapterApiConfig } from "../types.js";
import { BaseAdapter } from "../adapters/base.js";
import { ClaudeCliAdapter } from "../adapters/claude-cli.js";
import { GeminiCliAdapter } from "../adapters/gemini-cli.js";
import { OpenAIApiAdapter } from "../adapters/openai-api.js";
import { runDiscussion } from "../orchestrator.js";

/**
 * Create an adapter instance for a given adapter ID.
 */
function createAdapter(
  adapterId: string,
  config: RoundtableConfig,
  timeoutMs: number
): BaseAdapter | null {
  switch (adapterId) {
    case "claude-cli": {
      const cfg = config.adapter_config["claude-cli"] as AdapterCliConfig | undefined;
      return new ClaudeCliAdapter(cfg?.command || "claude", timeoutMs);
    }
    case "gemini-cli": {
      const cfg = config.adapter_config["gemini-cli"] as AdapterCliConfig | undefined;
      return new GeminiCliAdapter(cfg?.command || "gemini", timeoutMs);
    }
    case "openai-api": {
      const cfg = config.adapter_config["openai-api"] as AdapterApiConfig | undefined;
      return new OpenAIApiAdapter(cfg?.model || "gpt-4o", cfg?.env_key || "OPENAI_API_KEY", timeoutMs);
    }
    default:
      return null;
  }
}

/**
 * Create adapter instances based on config.
 * Tries the primary adapter first; falls back if configured and primary unavailable.
 */
async function initializeAdapters(
  config: RoundtableConfig
): Promise<Map<string, BaseAdapter>> {
  const adapters = new Map<string, BaseAdapter>();
  const timeoutMs = config.rules.timeout_per_turn_seconds * 1000;

  for (const knight of config.knights) {
    // Try primary adapter
    const primary = createAdapter(knight.adapter, config, timeoutMs);
    if (!primary) {
      console.log(chalk.yellow(`  ? ${knight.name}: unknown adapter "${knight.adapter}"`));
      continue;
    }

    const primaryAvailable = await primary.isAvailable();
    if (primaryAvailable) {
      adapters.set(knight.adapter, primary);
      console.log(chalk.green(`  ✓ ${knight.name} ready (${knight.adapter})`));
      continue;
    }

    // Try fallback if configured
    if (knight.fallback) {
      console.log(chalk.dim(`  ${knight.name}: ${knight.adapter} unavailable, trying fallback...`));
      const fallback = createAdapter(knight.fallback, config, timeoutMs);
      if (fallback) {
        const fallbackAvailable = await fallback.isAvailable();
        if (fallbackAvailable) {
          adapters.set(knight.adapter, fallback); // Register under primary key so orchestrator finds it
          console.log(chalk.green(`  ✓ ${knight.name} ready (fallback: ${knight.fallback})`));
          continue;
        }
      }
    }

    console.log(chalk.yellow(`  ✗ ${knight.name} not available`));
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
