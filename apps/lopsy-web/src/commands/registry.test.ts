import { describe, expect, expectTypeOf, it } from 'vitest';
import { CommandError, SettleTimeoutError, isCommandError, type Command } from './command';
import { createRegistry, suggestIds } from './registry';

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function deferred(): Deferred {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function flush(): Promise<void> {
  return new Promise((done) => setTimeout(done, 0));
}

async function rejection(promise: Promise<unknown>): Promise<CommandError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CommandError);
    return error as CommandError;
  }
  throw new Error('expected a rejection');
}

function noop(id: string): Command<unknown, undefined> {
  return { id, summary: 'Does nothing.', surface: 'document', params: {}, run: () => undefined };
}

describe('define', () => {
  it('returns the command and makes it gettable', () => {
    const registry = createRegistry();
    const command = registry.define(noop('layer.add'));
    expect(registry.get('layer.add')).toBe(command);
    expect(registry.has('layer.add')).toBe(true);
    expect(registry.has('layer.remove')).toBe(false);
  });

  it('throws a plain Error on duplicate or malformed ids', () => {
    const registry = createRegistry();
    registry.define(noop('layer.add'));
    expect(() => registry.define(noop('layer.add'))).toThrowError(/already defined/);
    expect(() => registry.define(noop('LayerAdd'))).toThrowError(/Malformed command id/);
    try {
      registry.define(noop('layer'));
    } catch (error) {
      expect(error).not.toBeInstanceOf(CommandError);
    }
  });

  it('rejects a param named op and a bad default', () => {
    const registry = createRegistry();
    const base = { summary: 's', surface: 'document', run: () => undefined } as const;
    expect(() =>
      registry.define({ ...base, id: 'a.b', params: { op: { type: 'string' } } }),
    ).toThrowError(/reserved/);
    expect(() =>
      registry.define({ ...base, id: 'a.c', params: { n: { type: 'number', min: 1, default: 0 } } }),
    ).toThrowError(/n \(default\)/);
  });

  it('infers run params from the schema', () => {
    const registry = createRegistry();
    const command = registry.define({
      id: 'layer.set',
      summary: 'Sets layer properties.',
      surface: 'document',
      params: {
        opacity: { type: 'number', min: 0, max: 1 },
        mode: { type: 'string', enum: ['normal', 'screen'], default: 'normal' },
        name: { type: 'string', optional: true },
      },
      run(params) {
        expectTypeOf(params).toEqualTypeOf<{
          opacity: number;
          mode: 'normal' | 'screen';
          name?: string;
        }>();
        return params.opacity;
      },
    });
    expectTypeOf(command.run).returns.toEqualTypeOf<number | Promise<number>>();
  });
});

describe('run: synchronous start', () => {
  it('invokes a sync run before returning', async () => {
    const registry = createRegistry();
    const calls: string[] = [];
    registry.define({ ...noop('layer.add'), run: () => void calls.push('ran') });
    const pending = registry.run('layer.add');
    expect(calls).toEqual(['ran']);
    await pending;
  });

  it('invokes an async run up to its first await before returning', async () => {
    const registry = createRegistry();
    const calls: string[] = [];
    registry.define({
      ...noop('edit.undo'),
      async run() {
        calls.push('before');
        await flush();
        calls.push('after');
      },
    });
    const pending = registry.run('edit.undo');
    expect(calls).toEqual(['before']);
    await pending;
    expect(calls).toEqual(['before', 'after']);
  });

  it('resolves with the command result', async () => {
    const registry = createRegistry();
    registry.define({ ...noop('layer.add'), run: () => 'layer-7' });
    await expect(registry.run('layer.add')).resolves.toBe('layer-7');
  });
});

describe('run: errors', () => {
  it('turns validation failures into rejections, not throws', async () => {
    const registry = createRegistry();
    const run = (): string => 'x';
    registry.define({ ...noop('a.b'), params: { n: { type: 'number' } }, run });
    let pending: Promise<unknown> | undefined;
    expect(() => {
      pending = registry.run('a.b', { n: 'x' });
    }).not.toThrow();
    const error = await rejection(pending ?? Promise.resolve());
    expect(error.code).toBe('invalid');
    expect(error.message).toBe('a.b: n must be a finite number, got "x"');
  });

  it('turns a CommandError thrown by run into a rejection', async () => {
    const registry = createRegistry();
    registry.define({
      ...noop('layer.delete'),
      run: () => {
        throw new CommandError('refused', 'Layer is locked', { notice: 'info' });
      },
    });
    const error = await rejection(registry.run('layer.delete'));
    expect(error.code).toBe('refused');
    expect(error.notice).toBe('info');
  });

  it('passes a non-CommandError through unchanged', async () => {
    const registry = createRegistry();
    const bug = new TypeError('cannot read x of undefined');
    registry.define({
      ...noop('layer.delete'),
      run: () => {
        throw bug;
      },
    });
    await expect(registry.run('layer.delete')).rejects.toBe(bug);
  });

  it('rejects unknown ids with nearest suggestions', async () => {
    const registry = createRegistry();
    for (const id of ['layer.add', 'layer.delete', 'layer.set', 'filter.blur', 'view.zoom-in']) {
      registry.define(noop(id));
    }
    const error = await rejection(registry.run('layer.ad'));
    expect(error.code).toBe('not-found');
    expect(error.message).toBe(
      'Unknown command "layer.ad". Did you mean: layer.add, layer.set, layer.delete? Call describe() for the full list.',
    );
    const typo = await rejection(registry.run('filtr.blur'));
    expect(typo.message).toContain('Did you mean: filter.blur?');
    const nothing = await rejection(registry.run('zzzzzz.qqqqqq'));
    expect(nothing.message).toBe('Unknown command "zzzzzz.qqqqqq". Call describe() for the full list.');
  });
});

describe('start', () => {
  it('runs in the caller\'s tick and resolves as run does', async () => {
    const registry = createRegistry();
    const calls: string[] = [];
    registry.define({ ...noop('layer.add'), run: () => (calls.push('ran'), 'layer-7') });
    const pending = registry.start('layer.add');
    expect(calls).toEqual(['ran']);
    await expect(pending).resolves.toBe('layer-7');
  });

  it('throws what fails before run returns instead of rejecting', () => {
    const registry = createRegistry();
    const bug = new TypeError('broken');
    registry.define({ ...noop('a.b'), params: { n: { type: 'number' } }, run: () => { throw bug; } });
    expect(() => registry.start('a.b', { n: 'x' })).toThrow(CommandError);
    expect(() => registry.start('a.c')).toThrow(/Unknown command/);
    expect(() => registry.start('a.b', { n: 1 })).toThrow(bug);
  });

  it('rejects what fails after an await', async () => {
    const registry = createRegistry();
    const late = new Error('late');
    registry.define({ ...noop('a.b'), run: () => Promise.reject(late) });
    await expect(registry.start('a.b')).rejects.toBe(late);
  });
});

describe('suggestIds', () => {
  it('returns at most five, related ids first', () => {
    const ids = ['layer.a', 'layer.b', 'layer.c', 'layer.d', 'layer.e', 'layer.f', 'layen.a'];
    const suggestions = suggestIds('layer.a', ids);
    expect(suggestions).toHaveLength(5);
    expect(suggestions[0]).toBe('layer.a');
    expect(suggestions).not.toContain('layen.a');
  });
});

describe('run: settle', () => {
  it('awaits settle after the result and before resolving', async () => {
    const registry = createRegistry();
    const events: string[] = [];
    const work = deferred();
    const settled = deferred();
    registry.setSettle(async () => {
      events.push('settle');
      await settled.promise;
    });
    registry.define({
      ...noop('filter.blur'),
      async run() {
        await work.promise;
        events.push('result');
        return 'done';
      },
    });
    const pending = registry.run('filter.blur').then((value) => events.push(`resolved ${String(value)}`));
    await flush();
    expect(events).toEqual([]);
    work.resolve();
    await flush();
    expect(events).toEqual(['result', 'settle']);
    settled.resolve();
    await pending;
    expect(events).toEqual(['result', 'settle', 'resolved done']);
  });

  it('skips settle when settles is false', async () => {
    const registry = createRegistry();
    let settleCount = 0;
    registry.setSettle(async () => {
      settleCount++;
    });
    registry.define({ ...noop('view.zoom-in'), settles: false });
    registry.define(noop('layer.add'));
    await registry.run('view.zoom-in');
    expect(settleCount).toBe(0);
    await registry.run('layer.add');
    expect(settleCount).toBe(1);
  });

  it('start with settle false resolves with the result and never calls settle', async () => {
    const registry = createRegistry();
    let settleCount = 0;
    registry.setSettle(async () => {
      settleCount++;
    });
    registry.define({ ...noop('layer.add'), run: () => 'added' });
    await expect(registry.start('layer.add', {}, { settle: false })).resolves.toBe('added');
    expect(settleCount).toBe(0);
    await registry.start('layer.add');
    expect(settleCount).toBe(1);
  });

  it('rejects unsettled, carrying the result, when the settle after the work times out', async () => {
    const registry = createRegistry();
    registry.setSettle(() => Promise.reject(new SettleTimeoutError(10_000, 'the engine to go idle', 'The page is a background tab.')));
    registry.define({ ...noop('layer.add'), run: () => ({ id: 'layer-7' }) });
    const error = await rejection(registry.run('layer.add'));
    expect(error.code).toBe('unsettled');
    expect(error.result).toEqual({ id: 'layer-7' });
    expect(error.message).toContain('the change was applied');
    expect(error.message).toContain('after 10 s');
    expect(error.message).toContain('background tab');
    expect(error.message).toContain('Do not run layer.add again');
    expect(JSON.parse(JSON.stringify(error))).toMatchObject({ code: 'unsettled', result: { id: 'layer-7' } });
  });

  it('passes a settle failure that is not a timeout through unchanged', async () => {
    const registry = createRegistry();
    const lost = new CommandError('unavailable', 'The graphics context is lost');
    registry.setSettle(() => Promise.reject(lost));
    registry.define(noop('layer.add'));
    expect(await rejection(registry.run('layer.add'))).toBe(lost);
  });

  it('does not settle when the command fails', async () => {
    const registry = createRegistry();
    let settleCount = 0;
    registry.setSettle(async () => {
      settleCount++;
    });
    registry.define({
      ...noop('layer.add'),
      run: () => Promise.reject(new CommandError('unavailable', 'No document')),
    });
    await rejection(registry.run('layer.add'));
    expect(settleCount).toBe(0);
  });
});

describe('run: preflight', () => {
  function preflighted(refuse: boolean): { registry: ReturnType<typeof createRegistry>; ran: string[]; checks: number[] } {
    const registry = createRegistry();
    const ran: string[] = [];
    const checks = [0];
    registry.setPreflight(() => {
      checks[0] = (checks[0] ?? 0) + 1;
      if (refuse) throw new CommandError('unavailable', 'The graphics context is lost');
    });
    registry.define({ ...noop('layer.add'), params: { n: { type: 'number', optional: true } }, run: () => { ran.push('ran'); } });
    return { registry, ran, checks };
  }

  it('refuses run, runInvocation and runAll before the command runs', async () => {
    const { registry, ran } = preflighted(true);
    expect((await rejection(registry.run('layer.add'))).code).toBe('unavailable');
    expect((await rejection(registry.runInvocation({ op: 'layer.add' }))).code).toBe('unavailable');
    expect((await rejection(registry.runAll([{ op: 'layer.add' }]))).message).toBe('[0] layer.add: The graphics context is lost');
    expect(ran).toEqual([]);
  });

  it('reports invalid params before the preflight', async () => {
    const { registry, checks } = preflighted(true);
    expect((await rejection(registry.run('layer.add', { n: 'x' }))).code).toBe('invalid');
    expect(checks[0]).toBe(0);
  });

  it('is not consulted by start, the UI path', async () => {
    const { registry, ran, checks } = preflighted(true);
    await registry.start('layer.add', {}, { settle: false });
    await registry.start('layer.add');
    expect(ran).toEqual(['ran', 'ran']);
    expect(checks[0]).toBe(0);
  });

  it('checks nothing when none is installed', async () => {
    const registry = createRegistry();
    registry.define(noop('layer.add'));
    await expect(registry.run('layer.add')).resolves.toBeUndefined();
  });
});

describe("run: settles 'before'", () => {
  it('awaits settle before run starts and does not settle again', async () => {
    const registry = createRegistry();
    const events: string[] = [];
    const settled = deferred();
    registry.setSettle(async () => {
      events.push('settle');
      await settled.promise;
    });
    registry.define({
      ...noop('view.render'),
      settles: 'before',
      run() {
        events.push('run');
        return 'pixels';
      },
    });
    const pending = registry.run('view.render').then((value) => events.push(`resolved ${String(value)}`));
    expect(events).toEqual(['settle']);
    await flush();
    expect(events).toEqual(['settle']);
    settled.resolve();
    await pending;
    expect(events).toEqual(['settle', 'run', 'resolved pixels']);
  });

  it('rejects invalid params without awaiting settle', async () => {
    const registry = createRegistry();
    let settleCount = 0;
    registry.setSettle(() => {
      settleCount++;
      return new Promise<void>(() => undefined);
    });
    registry.define({
      ...noop('view.sample'),
      settles: 'before',
      params: { x: { type: 'number' } },
    });
    const error = await rejection(registry.run('view.sample', { x: 'left' }));
    expect(error.code).toBe('invalid');
    expect(settleCount).toBe(0);
  });

  it('runs check on the params before settling, and rejects at once when it throws', async () => {
    const registry = createRegistry();
    const events: string[] = [];
    registry.setSettle(async () => {
      events.push('settle');
    });
    registry.define({
      ...noop('view.sample'),
      settles: 'before',
      params: { x: { type: 'number' } },
      check({ x }) {
        events.push(`check ${x}`);
        if (x < 0) throw new CommandError('unavailable', 'No document is open');
      },
      run: () => {
        events.push('run');
      },
    });
    await registry.run('view.sample', { x: 1 });
    expect(events).toEqual(['check 1', 'settle', 'run']);
    events.length = 0;
    const error = await rejection(registry.run('view.sample', { x: -1 }));
    expect(error.message).toBe('No document is open');
    expect(events).toEqual(['check -1']);
  });

  it('rejects with what run throws after settle', async () => {
    const registry = createRegistry();
    const events: string[] = [];
    registry.setSettle(async () => {
      events.push('settle');
    });
    registry.define({
      ...noop('view.render'),
      settles: 'before',
      run() {
        events.push('run');
        throw new CommandError('unavailable', 'No document');
      },
    });
    const error = await rejection(registry.run('view.render'));
    expect(error.message).toBe('No document');
    expect(events).toEqual(['settle', 'run']);
  });

  it('rejects when settle itself fails, without running', async () => {
    const registry = createRegistry();
    let hasRun = false;
    registry.setSettle(() => Promise.reject(new CommandError('unavailable', 'Timed out')));
    registry.define({
      ...noop('view.render'),
      settles: 'before',
      run() {
        hasRun = true;
      },
    });
    const error = await rejection(registry.run('view.render'));
    expect(error.message).toBe('Timed out');
    expect(hasRun).toBe(false);
  });
});

describe('runInvocation', () => {
  it('splits op from params', async () => {
    const registry = createRegistry();
    registry.define({
      ...noop('layer.set'),
      params: { opacity: { type: 'number' } },
      run: (params: { opacity: number }) => params.opacity,
    });
    await expect(registry.runInvocation({ op: 'layer.set', opacity: 0.5 })).resolves.toBe(0.5);
  });

  it('rejects a missing or non-string op as invalid', async () => {
    const registry = createRegistry();
    expect((await rejection(registry.runInvocation({ opacity: 1 }))).code).toBe('invalid');
    expect((await rejection(registry.runInvocation({ op: 3 }))).code).toBe('invalid');
    expect((await rejection(registry.runInvocation('layer.add'))).code).toBe('invalid');
  });
});

describe('runAll', () => {
  function sequenceRegistry(events: string[]): ReturnType<typeof createRegistry> {
    const registry = createRegistry();
    registry.setSettle(async () => {
      events.push('settle');
    });
    registry.define({
      ...noop('step.slow'),
      params: { name: { type: 'string' } },
      async run({ name }: { name: string }) {
        events.push(`start ${name}`);
        await flush();
        events.push(`end ${name}`);
        return name;
      },
    });
    registry.define({
      ...noop('step.fail'),
      run: () => {
        throw new CommandError('refused', 'Nothing selected', { notice: 'info' });
      },
    });
    return registry;
  }

  it('runs in order, each settled before the next starts', async () => {
    const events: string[] = [];
    const registry = sequenceRegistry(events);
    const results = await registry.runAll([
      { op: 'step.slow', name: 'a' },
      { op: 'step.slow', name: 'b' },
    ]);
    expect(results).toEqual(['a', 'b']);
    expect(events).toEqual(['start a', 'end a', 'settle', 'start b', 'end b', 'settle']);
  });

  it('starts the first invocation synchronously', () => {
    const events: string[] = [];
    const registry = sequenceRegistry(events);
    const pending = registry.runAll([{ op: 'step.slow', name: 'a' }]);
    expect(events).toEqual(['start a']);
    return pending;
  });

  it('stops at the first failure and prefixes index and op', async () => {
    const events: string[] = [];
    const registry = sequenceRegistry(events);
    const error = await rejection(
      registry.runAll([
        { op: 'step.slow', name: 'a' },
        { op: 'step.fail' },
        { op: 'step.slow', name: 'c' },
      ]),
    );
    expect(error.message).toBe('[1] step.fail: Nothing selected');
    expect(error.code).toBe('refused');
    expect(error.notice).toBe('info');
    expect(error.completed).toEqual(['a']);
    expect(JSON.parse(JSON.stringify(error))).toMatchObject({ completed: ['a'] });
    expect(events).not.toContain('start c');
  });

  it('keeps an unsettled step\'s result and the completed steps before it', async () => {
    const registry = sequenceRegistry([]);
    let calls = 0;
    registry.setSettle(() => {
      calls++;
      return calls === 2 ? Promise.reject(new SettleTimeoutError(10_000, 'the engine to go idle', '')) : Promise.resolve();
    });
    const error = await rejection(registry.runAll([
      { op: 'step.slow', name: 'a' },
      { op: 'step.slow', name: 'b' },
    ]));
    expect(error.code).toBe('unsettled');
    expect(error.message).toMatch(/^\[1\] step\.slow: /);
    expect(error.result).toBe('b');
    expect(error.completed).toEqual(['a']);
  });

  it('does not repeat an op already named by a validation message', async () => {
    const registry = sequenceRegistry([]);
    const error = await rejection(registry.runAll([{ op: 'step.slow', name: 1 }]));
    expect(error.message).toBe('[0] step.slow: name must be a string, got 1');
  });

  it('labels an invocation without an op', async () => {
    const registry = sequenceRegistry([]);
    const error = await rejection(registry.runAll([{ name: 'a' }]));
    expect(error.message).toMatch(/^\[0\] \(invalid\): An invocation needs a string "op"/);
  });
});

describe('list and describe', () => {
  function populated(): ReturnType<typeof createRegistry> {
    const registry = createRegistry();
    registry.define({ ...noop('view.grid'), surface: 'ui', checked: () => true });
    registry.define({
      ...noop('layer.set'),
      params: { opacity: { type: 'number', min: 0, max: 1, description: 'From 0 to 1' } },
      enabled: () => false,
    });
    registry.define(noop('canvas.resize'));
    return registry;
  }

  it('lists sorted commands, filtered by surface, exposing enabled and checked', () => {
    const registry = populated();
    expect(registry.list().map((command) => command.id)).toEqual(['canvas.resize', 'layer.set', 'view.grid']);
    const ui = registry.list('ui');
    expect(ui.map((command) => command.id)).toEqual(['view.grid']);
    expect(ui[0]?.checked?.({})).toBe(true);
    expect(registry.get('layer.set')?.enabled?.({})).toBe(false);
  });

  it('describes sorted, JSON round-trippable entries', () => {
    const registry = populated();
    const description = registry.describe('document');
    expect(JSON.parse(JSON.stringify(description))).toEqual(description);
    expect(description).toEqual([
      { id: 'canvas.resize', summary: 'Does nothing.', surface: 'document', params: {} },
      {
        id: 'layer.set',
        summary: 'Does nothing.',
        surface: 'document',
        params: { opacity: { type: 'number', min: 0, max: 1, description: 'From 0 to 1' } },
      },
    ]);
    expect(registry.describe()).toHaveLength(3);
  });
});

describe('errors across a serialisation boundary', () => {
  it('survives JSON round-trip as a recognisable CommandError', async () => {
    const registry = createRegistry();
    const error = await rejection(registry.run('missing.command'));
    const roundTripped: unknown = JSON.parse(JSON.stringify(error));
    expect(isCommandError(roundTripped)).toBe(true);
    expect(roundTripped).toMatchObject({ code: 'not-found' });
  });
});
