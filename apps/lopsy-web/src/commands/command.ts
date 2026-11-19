import type { ParamSchema } from './params';

export type CommandErrorCode = 'invalid' | 'refused' | 'not-found' | 'unavailable';

export type CommandNotice = 'info' | 'error' | null;

export type CommandSurface = 'document' | 'ui';

export interface CommandErrorOptions {
  /** What the UI toasts for this refusal; null keeps it silent, as many refusals are today. */
  readonly notice?: CommandNotice;
}

export interface CommandErrorJSON {
  readonly name: 'CommandError';
  readonly code: CommandErrorCode;
  readonly message: string;
}

const ERROR_CODES: readonly CommandErrorCode[] = ['invalid', 'refused', 'not-found', 'unavailable'];

export class CommandError extends Error {
  readonly code: CommandErrorCode;
  readonly notice: CommandNotice;

  constructor(code: CommandErrorCode, message: string, options: CommandErrorOptions = {}) {
    super(message);
    this.name = 'CommandError';
    this.code = code;
    this.notice = options.notice ?? null;
  }

  /** Error properties are not enumerable, so without this the error arrives across page.evaluate as {}. */
  toJSON(): CommandErrorJSON {
    return { name: 'CommandError', code: this.code, message: this.message };
  }
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
