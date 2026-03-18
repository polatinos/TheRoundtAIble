export interface KnightConfig {
  name: string;
  adapter: string;
  capabilities: string[];
  priority: number;
  fallback?: string;
}

export interface RulesConfig {
  max_rounds: number;
  consensus_threshold: number;
  timeout_per_turn_seconds: number;
  escalate_to_user_after: number;
  auto_execute: boolean;
  ignore: string[];
}

export interface AdapterCliConfig {
  command: string;
  args: string[];
}

export interface AdapterApiConfig {
  model: string;
  env_key: string;
}

export interface AdapterLocalConfig {
  endpoint: string;   // e.g. "http://localhost:1234"
  model: string;      // e.g. "qwen/qwen2.5-coder-14b"
  name?: string;      // display name override
  source?: "Ollama" | "LM Studio";  // detected platform — drives API format & error handling
}

export type AdapterConfig = Record<string, AdapterCliConfig | AdapterApiConfig | AdapterLocalConfig>;

export interface RoundtableConfig {
  version: string;
  project: string;
  language: string;
  knights: KnightConfig[];
  rules: RulesConfig;
  chronicle: string;
  adapter_config: AdapterConfig;
}

export interface ConsensusBlock {
  knight: string;
  round: number;
  consensus_score: number;
  agrees_with: string[];
  pending_issues: string[];
  proposal?: string;
  files_to_modify?: string[];
  file_requests?: string[];    // max 4 per round — orchestrator reads files for next round
  verify_commands?: string[];  // max 4 per round — read-only shell commands for verification
}

export interface RoundEntry {
  knight: string;
  round: number;
  response: string;
  consensus: ConsensusBlock | null;
  timestamp: string;
}

export type SessionPhase =
  | "discussing"
  | "consensus_reached"
  | "escalated";

export interface SessionStatus {
  phase: SessionPhase;
  current_knight: string | null;
  round: number;
  consensus_reached: boolean;
  started_at: string;
  updated_at: string;
  lead_knight?: string;
  decisions_hash?: string;
  allowed_files?: string[];
}

export interface SessionResult {
  sessionPath: string;
  consensus: boolean;
  rounds: number;
  decision: string | null;
  blocks: ConsensusBlock[];
  allRounds: RoundEntry[];
  /** True when all knights unanimously reject the proposal (all scores <= 3) */
  unanimousRejection?: boolean;
  /** Accumulated file_requests output — needed for "send back" continuation */
  resolvedFiles?: string;
  /** Accumulated verify_commands output — needed for "send back" continuation */
  resolvedCommands?: string;
}

/** State passed to runDiscussion when the King sends knights back for another attempt. */
export interface ContinueOptions {
  sessionPath: string;
  allRounds: RoundEntry[];
  startRound: number;
  resolvedFiles: string;
  resolvedCommands: string;
}

// --- Manifest types ---

export type ManifestFeatureStatus = "implemented" | "partial" | "deprecated";

export interface ManifestEntry {
  id: string;
  session: string;
  status: ManifestFeatureStatus;
  files: string[];
  files_skipped?: string[];
  summary: string;
  applied_at: string;
  lead_knight: string;
  replaced_by?: string;
}

export interface Manifest {
  version: "1.0";
  last_updated: string;
  features: ManifestEntry[];
}

// --- Decree Log types ---

export type DecreeType = "rejected_no_apply" | "deferred";

export interface DecreeEntry {
  id: string;
  type: DecreeType;
  session: string;
  topic: string;
  reason: string;
  revoked: boolean;
  date: string;
}

export interface DecreeLog {
  version: "1.0";
  entries: DecreeEntry[];
}

