import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import type { Manifest, ManifestEntry, ManifestFeatureStatus } from "../types.js";

const MANIFEST_PATH = ".roundtable/manifest.json";

/**
 * Create an empty manifest.
 */
function emptyManifest(): Manifest {
  return {
    version: "1.0",
    last_updated: new Date().toISOString(),
    features: [],
  };
}

/**
 * Read the manifest from disk. Returns empty manifest if not found.
 */
export async function readManifest(projectRoot: string): Promise<Manifest> {
  const fullPath = join(projectRoot, MANIFEST_PATH);

  if (!existsSync(fullPath)) {
    return emptyManifest();
  }

  try {
    const raw = await readFile(fullPath, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed as Manifest;
  } catch {
    return emptyManifest();
  }
}

/**
 * Write the manifest to disk.
 */
export async function writeManifest(
  projectRoot: string,
  manifest: Manifest
): Promise<void> {
  const fullPath = join(projectRoot, MANIFEST_PATH);
  const dir = dirname(fullPath);

  await mkdir(dir, { recursive: true });

  manifest.last_updated = new Date().toISOString();
  await writeFile(fullPath, JSON.stringify(manifest, null, 2), "utf-8");
}

/**
 * Add or update a feature entry in the manifest.
 */
export async function addManifestEntry(
  projectRoot: string,
  entry: ManifestEntry
): Promise<void> {
  const manifest = await readManifest(projectRoot);

  // Check if feature with same id exists — update it
  const existingIdx = manifest.features.findIndex((f) => f.id === entry.id);
  if (existingIdx >= 0) {
    manifest.features[existingIdx] = entry;
  } else {
    manifest.features.push(entry);
  }

  await writeManifest(projectRoot, manifest);
}

/**
 * Deprecate a feature by id.
 */
export async function deprecateFeature(
  projectRoot: string,
  featureId: string,
  replacedBy?: string
): Promise<boolean> {
  const manifest = await readManifest(projectRoot);
  const feature = manifest.features.find((f) => f.id === featureId);

  if (!feature) return false;

  feature.status = "deprecated";
  if (replacedBy) feature.replaced_by = replacedBy;

  await writeManifest(projectRoot, manifest);
  return true;
}

/**
 * Check manifest for stale entries (files that no longer exist on disk).
 * Returns list of warnings.
 */
export async function checkManifest(
  projectRoot: string
): Promise<string[]> {
  const manifest = await readManifest(projectRoot);
  const warnings: string[] = [];

  for (const feature of manifest.features) {
    if (feature.status === "deprecated") continue;

    for (const file of feature.files) {
      const fullPath = join(projectRoot, file);
      if (!existsSync(fullPath)) {
        warnings.push(
          `${feature.id}: "${file}" no longer exists on disk (stale entry)`
        );
      }
    }
  }

  return warnings;
}

/**
 * Generate a compact manifest summary for the system prompt.
 * Shows recent features, max ~500 tokens.
 */
export function getManifestSummary(manifest: Manifest): string {
  if (manifest.features.length === 0) {
    return "No implementation history yet.";
  }

  // Show last 15 features, most recent first
  const recent = manifest.features.slice(-15).reverse();

  const lines: string[] = [];
  for (const f of recent) {
    const statusIcon =
      f.status === "implemented" ? "+" :
      f.status === "partial" ? "~" :
      "x";
    const filesShort = f.files.slice(0, 3).join(", ");
    const more = f.files.length > 3 ? ` +${f.files.length - 3} more` : "";
    lines.push(`- [${statusIcon}] ${f.id} — ${f.summary} (${filesShort}${more})`);
  }

  return lines.join("\n");
}

/**
 * Generate a feature ID from a session topic.
 * Converts to kebab-case, max 40 chars.
 */
export function topicToFeatureId(topic: string): string {
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 40)
    .replace(/-$/, "");
}

/**
 * Get the summary text for a manifest entry.
 * Priority: decisions.md first paragraph > topic.
 */
export async function getFeatureSummary(
  sessionPath: string,
  topic: string
): Promise<string> {
  const decisionsPath = join(sessionPath, "decisions.md");

  try {
    const content = await readFile(decisionsPath, "utf-8");
    // Skip the header lines, get first meaningful paragraph
    const lines = content.split("\n").filter((l) => l.trim() && !l.startsWith("#") && !l.startsWith("---"));
    const firstParagraph = lines[0]?.trim();
    if (firstParagraph && firstParagraph.length > 10) {
      return firstParagraph.length > 140 ? firstParagraph.slice(0, 137) + "..." : firstParagraph;
    }
  } catch {
    // Fall through to topic
  }

  return topic.length > 140 ? topic.slice(0, 137) + "..." : topic;
}
