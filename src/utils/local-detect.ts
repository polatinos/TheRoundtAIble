import { execa } from "execa";

export interface LocalModel {
  name: string;        // display name, e.g. "Qwen 2.5 Coder 14B"
  modelId: string;     // model identifier, e.g. "qwen/qwen2.5-coder-14b"
  endpoint: string;    // e.g. "http://localhost:1234"
  source: string;      // "LM Studio" | "Ollama"
}

interface ModelsApiResponse {
  data?: Array<{ id: string; owned_by?: string }>;
}

const ENDPOINTS = [
  { url: "http://localhost:1234", source: "LM Studio" },
  { url: "http://localhost:11434", source: "Ollama" },
];

/**
 * Turn a raw model ID into a human-readable display name.
 * "qwen/qwen2.5-coder-14b" → "Qwen 2.5 Coder 14B"
 */
function prettifyModelName(modelId: string): string {
  // Take the part after the last slash (or the whole string)
  const raw = modelId.includes("/") ? modelId.split("/").pop()! : modelId;
  return raw
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/(\d+)b\b/gi, "$1B"); // "14b" → "14B"
}

/**
 * Filter out models that can't do chat completions (embeddings, TTS, whisper, etc.)
 */
function isNonChatModel(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  return /\b(embed|embedding|tts|whisper|rerank)\b/.test(lower);
}

/**
 * Fetch models from an OpenAI-compatible /v1/models endpoint.
 */
async function fetchModelsFromEndpoint(
  endpoint: string,
  source: string,
): Promise<LocalModel[]> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const response = await fetch(`${endpoint}/v1/models`, {
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) return [];

    const body = (await response.json()) as ModelsApiResponse;
    if (!body.data || !Array.isArray(body.data)) return [];

    return body.data
      .filter((m) => !isNonChatModel(m.id))
      .map((m) => ({
        name: prettifyModelName(m.id),
        modelId: m.id,
        endpoint,
        source,
      }));
  } catch {
    return [];
  }
}

/**
 * Try `ollama list` CLI as a fallback when Ollama's /v1/ endpoint is not
 * responding (server might not be started yet, or the compat layer is off).
 */
async function fetchModelsFromOllamaCli(): Promise<LocalModel[]> {
  try {
    const { stdout } = await execa("ollama", ["list"], { timeout: 5000 });
    const lines = stdout.trim().split("\n").slice(1); // skip header row
    const models: LocalModel[] = [];
    for (const line of lines) {
      const cols = line.trim().split(/\s+/);
      if (cols.length === 0 || !cols[0]) continue;
      const modelId = cols[0].replace(/:latest$/, ""); // strip ":latest" tag
      models.push({
        name: prettifyModelName(modelId),
        modelId,
        endpoint: "http://localhost:11434",
        source: "Ollama",
      });
    }
    return models;
  } catch {
    return [];
  }
}

/**
 * Detect all locally running LLM servers and their loaded models.
 * Scans known ports (LM Studio, Ollama) and falls back to CLI detection.
 */
export async function detectLocalModels(): Promise<LocalModel[]> {
  const allModels: LocalModel[] = [];
  const seenIds = new Set<string>();

  // Scan all known endpoints in parallel
  const results = await Promise.all(
    ENDPOINTS.map((ep) => fetchModelsFromEndpoint(ep.url, ep.source)),
  );

  for (const models of results) {
    for (const m of models) {
      if (!seenIds.has(m.modelId)) {
        seenIds.add(m.modelId);
        allModels.push(m);
      }
    }
  }

  // If Ollama endpoint didn't return models, try CLI fallback
  const hasOllamaModels = allModels.some((m) => m.source === "Ollama");
  if (!hasOllamaModels) {
    const cliModels = await fetchModelsFromOllamaCli();
    for (const m of cliModels) {
      if (!seenIds.has(m.modelId)) {
        seenIds.add(m.modelId);
        allModels.push(m);
      }
    }
  }

  return allModels;
}
