import { describe, expect, expectTypeOf, it } from 'vitest';
import { CommandError, isCommandError, type Command } from './command';
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
    expect(events).not.toContain('start c');
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
    expect(ui[0]?.checked?.()).toBe(true);
    expect(registry.get('layer.set')?.enabled?.()).toBe(false);
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
