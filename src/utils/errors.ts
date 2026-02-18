/**
 * Centralized error hierarchy for TheRoundtAIble.
 * Flat structure: RoundtableError → {ConfigError, AdapterError, SessionError, FileWriteError, ConsensusError}
 * No SystemError class — we're building a CLI, not an exception zoo.
 */

export enum ExitCode {
  SUCCESS = 0,
  CONFIG_ERROR = 1,
  ADAPTER_ERROR = 2,
  SESSION_ERROR = 3,
  FILE_WRITE_ERROR = 4,
  CONSENSUS_ERROR = 5,
  VALIDATION_ERROR = 6,
  UNKNOWN = 99,
}

export interface ErrorOptions {
  cause?: Error;
  hint?: string;
}

export class RoundtableError extends Error {
  public readonly exitCode: ExitCode;
  public readonly hint?: string;
  public readonly cause?: Error;

  constructor(message: string, exitCode: ExitCode, options?: ErrorOptions) {
    super(message);
    this.name = 'RoundtableError';
    this.exitCode = exitCode;
    this.hint = options?.hint;
    this.cause = options?.cause;
  }
}

export class ConfigError extends RoundtableError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, ExitCode.CONFIG_ERROR, options);
    this.name = 'ConfigError';
  }
}

export type AdapterErrorKind = "not_installed" | "timeout" | "auth" | "api" | "unknown";

export class AdapterError extends RoundtableError {
  public readonly adapter: string;
  public readonly kind: AdapterErrorKind;

  constructor(adapter: string, message: string, options?: ErrorOptions & { kind?: AdapterErrorKind }) {
    super(message, ExitCode.ADAPTER_ERROR, options);
    this.name = 'AdapterError';
    this.adapter = adapter;
    this.kind = options?.kind ?? "unknown";
  }
}

export class SessionError extends RoundtableError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, ExitCode.SESSION_ERROR, options);
    this.name = 'SessionError';
  }
}

export class FileWriteError extends RoundtableError {
  public readonly filePath: string;

  constructor(filePath: string, message: string, options?: ErrorOptions) {
    super(message, ExitCode.FILE_WRITE_ERROR, options);
    this.name = 'FileWriteError';
    this.filePath = filePath;
  }
}

export class ConsensusError extends RoundtableError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, ExitCode.CONSENSUS_ERROR, options);
    this.name = 'ConsensusError';
  }
}

export class ValidationError extends RoundtableError {
  public readonly reports: import("../types.js").ValidationReport[];

  constructor(reports: import("../types.js").ValidationReport[], options?: ErrorOptions) {
    const failedFiles = reports.filter(r => !r.passed).map(r => r.path);
    super(
      `Validation failed for ${failedFiles.length} file(s): ${failedFiles.join(", ")}`,
      ExitCode.VALIDATION_ERROR,
      { ...options, hint: "Fix the issues above or re-run the knight with a different prompt." }
    );
    this.name = 'ValidationError';
    this.reports = reports;
  }
}

/**
 * Classify an unknown error into a RoundtableError.
 * Used by adapters to wrap raw errors with proper types.
 */
export function classifyError(error: unknown, adapter: string): AdapterError {
  if (error instanceof AdapterError) {
    return error;
  }

  const msg = error instanceof Error ? error.message : String(error);
  const lower = msg.toLowerCase();
  const cause = error instanceof Error ? error : undefined;

  if (lower.includes('enoent') || lower.includes('not found') || lower.includes('not recognized') || lower.includes('command not found')) {
    return new AdapterError(adapter, `${adapter} CLI not found: ${msg}`, {
      cause, kind: "not_installed",
      hint: `Is ${adapter} installed and available in your PATH?`,
    });
  }

  if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('etimedout')) {
    return new AdapterError(adapter, `${adapter} timed out: ${msg}`, {
      cause, kind: "timeout",
      hint: `Try increasing timeout_per_turn_seconds in .roundtable/config.json`,
    });
  }

  if (lower.includes('api key') || lower.includes('apikey') || lower.includes('unauthorized') || lower.includes('401') || lower.includes('403')) {
    return new AdapterError(adapter, `${adapter} authentication failed: ${msg}`, {
      cause, kind: "auth",
      hint: `Check your API key or subscription for ${adapter}.`,
    });
  }

  if (lower.includes('api error') || lower.includes('rate limit') || lower.includes('429') || lower.includes('too many requests') || lower.includes('500') || lower.includes('502') || lower.includes('503')) {
    return new AdapterError(adapter, `${adapter} API error: ${msg}`, {
      cause, kind: "api",
      hint: `Wait a moment and try again, or check your ${adapter} usage limits.`,
    });
  }

  return new AdapterError(adapter, `${adapter} error: ${msg}`, {
    cause, kind: "unknown",
  });
}

/**
 * Format a RoundtableError for CLI display.
 */
export function formatError(error: RoundtableError): string {
  let output = `\n❌ ${error.name}: ${error.message}`;
  if (error.hint) {
    output += `\n💡 Hint: ${error.hint}`;
  }
  if (error.cause) {
    output += `\n🔍 Caused by: ${error.cause.message}`;
  }
  return output;
}

/**
 * Get the exit code for any error. RoundtableErrors have their own,
 * everything else gets UNKNOWN (99).
 */
export function getExitCode(error: unknown): ExitCode {
  if (error instanceof RoundtableError) {
    return error.exitCode;
  }
  return ExitCode.UNKNOWN;
}
