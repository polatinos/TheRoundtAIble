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

export type AdapterConfig = AdapterCliConfig | AdapterApiConfig;

export interface RoundtableConfig {
  version: string;
  project: string;
  language: string;
  knights: KnightConfig[];
  rules: RulesConfig;
  chronicle: string;
  adapter_config: Record<string, AdapterConfig>;
}

export interface ConsensusBlock {
  knight: string;
  round: number;
  consensus_score: number;
  agrees_with: string[];
  pending_issues: string[];
  proposal?: string;
}

export interface RoundEntry {
  knight: string;
  round: number;
  response: string;
  consensus: ConsensusBlock | null;
  timestamp: string;
}

export type SessionPhase = "discussing" | "consensus_reached" | "escalated" | "applying" | "completed";

export interface SessionStatus {
  phase: SessionPhase;
  current_knight: string | null;
  round: number;
  consensus_reached: boolean;
  started_at: string;
  updated_at: string;
}

export interface SessionResult {
  sessionPath: string;
  consensus: boolean;
  rounds: number;
  decision: string | null;
  blocks: ConsensusBlock[];
}
