import { CommandError } from './command';
import { startCommand } from './registry';
import { announceRefusal } from './refusal';

/** The toast the UI shows for a refusal today, if any; a refusal with notice null stays silent. */
function announceCommandError(error: CommandError): void {
  announceRefusal({ reason: error.message, notice: error.notice });
}

function handleFailure(error: unknown): void {
  if (!(error instanceof CommandError)) throw error;
  announceCommandError(error);
}

/**
 * Starts a command for a menu item, a key or a button, in the caller's tick,
 * and returns what is left once it has finished: a promise that resolves, or
 * rejects with anything that is not a CommandError. A CommandError, whether
 * thrown before the command returns or rejected after (a settle that timed
 * out is one, with notice null), shows the toast its notice asks for and is
 * otherwise swallowed. Anything else is a bug: thrown synchronously, it
 * propagates to the caller, as a menu action's own throw did.
 */
export function startFromUi(id: string, params?: unknown): Promise<void> {
  let pending: Promise<unknown>;
  try {
    pending = startCommand(id, params);
  } catch (error) {
    handleFailure(error);
    return Promise.resolve();
  }
  return pending.then(() => undefined, handleFailure);
}

/**
 * Runs a command for the UI without waiting for it. A failure that is not a
 * CommandError stays an unhandled rejection, as a menu action's un-awaited
 * promise was, so the browser still reports it.
 */
export function invokeFromUi(id: string, params?: unknown): void {
  void startFromUi(id, params);
}
