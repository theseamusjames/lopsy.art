import { CommandError, type CommandErrorJSON, type CommandSurface } from '../commands/command';
import type { CommandDescription, RunOptions } from '../commands/registry';

/** What `lopsy.run` reports when a command refuses: the error's own JSON. */
export interface LopsyError extends CommandErrorJSON {
  /** For a list of invocations: the position of the one that failed. */
  readonly index?: number;
}

export type LopsyOutcome =
  | { readonly ok: true; readonly result: unknown }
  | { readonly ok: true; readonly results: unknown[] }
  | { readonly ok: false; readonly error: LopsyError };

/** `window.lopsy` on the agent page. */
export interface LopsyApi {
  /** The document commands: id, summary and params of each, as JSON. */
  describe(): CommandDescription[];
  /**
   * Runs one invocation (`{ op, ...params }`) or a list of them in order,
   * stopping at the first failure. Resolves to an outcome for every
   * refusal, since a thrown error loses its fields crossing to the caller;
   * rejects only for a bug.
   */
  run(invocation: unknown): Promise<LopsyOutcome>;
}

/** The registry functions the API is built on. */
export interface LopsyApiSource {
  describe(surface?: CommandSurface): CommandDescription[];
  runInvocation(invocation: unknown, options?: RunOptions): Promise<unknown>;
  runAll(invocations: readonly unknown[], options?: RunOptions): Promise<unknown[]>;
}

const SURFACE = 'document' satisfies CommandSurface;
const DOCUMENT_ONLY: RunOptions = { surface: SURFACE };

function failure(error: unknown, isBatch: boolean): LopsyOutcome {
  if (!(error instanceof CommandError)) throw error;
  const json = error.toJSON();
  if (!isBatch || error.completed === undefined) return { ok: false, error: json };
  // runAll stops at the failing step, so the steps before it are the ones that completed.
  return { ok: false, error: { ...json, index: error.completed.length } };
}

export function createLopsyApi(source: LopsyApiSource): LopsyApi {
  return Object.freeze({
    describe: () => source.describe(SURFACE),
    async run(invocation: unknown): Promise<LopsyOutcome> {
      const isBatch = Array.isArray(invocation);
      try {
        if (isBatch) return { ok: true, results: await source.runAll(invocation, DOCUMENT_ONLY) };
        return { ok: true, result: await source.runInvocation(invocation, DOCUMENT_ONLY) };
      } catch (error) {
        return failure(error, isBatch);
      }
    },
  });
}
