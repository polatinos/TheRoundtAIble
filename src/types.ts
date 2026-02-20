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
  file_requests?: string[];    // max 4 per round — orchestrator reads files for next round
  verify_commands?: string[];  // max 4 per round — read-only shell commands for verification
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

// --- Decree Log types ---

export type DecreeType = "rejected_no_apply" | "deferred" | "override_scope";

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

// --- Validation types ---

export type ValidationCheckType = "bracket_balance" | "artifact_detection" | "duplicate_import";

export interface ValidationIssue {
  type: ValidationCheckType;
  message: string;
  line: number;
  snippet: string;
}

export interface ValidationReport {
  path: string;
  issues: ValidationIssue[];
  passed: boolean;
}

// --- Edit/Diff types ---

export interface EditOperation {
  search: string;
  replace: string;
}

export interface ParsedEdit {
  path: string;
  edits: EditOperation[];
}

export interface EditApplyResult {
  path: string;
  success: boolean;
  content?: string;
  failedEdits?: number[];
  errors?: string[];
}

export interface ParsedKnightOutput {
  files: Array<{ path: string; content: string; language: string }>;
  edits: ParsedEdit[];
}

// --- Block Scanner types ---

export type SegmentKind = "preamble" | "function" | "class" | "class_method" | "gap";

export interface SegmentInfo {
  /** Stable segment key: "preamble", "fn:runDiscussion", "class:Orchestrator", "class:Orchestrator#constructor", "gap:1" */
  key: string;
  kind: SegmentKind;
  startLine: number; // 1-indexed
  endLine: number;   // 1-indexed, inclusive
  name?: string;
  className?: string;
}

export interface ScanResult {
  segments: SegmentInfo[];
  /** Line number where preamble ends (0 if no preamble) */
  preambleEnd: number;
}

// --- RTDIFF Block Operation types ---

export type BlockOpType =
  | "BLOCK_REPLACE"
  | "BLOCK_INSERT_AFTER"
  | "BLOCK_DELETE"
  | "PREAMBLE_REPLACE";

export interface BlockOperation {
  type: BlockOpType;
  filePath: string;
  segmentKey: string; // e.g., "fn:writeFiles", "class:Orchestrator#run", "gap:1", "preamble"
  content?: string;   // new content (not needed for DELETE)
}

export interface ParsedRtdiff {
  operations: BlockOperation[];
  /** FILE: blocks for new files */
  newFiles: Array<{ path: string; content: string }>;
}

export interface PatchResult {
  path: string;
  success: boolean;
  content?: string;
  error?: string;
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
