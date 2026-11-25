import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandError, SettleTimeoutError } from './command';
import { createRegistry } from './registry';
import { GUESTBOOK_ENTRY_MESSAGE, GUESTBOOK_OP, LOPSY_ERROR_CODES, NO_WEBGL2_MESSAGE, createLopsyApi } from './lopsy-api';
import { CANVAS_DRAG_MESSAGE, LIVE_PREVIEW_MESSAGE } from './preflight';

afterEach(() => {
  vi.restoreAllMocks();
});

const GUIDE = Object.values(
  import.meta.glob('/SKILL.md', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>,
)[0]!;

function setup({ hasWebGL2 = true }: { hasWebGL2?: boolean } = {}) {
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
  registry.define({
    id: 'layer.reject',
    summary: 'Rejects with something that is not an Error.',
    surface: 'document',
    params: {},
    run: () => Promise.reject('a string'),
  });
  return { api: createLopsyApi(registry, { hasWebGL2: () => hasWebGL2 }), registry, log };
}

describe('lopsy.guestbook', () => {
  function withGuestbook() {
    const { api, registry, log } = setup();
    const entries: unknown[] = [];
    registry.define({
      id: GUESTBOOK_OP,
      summary: 'Signs the guestbook.',
      surface: 'document',
      settles: false,
      params: { name: { type: 'string', optional: true }, message: { type: 'string', optional: true } },
      run: (entry) => {
        entries.push(entry);
        return { signed: true };
      },
    });
    return { api, entries, log };
  }

  it('runs guestbook.sign with the entry\'s fields, and answers as run does', async () => {
    const { api, entries } = withGuestbook();
    expect(await api.guestbook({ name: 'Ada', message: 'hello' })).toEqual({ ok: true, result: { signed: true } });
    expect(await api.guestbook({})).toEqual({ ok: true, result: { signed: true } });
    expect(await api.guestbook()).toEqual({ ok: true, result: { signed: true } });
    expect(entries).toEqual([{ name: 'Ada', message: 'hello' }, {}, {}]);
    expect(await api.guestbook({ name: 42 })).toMatchObject({ ok: false, error: { name: 'CommandError', code: 'invalid' } });
    expect(await api.guestbook({ note: 'hello' })).toMatchObject({ ok: false, error: { code: 'invalid' } });
    expect(entries).toHaveLength(3);
  });

  it('answers anything that is not an object as invalid, saying what it takes', async () => {
    const { api, entries } = withGuestbook();
    for (const entry of ['hello', 42, null, ['hello']]) {
      expect(await api.guestbook(entry)).toEqual({
        ok: false,
        error: { name: 'CommandError', code: 'invalid', message: GUESTBOOK_ENTRY_MESSAGE },
      });
    }
    expect(GUESTBOOK_ENTRY_MESSAGE).toContain('{ name, region, model, message }');
    expect(entries).toEqual([]);
  });

  it('cannot be made to run another command', async () => {
    const { api, entries, log } = withGuestbook();
    expect(await api.guestbook({ op: 'layer.add', name: 'Ada' })).toEqual({ ok: true, result: { signed: true } });
    expect(entries).toEqual([{ name: 'Ada' }]);
    expect(log).toEqual([]);
  });
});

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

  it('resolves a bug to code internal, and logs the original error', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { api } = setup();
    const outcome = await api.run({ op: 'layer.explode' });
    expect(outcome).toEqual({
      ok: false,
      error: { name: 'InternalError', code: 'internal', message: 'TypeError: cannot read properties of undefined' },
    });
    expect(JSON.parse(JSON.stringify(outcome))).toEqual(outcome);
    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged.mock.calls[0]![0]).toBeInstanceOf(TypeError);
  });

  it('gives a bug in a list the index and completed a refusal has', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { api, log } = setup();
    const outcome = await api.run([{ op: 'layer.add' }, { op: 'layer.add' }, { op: 'layer.explode' }, { op: 'layer.add' }]);
    expect(outcome).toEqual({
      ok: false,
      error: {
        name: 'InternalError',
        code: 'internal',
        message: '[2] layer.explode: TypeError: cannot read properties of undefined',
        index: 2,
        completed: [{ id: 'layer-1' }, { id: 'layer-2' }],
      },
    });
    expect(log).toEqual(['add ', 'add ']);
    expect(logged.mock.calls[0]![0]).toBeInstanceOf(TypeError);
  });

  it('resolves a rejection with a non-Error value to code internal', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { api } = setup();
    expect(await api.run({ op: 'layer.reject' })).toMatchObject({ ok: false, error: { code: 'internal', message: 'a string' } });
    expect(await api.run([{ op: 'layer.reject' }])).toMatchObject({
      ok: false,
      error: { code: 'internal', message: '[0] layer.reject: a string', index: 0, completed: [] },
    });
  });

  it('logs nothing for a refusal', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { api } = setup();
    await api.run([{ op: 'layer.add' }, { op: 'layer.remove' }]);
    expect(logged).not.toHaveBeenCalled();
  });
});

describe('lopsy.run without WebGL2', () => {
  it('answers every call unavailable at once, running nothing', async () => {
    const { api, log } = setup({ hasWebGL2: false });
    const single = await api.run({ op: 'layer.add', name: 'a' });
    expect(single).toEqual({ ok: false, error: { name: 'CommandError', code: 'unavailable', message: NO_WEBGL2_MESSAGE } });
    expect(await api.run([{ op: 'layer.add' }, { op: 'layer.add' }])).toEqual({
      ok: false,
      error: { name: 'CommandError', code: 'unavailable', message: NO_WEBGL2_MESSAGE, index: 0, completed: [] },
    });
    expect(await api.run({ op: 'no.such' })).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    expect(log).toEqual([]);
    expect(NO_WEBGL2_MESSAGE).toMatch(/WebGL2/);
    expect(NO_WEBGL2_MESSAGE).toContain('--use-angle=swiftshader');
  });

  it('still describes the commands', () => {
    const { api, registry } = setup({ hasWebGL2: false });
    expect(api.describe().map((d) => d.id)).toEqual(registry.describe('document').map((d) => d.id));
  });

  it('offers the same SwiftShader flags as the guide\'s driver', () => {
    expect(GUIDE).toContain("'--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'");
  });
});

describe('the guide', () => {
  it('documents every error code lopsy.run can answer with', () => {
    const table = GUIDE.slice(GUIDE.indexOf('### Errors'), GUIDE.indexOf('### Coordinates'));
    for (const code of LOPSY_ERROR_CODES) expect(table, code).toContain(`| \`${code}\` |`);
  });

  it('quotes the refusals a person mid-action causes exactly, as the preflight words them', () => {
    const section = GUIDE.slice(GUIDE.indexOf('## Working alongside a person'), GUIDE.indexOf('## Getting image bytes out and in'));
    for (const message of [LIVE_PREVIEW_MESSAGE, CANVAS_DRAG_MESSAGE]) expect(section).toContain(`\`${message}\``);
  });
});
