import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { execa } from "execa";
import chalk from "chalk";
import ora from "ora";
import type { RoundtableConfig, KnightConfig } from "../types.js";
import { saveKey, getKey, getKeysPath } from "../utils/keys.js";

interface DetectedTool {
  name: string;
  adapter: string;
  command: string;
  available: boolean;
}

const rl = () =>
  createInterface({ input: process.stdin, output: process.stdout });

/**
 * Ask a yes/no question. Returns true for yes.
 */
async function confirm(question: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? "[Y/n]" : "[y/N]";
  const r = rl();
  const answer = await r.question(`${question} ${hint} `);
  r.close();
  const trimmed = answer.trim().toLowerCase();
  if (trimmed === "") return defaultYes;
  return trimmed === "y" || trimmed === "yes" || trimmed === "ja";
}

/**
 * Ask for text input with a default value.
 */
async function askText(question: string, defaultValue: string): Promise<string> {
  const r = rl();
  const answer = await r.question(`${question} ${chalk.dim(`(${defaultValue})`)} `);
  r.close();
  return answer.trim() || defaultValue;
}

/**
 * Ask for a secret (API key). Input is hidden with asterisks.
 */
async function askSecret(question: string): Promise<string> {
  return new Promise((resolve) => {
    const r = createInterface({ input: process.stdin, output: process.stdout });
    // Mute output to hide the key as user types
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    if (stdin.isTTY && stdin.setRawMode) {
      stdin.setRawMode(true);
    }

    process.stdout.write(`${question} `);
    let secret = "";

    const onData = (ch: Buffer) => {
      const c = ch.toString("utf-8");
      if (c === "\n" || c === "\r" || c === "\u0004") {
        // Enter or EOF
        if (stdin.isTTY && stdin.setRawMode) stdin.setRawMode(wasRaw ?? false);
        stdin.removeListener("data", onData);
        process.stdout.write("\n");
        r.close();
        resolve(secret.trim());
      } else if (c === "\u007f" || c === "\b") {
        // Backspace
        if (secret.length > 0) {
          secret = secret.slice(0, -1);
          process.stdout.write("\b \b");
        }
      } else if (c === "\u0003") {
        // Ctrl+C
        if (stdin.isTTY && stdin.setRawMode) stdin.setRawMode(wasRaw ?? false);
        stdin.removeListener("data", onData);
        r.close();
        resolve("");
      } else {
        secret += c;
        process.stdout.write("*");
      }
    };

    stdin.on("data", onData);
  });
}

/**
 * Detect which CLI tools are available on the system.
 */
async function detectTools(): Promise<DetectedTool[]> {
  const tools: DetectedTool[] = [
    { name: "Claude", adapter: "claude-cli", command: "claude", available: false },
    { name: "Gemini", adapter: "gemini-cli", command: "gemini", available: false },
    { name: "GPT", adapter: "openai-cli", command: "codex", available: false },
  ];

  for (const tool of tools) {
    try {
      await execa(tool.command, ["--version"]);
      tool.available = true;
    } catch {
      // Not available
    }
  }

  return tools;
}

const DEFAULT_CAPABILITIES: Record<string, string[]> = {
  Claude: ["architecture", "refactoring", "logic", "debugging", "testing"],
  Gemini: ["docs", "ui-ux", "summarization", "review", "planning"],
  GPT: ["communication", "content", "explanation"],
};

/**
 * Generate a config.json based on detected tools and user choices.
 */
function generateConfig(
  projectName: string,
  language: string,
  enabledKnights: { name: string; adapter: string; fallback?: string }[]
): RoundtableConfig {
  const knights: KnightConfig[] = enabledKnights.map((k, i) => ({
    name: k.name,
    adapter: k.adapter,
    capabilities: DEFAULT_CAPABILITIES[k.name] || ["general"],
    priority: i + 1,
    ...(k.fallback ? { fallback: k.fallback } : {}),
  }));

  return {
    version: "1.0",
    project: projectName,
    language,
    knights,
    rules: {
      max_rounds: 5,
      consensus_threshold: 9,
      timeout_per_turn_seconds: 120,
      escalate_to_user_after: 3,
      auto_execute: false,
      ignore: [".git", "node_modules", "dist", "build", ".next"],
    },
    chronicle: ".roundtable/chronicle.md",
    adapter_config: {
      "claude-cli": {
        command: "claude",
        args: ["-p", "{prompt}", "--print"],
      },
      "claude-api": {
        model: "claude-sonnet-4-20250514",
        env_key: "ANTHROPIC_API_KEY",
      },
      "gemini-cli": {
        command: "gemini",
        args: ["-p", "{prompt}"],
      },
      "gemini-api": {
        model: "gemini-2.0-flash",
        env_key: "GEMINI_API_KEY",
      },
      "openai-cli": {
        command: "codex",
        args: ["exec", "{prompt}"],
      },
      "openai-api": {
        model: "gpt-4o",
        env_key: "OPENAI_API_KEY",
      },
    },
  };
}

/**
 * The `roundtable init` command.
 */
export async function initCommand(version: string): Promise<void> {
  const projectRoot = process.cwd();
  const roundtablePath = join(projectRoot, ".roundtable");

  // Check if already initialized
  if (existsSync(roundtablePath)) {
    console.log(
      chalk.yellow("\n  The roundtable already exists in this project.")
    );
    const overwrite = await confirm("  Reinitialize? This will overwrite your config.", false);
    if (!overwrite) {
      console.log(chalk.dim("  Wise choice. The table stands."));
      return;
    }
  }

  console.log(chalk.bold("\n  Welcome to TheRoundtAIble\n"));
  console.log(chalk.dim(`  Version: v${version}`));
  console.log(chalk.dim("  Where no AI is King, but all serve the Code.\n"));

  // 1. Project name
  const dirName = projectRoot.split(/[\\/]/).pop() || "MyProject";
  const projectName = await askText("  Project name?", dirName);

  // 2. Language
  const language = await askText("  Discussion language?", "nl");

  // 3. Detect tools
  console.log("");
  const detectSpinner = ora("  Scouting for available knights...").start();
  const tools = await detectTools();
  detectSpinner.succeed("  Scouting complete");

  for (const tool of tools) {
    const icon = tool.available ? chalk.green("  +") : chalk.red("  -");
    const status = tool.available
      ? chalk.green("ready for battle")
      : chalk.dim("not found");
    console.log(`${icon} ${chalk.bold(tool.name)} ${chalk.dim(`(${tool.command})`)} — ${status}`);
  }

  // 4. Let user choose which knights to enable
  console.log("");
  const enabledKnights: { name: string; adapter: string; fallback?: string }[] = [];

  const FALLBACKS: Record<string, string> = {
    "claude-cli": "claude-api",
    "gemini-cli": "gemini-api",
    "openai-cli": "openai-api",
  };

  // Map CLI adapters to their API-only counterparts
  const API_ADAPTERS: Record<string, string> = {
    "claude-cli": "claude-api",
    "gemini-cli": "gemini-api",
    "openai-cli": "openai-api",
  };

  // Map API adapters to their env var names
  const API_ENV_KEYS: Record<string, string> = {
    "claude-api": "ANTHROPIC_API_KEY",
    "gemini-api": "GEMINI_API_KEY",
    "openai-api": "OPENAI_API_KEY",
  };

  const apiKeyReminders: string[] = [];

  for (const tool of tools) {
    if (tool.available) {
      const use = await confirm(`  Seat ${tool.name} at the table?`, true);
      if (use) {
        enabledKnights.push({
          name: tool.name,
          adapter: tool.adapter,
          fallback: FALLBACKS[tool.adapter],
        });

        // Offer to set up fallback API key
        const fallbackAdapter = FALLBACKS[tool.adapter];
        const fallbackEnvKey = fallbackAdapter ? API_ENV_KEYS[fallbackAdapter] : undefined;
        if (fallbackEnvKey) {
          const existingFallbackKey = await getKey(fallbackEnvKey);
          if (existingFallbackKey) {
            console.log(chalk.dim(`  ✓ ${tool.name} fallback API key already set`));
            const update = await confirm(`  Replace existing ${tool.name} fallback API key?`, false);
            if (update) {
              const key = await askSecret(`  Enter your new ${tool.name} API key:`);
              if (key) {
                await saveKey(fallbackEnvKey, key);
                console.log(chalk.green(`  ✓ ${tool.name} fallback API key updated`));
              }
            }
          } else {
            const wantFallback = await confirm(`  Set up a fallback API key for ${tool.name}? (used if CLI fails)`, false);
            if (wantFallback) {
              const key = await askSecret(`  Enter your ${tool.name} API key:`);
              if (key) {
                await saveKey(fallbackEnvKey, key);
                console.log(chalk.green(`  ✓ ${tool.name} fallback API key saved to ${chalk.dim(getKeysPath())}`));
              }
            }
          }
        }
      }
    } else {
      const use = await confirm(
        `  ${tool.name} is MIA. Add anyway (requires API key)?`,
        false
      );
      if (use) {
        // CLI not available → use API adapter directly, no fallback needed
        const apiAdapter = API_ADAPTERS[tool.adapter] || tool.adapter;
        const envKey = API_ENV_KEYS[apiAdapter];

        if (envKey) {
          // Check if key already exists (env var or keystore)
          const existingKey = await getKey(envKey);
          if (existingKey) {
            console.log(chalk.green(`  ✓ ${tool.name} API key found`));
            const update = await confirm(`  Replace existing ${tool.name} API key?`, false);
            if (update) {
              const key = await askSecret(`  Enter your new ${tool.name} API key:`);
              if (key) {
                await saveKey(envKey, key);
                console.log(chalk.green(`  ✓ ${tool.name} API key updated in ${chalk.dim(getKeysPath())}`));
              }
            }
          } else {
            // Ask for the API key
            const key = await askSecret(`  Enter your ${tool.name} API key:`);
            if (key) {
              await saveKey(envKey, key);
              console.log(chalk.green(`  ✓ ${tool.name} API key saved securely to ${chalk.dim(getKeysPath())}`));
            } else {
              apiKeyReminders.push(`  ${envKey}  # ${tool.name}`);
            }
          }
        }

        enabledKnights.push({
          name: tool.name,
          adapter: apiAdapter,
        });
      }
    }
  }

  if (enabledKnights.length === 0) {
    console.log(chalk.red("\n  A roundtable with no knights is just a table."));
    console.log(chalk.dim("  Re-run `roundtable init` and enable at least one knight."));
    return;
  }

  // 5. Generate config
  const config = generateConfig(projectName, language, enabledKnights);

  // 6. Create folder structure
  console.log("");
  const structureSpinner = ora("  Forging the roundtable...").start();
  await mkdir(join(roundtablePath, "sessions"), { recursive: true });

  await writeFile(
    join(roundtablePath, "config.json"),
    JSON.stringify(config, null, 2),
    "utf-8"
  );

  await writeFile(
    join(roundtablePath, "chronicle.md"),
    "# Chronicle — TheRoundtAIble\n\nThe record of all decisions made at this table.\n\n---\n\n",
    "utf-8"
  );

  await writeFile(
    join(roundtablePath, "manifest.json"),
    JSON.stringify({ version: "1.0", last_updated: new Date().toISOString(), features: [] }, null, 2),
    "utf-8"
  );

  structureSpinner.succeed("  The roundtable is forged");

  // 7. Summary
  console.log(chalk.bold.green("\n  TheRoundtAIble is ready.\n"));
  console.log(`    Project:   ${chalk.cyan(config.project)}`);
  console.log(`    Language:  ${chalk.cyan(config.language)}`);
  console.log(`    Knights:   ${config.knights.map((k) => chalk.cyan(k.name)).join(", ")}`);
  console.log(`    Config:    ${chalk.dim(join(roundtablePath, "config.json"))}`);
  console.log(`    Chronicle: ${chalk.dim(join(roundtablePath, "chronicle.md"))}`);
  // Show reminder for keys that weren't entered during init
  if (apiKeyReminders.length > 0) {
    console.log(chalk.yellow("\n  ⚔  Missing API keys — you skipped these during setup:\n"));
    for (const reminder of apiKeyReminders) {
      console.log(chalk.cyan(reminder));
    }
    console.log(chalk.dim("\n  Re-run `roundtable init` to enter them, or set as environment variables."));
  }

  console.log(
    chalk.dim('\n  The table is set. Run `roundtable discuss "your question"` to begin.\n')
  );
}
