import {
  CommandError,
  isValidCommandId,
  type Command,
  type CommandMeta,
  type CommandSurface,
} from './command';
import {
  checkSchema,
  describeParams,
  validateParams,
  type InferParams,
  type ParamDescription,
  type ParamSchema,
} from './params';

export interface CommandDefinition<S extends ParamSchema, R> extends CommandMeta {
  readonly params: S;
  /** Same contract as Command.run: do the work before the first await. */
  run(params: InferParams<S>): R | Promise<R>;
  /** Same contract as Command.enabled. */
  enabled?(params: InferParams<S>): boolean;
  /** Same contract as Command.checked. */
  checked?(params: InferParams<S>): boolean;
  /** Same contract as Command.check. */
  check?(params: InferParams<S>): void;
}

export interface Invocation {
  readonly op: string;
  readonly [param: string]: unknown;
}

export interface CommandDescription {
  id: string;
  summary: string;
  surface: CommandSurface;
  params: Record<string, ParamDescription>;
}

export type SettleFn = () => Promise<void>;

export interface Registry {
  define<const S extends ParamSchema, R>(command: CommandDefinition<S, R>): Command<InferParams<S>, R>;
  get(id: string): Command | undefined;
  has(id: string): boolean;
  list(surface?: CommandSurface): Command[];
  describe(surface?: CommandSurface): CommandDescription[];
  run(id: string, params?: unknown): Promise<unknown>;
  /**
   * As run, but what fails before `run` returns (an unknown id, invalid
   * params, a refusal or a bug in its synchronous part) is thrown in the
   * caller's tick instead of rejecting, as a menu action's own throw was.
   */
  start(id: string, params?: unknown): Promise<unknown>;
  runInvocation(invocation: unknown): Promise<unknown>;
  runAll(invocations: readonly unknown[]): Promise<unknown[]>;
  setSettle(settle: SettleFn): void;
}

const MAX_SUGGESTIONS = 5;

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitution = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, substitution);
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

function namespaceOf(id: string): string {
  return id.split('.')[0] ?? id;
}

export function suggestIds(query: string, ids: readonly string[]): string[] {
  const threshold = Math.max(2, Math.floor(query.length / 3));
  const scored = ids.map((id) => {
    const isRelated =
      id.startsWith(query) || query.startsWith(id) || namespaceOf(id) === namespaceOf(query);
    return { id, isRelated, distance: editDistance(query, id) };
  });
  return scored
    .filter((entry) => entry.isRelated || entry.distance <= threshold)
    .sort(
      (a, b) =>
        Number(b.isRelated) - Number(a.isRelated) ||
        a.distance - b.distance ||
        a.id.localeCompare(b.id),
    )
    .slice(0, MAX_SUGGESTIONS)
    .map((entry) => entry.id);
}

function notFound(id: string, ids: readonly string[]): CommandError {
  const suggestions = suggestIds(id, ids);
  const hint = suggestions.length > 0 ? ` Did you mean: ${suggestions.join(', ')}?` : '';
  return new CommandError(
    'not-found',
    `Unknown command ${JSON.stringify(id)}.${hint} Call describe() for the full list.`,
  );
}

function assertDefinable(command: CommandMeta & { params: ParamSchema }, isTaken: boolean): void {
  if (!isValidCommandId(command.id)) {
    throw new Error(`Malformed command id ${JSON.stringify(command.id)}: expected dotted lowercase like "layer.add"`);
  }
  if (isTaken) throw new Error(`Command ${JSON.stringify(command.id)} is already defined`);
  // runInvocation spreads params beside `op`, so a param of that name could never be passed.
  if ('op' in command.params) throw new Error(`Command ${command.id}: "op" is reserved and cannot be a param`);
  checkSchema(command.id, command.params);
}

function splitInvocation(invocation: unknown): { op: string; params: Record<string, unknown> } {
  if (typeof invocation !== 'object' || invocation === null || Array.isArray(invocation)) {
    throw new CommandError('invalid', 'An invocation must be an object like { op: "layer.add", ...params }');
  }
  const { op, ...params } = invocation as Record<string, unknown>;
  if (typeof op !== 'string') {
    throw new CommandError('invalid', `An invocation needs a string "op" naming the command, got ${JSON.stringify(op) ?? 'undefined'}`);
  }
  return { op, params };
}

function withIndex(error: unknown, index: number, op: string | undefined): unknown {
  if (!(error instanceof CommandError)) return error;
  const label = op ?? '(invalid)';
  const message = error.message.startsWith(`${label}: `) ? error.message : `${label}: ${error.message}`;
  return new CommandError(error.code, `[${index}] ${message}`, { notice: error.notice });
}

function opOf(invocation: unknown): string | undefined {
  if (typeof invocation !== 'object' || invocation === null) return undefined;
  const { op } = invocation as { op?: unknown };
  return typeof op === 'string' ? op : undefined;
}

export function createRegistry(): Registry {
  const commands = new Map<string, Command>();
  let settle: SettleFn = () => Promise.resolve();

  const sorted = (surface?: CommandSurface): Command[] =>
    [...commands.values()]
      .filter((command) => surface === undefined || command.surface === surface)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  async function finish(command: Command, pending: unknown): Promise<unknown> {
    const result = await pending;
    if (command.settles !== false) await settle();
    return result;
  }

  async function settleThenRun(command: Command, params: unknown): Promise<unknown> {
    await settle();
    return command.run(params);
  }

  // Not async: command.run must start in the caller's tick, and what it throws there is thrown here.
  function start(id: string, rawParams?: unknown): Promise<unknown> {
    const command = commands.get(id);
    if (!command) throw notFound(String(id), [...commands.keys()]);
    const params = validateParams(id, command.params, rawParams);
    if (command.settles === 'before') {
      command.check?.(params);
      return settleThenRun(command, params);
    }
    return finish(command, command.run(params));
  }

  function run(id: string, rawParams?: unknown): Promise<unknown> {
    try {
      return start(id, rawParams);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  function runInvocation(invocation: unknown): Promise<unknown> {
    try {
      const { op, params } = splitInvocation(invocation);
      return run(op, params);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  async function runAll(invocations: readonly unknown[]): Promise<unknown[]> {
    if (!Array.isArray(invocations)) {
      throw new CommandError('invalid', 'runAll expects an array of invocations');
    }
    const results: unknown[] = [];
    for (const [index, invocation] of invocations.entries()) {
      try {
        results.push(await runInvocation(invocation));
      } catch (error) {
        throw withIndex(error, index, opOf(invocation));
      }
    }
    return results;
  }

  return {
    define(command) {
      assertDefinable(command, commands.has(command.id));
      commands.set(command.id, command);
      return command;
    },
    get: (id) => commands.get(id),
    has: (id) => commands.has(id),
    list: sorted,
    describe: (surface) =>
      sorted(surface).map((command) => ({
        id: command.id,
        summary: command.summary,
        surface: command.surface,
        params: describeParams(command.params),
      })),
    run,
    start,
    runInvocation,
    runAll,
    setSettle(next) {
      settle = next;
    },
  };
}

const defaultRegistry = createRegistry();

export const defineCommand = defaultRegistry.define;
export const getCommand = defaultRegistry.get;
export const runCommand = defaultRegistry.run;
export const startCommand = defaultRegistry.start;
export const runInvocation = defaultRegistry.runInvocation;
export const runInvocations = defaultRegistry.runAll;
export const describeCommands = defaultRegistry.describe;
export const setSettle = defaultRegistry.setSettle;
