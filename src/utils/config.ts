import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { RoundtableConfig } from "../types.js";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * Load and validate the .roundtable/config.json from a project root.
 */
export async function loadConfig(projectRoot: string): Promise<RoundtableConfig> {
  const configPath = join(projectRoot, ".roundtable", "config.json");

  if (!existsSync(configPath)) {
    throw new ConfigError(
      'No .roundtable/config.json found. Run "roundtable init" first.'
    );
  }

  const raw = await readFile(configPath, "utf-8");
  let config: RoundtableConfig;

  try {
    config = JSON.parse(raw);
  } catch {
    throw new ConfigError("Invalid config.json — could not parse JSON.");
  }

  validateConfig(config);
  return config;
}

/**
 * Validate a RoundtableConfig object for required fields and sane values.
 */
export function validateConfig(config: RoundtableConfig): void {
  if (!config.version) {
    throw new ConfigError("config.json missing 'version' field.");
  }

  if (!Array.isArray(config.knights) || config.knights.length === 0) {
    throw new ConfigError("config.json must have at least one knight.");
  }

  for (const knight of config.knights) {
    if (!knight.name || !knight.adapter) {
      throw new ConfigError(
        `Knight missing required fields (name, adapter): ${JSON.stringify(knight)}`
      );
    }
    if (!Array.isArray(knight.capabilities)) {
      throw new ConfigError(`Knight "${knight.name}" missing capabilities array.`);
    }
    if (typeof knight.priority !== "number") {
      throw new ConfigError(`Knight "${knight.name}" missing numeric priority.`);
    }
  }

  if (!config.rules) {
    throw new ConfigError("config.json missing 'rules' section.");
  }

  const { rules } = config;
  if (typeof rules.max_rounds !== "number" || rules.max_rounds < 1) {
    throw new ConfigError("rules.max_rounds must be a positive number.");
  }
  if (
    typeof rules.consensus_threshold !== "number" ||
    rules.consensus_threshold < 0 ||
    rules.consensus_threshold > 10
  ) {
    throw new ConfigError("rules.consensus_threshold must be between 0 and 10.");
  }
  if (typeof rules.timeout_per_turn_seconds !== "number" || rules.timeout_per_turn_seconds < 1) {
    throw new ConfigError("rules.timeout_per_turn_seconds must be a positive number.");
  }

  if (!config.adapter_config) {
    throw new ConfigError("config.json missing 'adapter_config' section.");
  }
}
