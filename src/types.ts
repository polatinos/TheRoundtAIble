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

export type AdapterConfig = Record<string, AdapterCliConfig | AdapterApiConfig>;

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
}

export interface DiagnosticBlock {
  knight: string;
  round: number;
  confidence_score: number;
  root_cause_key: string;
  evidence: string[];
  rules_out: string[];
  confirms: string[];
  file_requests: string[];
  next_test: string;
}

export interface DiagnosisResult {
  sessionPath: string;
  converged: boolean;
  rootCauseKey: string | null;
  rootCause: string | null;
  codeRedId: string;
  rounds: number;
  allRounds: RoundEntry[];
}

export interface ErrorLogEntry {
  id: string;
  symptoms: string;
  rootCause: string | null;
  triedAndFailed: string[];
  status: "OPEN" | "RESOLVED" | "PARKED";
  date: string;
}

export type SessionMode = "discussion" | "diagnosis";

export interface RoundEntry {
  knight: string;
  round: number;
  response: string;
  consensus: ConsensusBlock | null;
  diagnostic?: DiagnosticBlock | null;
  timestamp: string;
}

export type SessionPhase =
  | "discussing"
  | "consensus_reached"
  | "escalated"
  | "applying"
  | "completed"
  | "triaging"
  | "diagnosing"
  | "diagnosis_converged"
  | "diagnosis_parked";

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

// --- File change types ---

export interface FileChange {
  path: string;
  action: "create" | "modify" | "delete";
  content?: string;
}

export interface Changeset {
  generated_at: string;
  decisions_hash: string;
  lead_knight: string;
  git_head: string;
  session_id: string;
  files: FileChange[];
}
