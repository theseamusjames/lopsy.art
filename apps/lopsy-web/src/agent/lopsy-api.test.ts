import { describe, expect, it } from 'vitest';
import { CommandError, SettleTimeoutError } from '../commands/command';
import { createRegistry } from '../commands/registry';
import { createLopsyApi } from './lopsy-api';

function setup() {
  const registry = createRegistry();
  const log: string[] = [];
  registry.define({
    id: 'layer.add',
    summary: 'Adds a layer.',
    surface: 'document',
    params: { name: { type: 'string', optional: true } },
    run: ({ name }) => {
      log.push(`add ${name ?? ''}`);
      return { id: `layer-${log.length}` };
    },
  });
  registry.define({
    id: 'layer.remove',
    summary: 'Refuses.',
    surface: 'document',
    params: {},
    run: () => {
      throw new CommandError('refused', 'There is no layer to remove.', { notice: 'info' });
    },
  });
  registry.define({
    id: 'layer.explode',
    summary: 'Has a bug.',
    surface: 'document',
    params: {},
    run: () => {
      throw new TypeError('cannot read properties of undefined');
    },
  });
  registry.define({
    id: 'ui.layer-properties',
    summary: 'Opens a dialog.',
    surface: 'ui',
    params: {},
    run: () => {
      log.push('ui');
    },
  });
  registry.define({
    id: 'image.unsettled',
    summary: 'Its settle wait times out.',
    surface: 'document',
    params: {},
    run: () => 'done',
  });
  return { api: createLopsyApi(registry), registry, log };
}

describe('lopsy.describe', () => {
  it('lists the document commands only, as JSON', () => {
    const { api, registry } = setup();
    const description = api.describe();
    expect(description.map((d) => d.id)).toEqual(registry.describe('document').map((d) => d.id));
    expect(description.some((d) => d.surface === 'ui')).toBe(false);
    expect(JSON.parse(JSON.stringify(description))).toEqual(description);
  });
});

describe('lopsy.run', () => {
  it('resolves { ok, result } for one invocation', async () => {
    const { api, log } = setup();
    await expect(api.run({ op: 'layer.add', name: 'a' })).resolves.toEqual({ ok: true, result: { id: 'layer-1' } });
    expect(log).toEqual(['add a']);
  });

  it('resolves { ok, results } for a list', async () => {
    const { api } = setup();
    await expect(api.run([{ op: 'layer.add' }, { op: 'layer.add' }])).resolves.toEqual({
      ok: true,
      results: [{ id: 'layer-1' }, { id: 'layer-2' }],
    });
    await expect(api.run([])).resolves.toEqual({ ok: true, results: [] });
  });

  it('resolves a refusal to { ok: false, error } with the error as JSON', async () => {
    const { api } = setup();
    const outcome = await api.run({ op: 'layer.remove' });
    expect(outcome).toEqual({
      ok: false,
      error: { name: 'CommandError', code: 'refused', message: 'There is no layer to remove.' },
    });
    expect(JSON.parse(JSON.stringify(outcome))).toEqual(outcome);
  });

  it('resolves invalid params and a malformed invocation the same way', async () => {
    const { api } = setup();
    const invalid = await api.run({ op: 'layer.add', name: 3 });
    expect(invalid).toMatchObject({ ok: false, error: { code: 'invalid' } });
    const malformed = await api.run('layer.add');
    expect(malformed).toMatchObject({ ok: false, error: { code: 'invalid' } });
  });

  it('carries completed and the failing index for a list', async () => {
    const { api, log } = setup();
    const outcome = await api.run([{ op: 'layer.add' }, { op: 'layer.remove' }, { op: 'layer.add' }]);
    expect(outcome).toEqual({
      ok: false,
      error: {
        name: 'CommandError',
        code: 'refused',
        message: '[1] layer.remove: There is no layer to remove.',
        completed: [{ id: 'layer-1' }],
        index: 1,
      },
    });
    expect(log).toEqual(['add ']);
  });

  it('carries the result of an unsettled command', async () => {
    const { api, registry } = setup();
    registry.setSettle(() => Promise.reject(new SettleTimeoutError(10, 'the engine to go idle', '')));
    expect(await api.run({ op: 'image.unsettled' })).toMatchObject({
      ok: false,
      error: { code: 'unsettled', result: 'done' },
    });
  });

  it('answers a ui command as unknown, suggesting document commands only', async () => {
    const { api, log } = setup();
    const outcome = await api.run({ op: 'ui.layer-properties' });
    expect(outcome).toMatchObject({ ok: false, error: { code: 'not-found' } });
    if (outcome.ok) throw new Error('expected a failure');
    expect(outcome.error.message).toContain('Unknown command "ui.layer-properties"');
    expect(outcome.error.message).not.toMatch(/Did you mean:.*ui\./);
    expect(log).toEqual([]);
  });

  it('rejects for anything that is not a CommandError', async () => {
    const { api } = setup();
    await expect(api.run({ op: 'layer.explode' })).rejects.toThrow(TypeError);
    await expect(api.run([{ op: 'layer.add' }, { op: 'layer.explode' }])).rejects.toThrow(TypeError);
  });
});
