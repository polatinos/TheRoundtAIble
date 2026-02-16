import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { execa } from "execa";
import chalk from "chalk";
import ora from "ora";
import type { RoundtableConfig, KnightConfig } from "../types.js";

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
 * Detect which CLI tools are available on the system.
 */
async function detectTools(): Promise<DetectedTool[]> {
  const tools: DetectedTool[] = [
    { name: "Claude", adapter: "claude-cli", command: "claude", available: false },
    { name: "Gemini", adapter: "gemini-cli", command: "gemini", available: false },
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
      "gemini-cli": {
        command: "gemini",
        args: ["-p", "{prompt}"],
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
export async function initCommand(): Promise<void> {
  const projectRoot = process.cwd();
  const roundtablePath = join(projectRoot, ".roundtable");

  // Check if already initialized
  if (existsSync(roundtablePath)) {
    console.log(
      chalk.yellow("\n  .roundtable/ already exists in this project.")
    );
    const overwrite = await confirm("  Reinitialize? (overwrites config)", false);
    if (!overwrite) {
      console.log(chalk.dim("  Aborted."));
      return;
    }
  }

  console.log(chalk.bold("\n  TheRoundtAIble Setup Wizard\n"));

  // 1. Project name
  const dirName = projectRoot.split(/[\\/]/).pop() || "MyProject";
  const projectName = await askText("  Project name?", dirName);

  // 2. Language
  const language = await askText("  Discussion language?", "nl");

  // 3. Detect tools
  console.log("");
  const detectSpinner = ora("  Detecting available AI tools...").start();
  const tools = await detectTools();
  detectSpinner.succeed("  Detection complete");

  for (const tool of tools) {
    const icon = tool.available ? chalk.green("✓") : chalk.red("✗");
    console.log(`    ${icon} ${tool.name} (${tool.command})`);
  }

  // 4. Let user choose which knights to enable
  console.log("");
  const enabledKnights: { name: string; adapter: string; fallback?: string }[] = [];

  for (const tool of tools) {
    if (tool.available) {
      const use = await confirm(`  Enable ${tool.name}?`, true);
      if (use) {
        enabledKnights.push({
          name: tool.name,
          adapter: tool.adapter,
          fallback: `${tool.name.toLowerCase()}-api`,
        });
      }
    } else {
      const use = await confirm(
        `  ${tool.name} not found. Add anyway (requires API key fallback)?`,
        false
      );
      if (use) {
        enabledKnights.push({
          name: tool.name,
          adapter: tool.adapter,
          fallback: `${tool.name.toLowerCase()}-api`,
        });
      }
    }
  }

  // GPT (always API-based)
  const hasOpenAIKey = !!process.env.OPENAI_API_KEY;
  const gptHint = hasOpenAIKey ? "OPENAI_API_KEY detected" : "requires OPENAI_API_KEY";
  const useGPT = await confirm(`  Enable GPT? ${chalk.dim(`(${gptHint})`)}`, hasOpenAIKey);
  if (useGPT) {
    enabledKnights.push({ name: "GPT", adapter: "openai-api" });
  }

  if (enabledKnights.length === 0) {
    console.log(chalk.red("\n  No knights enabled. At least one is required."));
    console.log(chalk.dim("  Re-run `roundtable init` and enable at least one knight."));
    return;
  }

  // 5. Generate config
  const config = generateConfig(projectName, language, enabledKnights);

  // 6. Create folder structure
  console.log("");
  const structureSpinner = ora("  Creating .roundtable/ structure...").start();
  await mkdir(join(roundtablePath, "sessions"), { recursive: true });

  await writeFile(
    join(roundtablePath, "config.json"),
    JSON.stringify(config, null, 2),
    "utf-8"
  );

  await writeFile(
    join(roundtablePath, "chronicle.md"),
    "# Chronicle - TheRoundtAIble\n\nBeslissingen log van dit project.\n\n---\n\n",
    "utf-8"
  );

  structureSpinner.succeed("  Structure created");

  // 7. Summary
  console.log(chalk.bold.green("\n  TheRoundtAIble initialized!"));
  console.log(`    Project:   ${chalk.cyan(config.project)}`);
  console.log(`    Language:  ${chalk.cyan(config.language)}`);
  console.log(`    Knights:   ${config.knights.map((k) => chalk.cyan(k.name)).join(", ")}`);
  console.log(`    Config:    ${chalk.dim(join(roundtablePath, "config.json"))}`);
  console.log(`    Chronicle: ${chalk.dim(join(roundtablePath, "chronicle.md"))}`);
  console.log(
    chalk.dim('\n  Run `roundtable discuss "your question"` to start.\n')
  );
}
