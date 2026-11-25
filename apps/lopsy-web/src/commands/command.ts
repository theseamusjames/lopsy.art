import type { ParamSchema } from './params';

export type CommandErrorCode = 'invalid' | 'refused' | 'not-found' | 'unavailable' | 'unsettled';

export type CommandNotice = 'info' | 'error' | null;

export type CommandSurface = 'document' | 'ui';

export interface CommandErrorOptions {
  /** What the UI toasts for this refusal; null keeps it silent, as many refusals are today. */
  readonly notice?: CommandNotice;
  /** With 'unsettled': what the command returned, since its work was done. */
  readonly result?: unknown;
  /** From runAll: the results of the steps that completed before this one failed. */
  readonly completed?: readonly unknown[];
}

export interface CommandErrorJSON {
  readonly name: 'CommandError';
  readonly code: CommandErrorCode;
  readonly message: string;
  readonly result?: unknown;
  readonly completed?: readonly unknown[];
}

const ERROR_CODES: readonly CommandErrorCode[] = ['invalid', 'refused', 'not-found', 'unavailable', 'unsettled'];

export class CommandError extends Error {
  readonly code: CommandErrorCode;
  readonly notice: CommandNotice;
  readonly result?: unknown;
  readonly completed?: readonly unknown[];

  constructor(code: CommandErrorCode, message: string, options: CommandErrorOptions = {}) {
    super(message);
    this.name = 'CommandError';
    this.code = code;
    this.notice = options.notice ?? null;
    if (options.result !== undefined) this.result = options.result;
    if (options.completed !== undefined) this.completed = options.completed;
  }

  /** Error properties are not enumerable, so without this the error arrives across page.evaluate as {}. */
  toJSON(): CommandErrorJSON {
    return {
      name: 'CommandError',
      code: this.code,
      message: this.message,
      ...(this.result === undefined ? {} : { result: this.result }),
      ...(this.completed === undefined ? {} : { completed: this.completed }),
    };
  }
}

/**
 * The settle wait timed out: `waitingFor` completes "waiting for ...", and
 * `hint` says why when that is known (a background tab). The registry turns
 * it into 'unsettled' when the command's own work already happened.
 */
export class SettleTimeoutError extends CommandError {
  readonly timeoutMs: number;
  readonly waitingFor: string;
  readonly hint: string;

  constructor(timeoutMs: number, waitingFor: string, hint: string) {
    super('unavailable', `Timed out after ${timeoutMs} ms waiting for ${waitingFor}.${hint ? ` ${hint}` : ''}`);
    this.timeoutMs = timeoutMs;
    this.waitingFor = waitingFor;
    this.hint = hint;
  }
}

/**
 * From runAll: a step threw something that is not a CommandError (a bug in a
 * command). Like runAll's CommandError it says which step failed and carries
 * the results of the steps before it; the original is its `cause`.
 */
export class StepFailure extends Error {
  readonly cause: unknown;
  readonly index: number;
  readonly completed: readonly unknown[];

  constructor(cause: unknown, index: number, label: string, completed: readonly unknown[]) {
    super(`[${index}] ${label}: ${describeThrown(cause)}`);
    this.name = 'StepFailure';
    this.cause = cause;
    this.index = index;
    this.completed = completed;
  }
}

/** "TypeError: message" for an Error, the value itself otherwise. */
export function describeThrown(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  return String(value);
}

export function isCommandErrorCode(value: unknown): value is CommandErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}

export function isCommandError(value: unknown): value is CommandError | CommandErrorJSON {
  if (value instanceof CommandError) return true;
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<Record<keyof CommandErrorJSON, unknown>>;
  return (
    candidate.name === 'CommandError' &&
    isCommandErrorCode(candidate.code) &&
    typeof candidate.message === 'string'
  );
}

export interface CommandMeta {
  /** Dotted and lowercase: 'layer.add', 'filter.gaussian-blur'. */
  readonly id: string;
  /** One sentence, shown to agents by describe. */
  readonly summary: string;
  readonly surface: CommandSurface;
  /**
   * When the registry waits for the engine. true (the default): after `run`, so
   * the work happens in the caller's tick. false: never. 'before': once, after
   * the params validate and before `run`, so `run` reads what earlier work
   * left; only for commands that only read and are never bound to a user
   * gesture, since `run` no longer starts in the caller's tick.
   */
  readonly settles?: CommandSettles;
}

export type CommandSettles = boolean | 'before';

export interface Command<P = unknown, R = unknown> extends CommandMeta {
  readonly params: ParamSchema;
  /**
   * Must do its work synchronously, before its first `await`. Menu actions such as
   * window.confirm, a file-input click, window.open and system-clipboard writes only
   * work inside the user's click, and keyboard undo must apply in the same tick as the key.
   */
  run(params: P): R | Promise<R>;
  /** Whether a menu item bound to these params can be chosen; read when the menu is built. */
  enabled?(params: P): boolean;
  /** Whether a menu item bound to these params shows a checkmark; read when the menu is built. */
  checked?(params: P): boolean;
  /**
   * With settles 'before': runs synchronously on the validated params before the
   * wait, so a call that cannot succeed (no document open, when the render loop
   * the wait needs never starts) rejects at once instead of timing out.
   */
  check?(params: P): void;
}

const COMMAND_ID_PATTERN = /^[a-z][a-z0-9]*(\.[a-z0-9]+(-[a-z0-9]+)*)+$/;

export function isValidCommandId(id: string): boolean {
  return COMMAND_ID_PATTERN.test(id);
}
