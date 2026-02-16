import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
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

/**
 * Generate a config.json based on detected tools.
 */
function generateConfig(
  projectName: string,
  detectedTools: DetectedTool[]
): RoundtableConfig {
  const knights: KnightConfig[] = [];
  let priority = 1;

  for (const tool of detectedTools) {
    if (tool.available) {
      const capabilities =
        tool.name === "Claude"
          ? ["architecture", "refactoring", "logic", "debugging", "testing"]
          : ["docs", "ui-ux", "summarization", "review", "planning"];

      knights.push({
        name: tool.name,
        adapter: tool.adapter,
        capabilities,
        priority: priority++,
        fallback: `${tool.name.toLowerCase()}-api`,
      });
    }
  }

  // Always add GPT as an API-based option
  knights.push({
    name: "GPT",
    adapter: "openai-api",
    capabilities: ["communication", "content", "explanation"],
    priority: priority,
  });

  return {
    version: "1.0",
    project: projectName,
    language: "nl",
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
      chalk.yellow("⚠ .roundtable/ already exists in this project.")
    );
    console.log(chalk.dim("  Use the existing config or delete .roundtable/ to reinitialize."));
    return;
  }

  console.log(chalk.bold("Initializing TheRoundtAIble...\n"));

  // Detect tools
  const detectSpinner = ora("Detecting available AI tools...").start();
  const tools = await detectTools();
  detectSpinner.succeed("Detection complete");

  for (const tool of tools) {
    const icon = tool.available ? chalk.green("✓") : chalk.red("✗");
    console.log(`  ${icon} ${tool.name} (${tool.command})`);
  }

  const availableCount = tools.filter((t) => t.available).length;
  if (availableCount === 0) {
    console.log(
      chalk.yellow(
        "\n  No CLI tools detected. Knights will need API keys to function."
      )
    );
  }

  // Derive project name from directory
  const projectName = projectRoot.split(/[\\/]/).pop() || "MyProject";

  // Generate config
  const config = generateConfig(projectName, tools);

  // Create folder structure
  const structureSpinner = ora("Creating .roundtable/ structure...").start();
  await mkdir(join(roundtablePath, "sessions"), { recursive: true });

  // Write config.json
  await writeFile(
    join(roundtablePath, "config.json"),
    JSON.stringify(config, null, 2),
    "utf-8"
  );

  // Write empty chronicle.md
  await writeFile(
    join(roundtablePath, "chronicle.md"),
    "# Chronicle - TheRoundtAIble\n\nBeslissingen log van dit project.\n\n---\n\n",
    "utf-8"
  );

  structureSpinner.succeed("Structure created");

  // Summary
  console.log(chalk.bold.green("\nTheRoundtAIble initialized!"));
  console.log(`  Config: ${chalk.dim(join(roundtablePath, "config.json"))}`);
  console.log(`  Chronicle: ${chalk.dim(join(roundtablePath, "chronicle.md"))}`);
  console.log(`  Knights: ${config.knights.map((k) => k.name).join(", ")}`);
  console.log(
    chalk.dim('\n  Run `roundtable discuss "your question"` to start a discussion.')
  );
}
