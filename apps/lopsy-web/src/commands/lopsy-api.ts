import {
  CommandError,
  StepFailure,
  describeThrown,
  type CommandErrorCode,
  type CommandSurface,
} from './command';
import type { CommandDescription, RunOptions } from './registry';

/**
 * The codes `lopsy.run` can answer with: a command's own (it refused), or
 * 'internal' when something that is not a CommandError was thrown (a bug in
 * the editor), after which the step may or may not have been applied.
 */
export type LopsyErrorCode = CommandErrorCode | 'internal';

export const LOPSY_ERROR_CODES: readonly LopsyErrorCode[] = ['invalid', 'refused', 'not-found', 'unavailable', 'unsettled', 'internal'];

/** What `lopsy.run` reports when a call fails: a CommandError's JSON, or an InternalError for a bug. */
export interface LopsyError {
  readonly name: 'CommandError' | 'InternalError';
  readonly code: LopsyErrorCode;
  readonly message: string;
  /** With 'unsettled': what the command returned, since its work was done. */
  readonly result?: unknown;
  /** For a list of invocations: the results of the steps before the one that failed. */
  readonly completed?: readonly unknown[];
  /** For a list of invocations: the position of the one that failed. */
  readonly index?: number;
}

export type LopsyOutcome =
  | { readonly ok: true; readonly result: unknown }
  | { readonly ok: true; readonly results: unknown[] }
  | { readonly ok: false; readonly error: LopsyError };

/** `window.lopsy`: the command API that agents call. */
export interface LopsyApi {
  /** The document commands: id, summary and params of each, as JSON. */
  describe(): CommandDescription[];
  /**
   * Runs one invocation (`{ op, ...params }`) or a list of them in order,
   * stopping at the first failure. Always resolves to an outcome, since a
   * thrown error loses its fields crossing to the caller; a bug comes back
   * as code 'internal' and is logged with console.error.
   */
  run(invocation: unknown): Promise<LopsyOutcome>;
  /**
   * Leaves a note in the guestbook, for an agent to say hello: `run` with
   * `{ op: 'guestbook.sign', note }`, so the outcome is that command's.
   */
  guestbook(note: unknown): Promise<LopsyOutcome>;
}

/** The registry functions the API is built on. */
export interface LopsyApiSource {
  describe(surface?: CommandSurface): CommandDescription[];
  runInvocation(invocation: unknown, options?: RunOptions): Promise<unknown>;
  runAll(invocations: readonly unknown[], options?: RunOptions): Promise<unknown[]>;
}

/** What the API needs to know about the page it runs on. */
export interface LopsyEnvironment {
  /** The check the page uses to show its WebGL2 warning: without WebGL2 no engine ever starts. */
  hasWebGL2(): boolean;
}

declare global {
  interface Window {
    /** The command API, set by the editor's entry in every build, production included. */
    lopsy?: LopsyApi;
  }
}

/** The command `lopsy.guestbook(note)` runs (src/commands/guestbook/guestbook.ts). */
export const GUESTBOOK_OP = 'guestbook.sign';

const SURFACE = 'document' satisfies CommandSurface;
const DOCUMENT_ONLY: RunOptions = { surface: SURFACE };

export const NO_WEBGL2_MESSAGE =
  'This browser has no WebGL2, which the editor needs to draw, so no command can run. Use a browser with a real GPU, or start Chromium with software WebGL (SwiftShader): --use-gl=angle --use-angle=swiftshader --enable-webgl --ignore-gpu-blocklist.';

function commandFailure(error: CommandError, isBatch: boolean): LopsyOutcome {
  const json = error.toJSON();
  if (!isBatch || error.completed === undefined) return { ok: false, error: json };
  // runAll stops at the failing step, so the steps before it are the ones that completed.
  return { ok: false, error: { ...json, index: error.completed.length } };
}

function internalFailure(error: unknown): LopsyOutcome {
  // Kept visible: a watching developer and the e2e console guard see the original with its stack.
  console.error(error instanceof StepFailure ? error.cause : error);
  const batch = error instanceof StepFailure ? { index: error.index, completed: error.completed } : {};
  const message = error instanceof StepFailure ? error.message : describeThrown(error);
  return { ok: false, error: { name: 'InternalError', code: 'internal', message, ...batch } };
}

function failure(error: unknown, isBatch: boolean): LopsyOutcome {
  if (error instanceof CommandError) return commandFailure(error, isBatch);
  return internalFailure(error);
}

function unavailable(isBatch: boolean): LopsyOutcome {
  const batch = isBatch ? { index: 0, completed: [] } : {};
  return { ok: false, error: { name: 'CommandError', code: 'unavailable', message: NO_WEBGL2_MESSAGE, ...batch } };
}

export function createLopsyApi(source: LopsyApiSource, environment: LopsyEnvironment): LopsyApi {
  async function run(invocation: unknown): Promise<LopsyOutcome> {
    const isBatch = Array.isArray(invocation);
    if (!environment.hasWebGL2()) return unavailable(isBatch);
    try {
      if (isBatch) return { ok: true, results: await source.runAll(invocation, DOCUMENT_ONLY) };
      return { ok: true, result: await source.runInvocation(invocation, DOCUMENT_ONLY) };
    } catch (error) {
      return failure(error, isBatch);
    }
  }
  return Object.freeze({
    describe: () => source.describe(SURFACE),
    run,
    guestbook: (note: unknown) => run({ op: GUESTBOOK_OP, note }),
  });
}
