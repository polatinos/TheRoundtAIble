import type { ConsensusBlock } from "../types.js";
import { parseConsensusFromResponse } from "../consensus.js";
import { AdapterError, classifyError } from "../utils/errors.js";
import type { AdapterErrorKind } from "../utils/errors.js";

// Re-export for backward compatibility (orchestrator imports from here)
export { AdapterError, classifyError };
export type { AdapterErrorKind };

export abstract class BaseAdapter {
  abstract readonly name: string;

  abstract execute(prompt: string, timeoutMs?: number): Promise<string>;

  abstract isAvailable(): Promise<boolean>;

  parseConsensus(response: string, round: number): ConsensusBlock | null {
    return parseConsensusFromResponse(response, this.name, round);
  }
}
