import chalk from "chalk";
import type { RoundtableConfig, AdapterCliConfig, AdapterApiConfig, AdapterLocalConfig } from "../types.js";
import { BaseAdapter } from "../adapters/base.js";
import { ClaudeCliAdapter } from "../adapters/claude-cli.js";
import { ClaudeApiAdapter } from "../adapters/claude-api.js";
import { GeminiCliAdapter } from "../adapters/gemini-cli.js";
import { GeminiApiAdapter } from "../adapters/gemini-api.js";
import { OpenAICliAdapter } from "../adapters/openai-cli.js";
import { OpenAIApiAdapter } from "../adapters/openai-api.js";
import { LocalLlmAdapter } from "../adapters/local-llm.js";

/**
 * Create an adapter instance for a given adapter ID.
 */
export function createAdapter(
  adapterId: string,
  config: RoundtableConfig,
  timeoutMs: number
): BaseAdapter | null {
  switch (adapterId) {
    case "claude-cli": {
      const cfg = config.adapter_config["claude-cli"] as AdapterCliConfig | undefined;
      return new ClaudeCliAdapter(cfg?.command || "claude", timeoutMs);
    }
    case "claude-api": {
      const cfg = config.adapter_config["claude-api"] as AdapterApiConfig | undefined;
      return new ClaudeApiAdapter(cfg?.model || "claude-sonnet-4-6", cfg?.env_key || "ANTHROPIC_API_KEY", timeoutMs);
    }
    case "gemini-cli": {
      const cfg = config.adapter_config["gemini-cli"] as AdapterCliConfig | undefined;
      return new GeminiCliAdapter(cfg?.command || "gemini", timeoutMs);
    }
    case "gemini-api": {
      const cfg = config.adapter_config["gemini-api"] as AdapterApiConfig | undefined;
      return new GeminiApiAdapter(cfg?.model || "gemini-2.5-flash", cfg?.env_key || "GEMINI_API_KEY", timeoutMs);
    }
    case "openai-cli": {
      const cfg = config.adapter_config["openai-cli"] as AdapterCliConfig | undefined;
      return new OpenAICliAdapter(cfg?.command || "codex", timeoutMs);
    }
    case "openai-api": {
      const cfg = config.adapter_config["openai-api"] as AdapterApiConfig | undefined;
      return new OpenAIApiAdapter(cfg?.model || "gpt-5.2", cfg?.env_key || "OPENAI_API_KEY", timeoutMs);
    }
    default: {
      // Handle dynamic local-llm-{name} adapters
      if (adapterId.startsWith("local-llm")) {
        const cfg = config.adapter_config[adapterId] as AdapterLocalConfig | undefined;
        if (cfg?.endpoint && cfg?.model) {
          return new LocalLlmAdapter(cfg.endpoint, cfg.model, cfg.name || adapterId, cfg.source, timeoutMs);
        }
      }
      return null;
    }
  }
}

/**
 * Create adapter instances based on config.
 * Tries the primary adapter first; falls back if configured and primary unavailable.
 */
export async function initializeAdapters(
  config: RoundtableConfig
): Promise<Map<string, BaseAdapter>> {
  const adapters = new Map<string, BaseAdapter>();
  const timeoutMs = config.rules.timeout_per_turn_seconds * 1000;

  for (const knight of config.knights) {
    const primary = createAdapter(knight.adapter, config, timeoutMs);
    if (!primary) {
      console.log(chalk.yellow(`  ? ${knight.name}: unknown adapter "${knight.adapter}"`));
      continue;
    }

    const primaryAvailable = await primary.isAvailable();
    if (primaryAvailable) {
      // Detect context window for local adapters
      if (primary instanceof LocalLlmAdapter) {
        const ctx = await primary.detectContextWindow();
        if (ctx) {
          console.log(chalk.dim(`  ${knight.name}: detected ${Math.round(ctx / 1024)}K context window`));
        }
      }
      adapters.set(knight.adapter, primary);
      console.log(chalk.green(`  \u2713 ${knight.name} ready (${knight.adapter})`));
      continue;
    }

    if (knight.fallback) {
      console.log(chalk.dim(`  ${knight.name}: ${knight.adapter} unavailable, trying fallback...`));
      const fallback = createAdapter(knight.fallback, config, timeoutMs);
      if (fallback) {
        const fallbackAvailable = await fallback.isAvailable();
        if (fallbackAvailable) {
          adapters.set(knight.adapter, fallback);
          console.log(chalk.green(`  \u2713 ${knight.name} ready (fallback: ${knight.fallback})`));
          continue;
        }
      }
    }

    console.log(chalk.yellow(`  \u2717 ${knight.name} not available`));
  }

  return adapters;
}
