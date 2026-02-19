import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Secure API key storage.
 * Keys are stored in ~/.theroundtaible/keys.json with chmod 600 (owner-only).
 */

const KEYS_DIR = join(homedir(), ".theroundtaible");
const KEYS_FILE = join(KEYS_DIR, "keys.json");

type KeyStore = Record<string, string>;

/**
 * Load all stored keys. Returns empty object if file doesn't exist.
 */
export async function loadKeys(): Promise<KeyStore> {
  if (!existsSync(KEYS_FILE)) return {};
  try {
    const raw = await readFile(KEYS_FILE, "utf-8");
    return JSON.parse(raw) as KeyStore;
  } catch {
    return {};
  }
}

/**
 * Save a single key to the store. Merges with existing keys.
 */
export async function saveKey(name: string, value: string): Promise<void> {
  if (!existsSync(KEYS_DIR)) {
    await mkdir(KEYS_DIR, { recursive: true });
  }

  const keys = await loadKeys();
  keys[name] = value;

  await writeFile(KEYS_FILE, JSON.stringify(keys, null, 2), "utf-8");

  // chmod 600 — owner read/write only. Silently ignore on Windows.
  try {
    await chmod(KEYS_FILE, 0o600);
    await chmod(KEYS_DIR, 0o700);
  } catch {
    // Windows doesn't support Unix permissions
  }
}

/**
 * Get a specific key. Checks env var first, then keystore.
 */
export async function getKey(envVar: string): Promise<string | undefined> {
  // 1. Environment variable takes priority
  const fromEnv = process.env[envVar];
  if (fromEnv && fromEnv.length > 0) return fromEnv;

  // 2. Fallback to keystore
  const keys = await loadKeys();
  return keys[envVar] || undefined;
}

/**
 * Path to the keys file (for display purposes).
 */
export function getKeysPath(): string {
  return KEYS_FILE;
}
