/**
 * Runs work against the storage so that a missing or refused sign-in is a
 * wait, not a failure: when the work is refused for sign-in ('auth'), the
 * gate is told Reconnect is wanted (the UI says so), and the work waits for
 * the next token, however it comes, then runs again. A token taken while
 * the work ran counts, so it never waits for one it already missed. The
 * signal ends the wait ('aborted'). Any other error is the work's own.
 */

import { isStorageError } from '../storage/errors';
import { AccountMismatchError } from './google-token-source';
import type { SignInGate } from './types';

export function isSignInRefusal(error: unknown): boolean {
  return isStorageError(error) && error.code === 'auth' && !(error instanceof AccountMismatchError);
}

export interface SignInWaitOptions {
  readonly signal?: AbortSignal;
  /** Told true when the work starts waiting for a token, false when the token came (or the wait was aborted). */
  readonly onWait?: (waiting: boolean) => void;
}

export async function withSignIn<T>(gate: SignInGate | null, run: () => Promise<T>, options: SignInWaitOptions = {}): Promise<T> {
  if (!gate) return run();
  for (;;) {
    const count = gate.tokenCount;
    try {
      return await run();
    } catch (error) {
      if (!isSignInRefusal(error) || options.signal?.aborted) throw error;
      if (gate.tokenCount === count) gate.markSignInNeeded();
      options.onWait?.(true);
      try {
        await gate.whenTokenAfter(count, options.signal);
      } finally {
        options.onWait?.(false);
      }
    }
  }
}
