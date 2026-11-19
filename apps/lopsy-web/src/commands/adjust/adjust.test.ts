// @vitest-environment jsdom
import '../../test/canvas-mock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

vi.mock('../../engine-wasm/engine-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine-wasm/engine-state')>();
  return { ...actual, getEngine: () => null };
});

const { useEditorStore } = await import('../../app/editor-store');
const { CommandError } = await import('../command');
const { runCommand } = await import('../registry');
await import('./adjust');

type Store = ReturnType<typeof useEditorStore.getState>;
type Group = Extract<Store['document']['layers'][number], { type: 'group' }>;
type ActionName =
  | 'addAdjustmentNode' | 'updateAdjustmentNode' | 'removeAdjustmentNode' | 'toggleAdjustmentNode'
  | 'reorderAdjustmentNodes' | 'setGroupAdjustmentsEnabled';
const ACTIONS: ActionName[] = [
  'addAdjustmentNode', 'updateAdjustmentNode', 'removeAdjustmentNode', 'toggleAdjustmentNode',
  'reorderAdjustmentNodes', 'setGroupAdjustmentsEnabled',
];
const real = Object.fromEntries(ACTIONS.map((name) => [name, useEditorStore.getState()[name]])) as Pick<Store, ActionName>;

interface NodeSummary {
  id: string;
  type: string;
  enabled: boolean;
  params: Record<string, unknown>;
}

interface Result {
  group: string;
  enabled: boolean;
  nodes: NodeSummary[];
}

function store(): Store {
  return useEditorStore.getState();
}

function spyOn<K extends ActionName>(name: K) {
  const spy = vi.fn(real[name] as (...args: unknown[]) => unknown);
  useEditorStore.setState({ [name]: spy } as unknown as Partial<Store>);
  return spy;
}

function root(): Group {
  const doc = store().document;
  const group = doc.layers.find((l) => l.id === doc.rootGroupId);
  if (!group || group.type !== 'group') throw new Error('no root group');
  return group;
}

function labels(): string[] {
  return store().undoStack.map((e) => e.label);
}

async function failure(promise: Promise<unknown>): Promise<InstanceType<typeof CommandError>> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CommandError);
    return error as InstanceType<typeof CommandError>;
  }
  throw new Error('expected a rejection');
}

function nodeId(type: string): string {
  const node = root().adjustments.find((n) => n.type === type);
  if (!node) throw new Error(`no ${type} node`);
  return node.id;
}

beforeEach(() => {
  store().createDocument(40, 30, false);
  store().pushHistory('New Document');
});

afterEach(() => {
  useEditorStore.setState(real);
  vi.restoreAllMocks();
});

describe('adjust.list', () => {
  it('lists the root group\'s default nodes when a raster layer is active, as the panel shows them', async () => {
    const result = (await runCommand('adjust.list')) as Result;
    expect(result.group).toBe(root().id);
    expect(result.enabled).toBe(true);
    expect(result.nodes.map((n) => n.type)).toEqual(['levels', 'curves', 'exposure', 'hue-saturation', 'color-grading']);
    expect(result.nodes[2]).toEqual({ id: nodeId('exposure'), type: 'exposure', enabled: true, params: { exposure: 0 } });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it('targets the active group when one is active', async () => {
    store().addGroup();
    const doc = store().document;
    const active = doc.layers.find((l) => l.id === doc.activeLayerId);
    expect(active?.type).toBe('group');
    const result = (await runCommand('adjust.list')) as Result;
    expect(result.group).toBe(active?.id);
    expect(result.nodes).toEqual([]);
  });

  it('refuses a non-group layer as invalid', async () => {
    const error = await failure(runCommand('adjust.list', { group: 'Layer 1' }));
    expect(error.code).toBe('invalid');
    expect(error.message).toContain('adjustment nodes belong to groups');
  });
});

describe('adjust.add', () => {
  it('calls addAdjustmentNode synchronously and returns the new id', async () => {
    const spy = spyOn('addAdjustmentNode');
    const pending = runCommand('adjust.add', { type: 'vignette' });
    expect(spy).toHaveBeenCalledWith(root().id, 'vignette');
    const result = (await pending) as Result & { id: string };
    expect(result.nodes[result.nodes.length - 1]).toEqual({ id: result.id, type: 'vignette', enabled: true, params: { vignette: 0 } });
    expect(labels()).toEqual(['New Document', 'Add Adjustment']);
  });

  it('refuses a type the menu hides for the colour mode', async () => {
    useEditorStore.setState({ document: { ...store().document, colorMode: 'grayscale' } });
    const error = await failure(runCommand('adjust.add', { type: 'saturation' }));
    expect(error.code).toBe('refused');
    expect(error.message).toBe('Saturation & Vibrance is not offered in grayscale documents: the Add Adjustment menu leaves it out.');
  });
});

describe('adjust.set', () => {
  it('pushes one "Edit <Node>" per changed param, then updates', async () => {
    const spy = spyOn('updateAdjustmentNode');
    const id = nodeId('hue-saturation');
    const pending = runCommand('adjust.set', { node: id, params: { lightness: 10, hue: 30, saturation: 0 } });
    expect(spy.mock.calls).toEqual([[root().id, id, { hue: 30 }], [root().id, id, { lightness: 10 }]]);
    const result = (await pending) as Result;
    expect(result.nodes.find((n) => n.id === id)?.params).toEqual({ hue: 30, saturation: 0, lightness: 10 });
    expect(labels()).toEqual(['New Document', 'Edit Hue / Saturation', 'Edit Hue / Saturation']);
  });

  it('takes a node type when the group has one node of it', async () => {
    await runCommand('adjust.set', { node: 'exposure', params: { exposure: 1.5 } });
    expect(root().adjustments.find((n) => n.type === 'exposure')).toMatchObject({ exposure: 1.5 });
  });

  it('normalises curves as the editor does and keeps other channels', async () => {
    await runCommand('adjust.set', { node: 'curves', params: { curves: { r: [{ x: 0.5, y: 0.7 }, { x: 1, y: 1 }] } } });
    const node = root().adjustments.find((n) => n.type === 'curves');
    expect(node).toMatchObject({ curves: { r: [{ x: 0, y: 0.7 }, { x: 0.5, y: 0.7 }, { x: 1, y: 1 }], rgb: [{ x: 0, y: 0 }, { x: 1, y: 1 }] } });
  });

  it('merges partial levels channels and colour grading wheels', async () => {
    await runCommand('adjust.set', { node: 'levels', params: { levels: { rgb: { inputBlack: 0.1, gamma: 2 } } } });
    expect(root().adjustments.find((n) => n.type === 'levels')).toMatchObject({
      levels: { rgb: { inputBlack: 0.1, inputWhite: 1, gamma: 2, outputBlack: 0, outputWhite: 1 } },
    });
    await runCommand('adjust.set', { node: 'color-grading', params: { shadows: { hue: 200 } } });
    expect(root().adjustments.find((n) => n.type === 'color-grading')).toMatchObject({ shadows: { hue: 200, saturation: 0, luminance: 0 } });
  });

  it('converts gradient map stops and the photo filter colour', async () => {
    const gm = ((await runCommand('adjust.add', { type: 'gradient-map' })) as { id: string }).id;
    const pf = ((await runCommand('adjust.add', { type: 'photo-filter' })) as { id: string }).id;
    await runCommand('adjust.set', { node: gm, params: { stops: [{ position: 1, color: '#ff0000' }, { position: 0, color: '#0000ff' }] } });
    const result = (await runCommand('adjust.set', { node: pf, params: { color: '#102030', density: 60 } })) as Result;
    expect(result.nodes.find((n) => n.id === gm)?.params).toEqual({
      stops: [{ position: 0, color: '#0000ff' }, { position: 1, color: '#ff0000' }],
    });
    expect(result.nodes.find((n) => n.id === pf)?.params).toEqual({ color: '#102030', density: 60, preserveLuminosity: true });
  });

  it('is invalid for unknown params, bad values and out-of-range values, and changes nothing', async () => {
    const cases: Array<[string, Record<string, unknown>, string]> = [
      ['exposure', { gamma: 1 }, 'adjust.set: unknown param "gamma"; valid params for exposure: exposure'],
      ['exposure', { exposure: 6 }, 'adjust.set: params.exposure must be a number from -5 to 5, got 6'],
      ['curves', { curves: { rgb: [{ x: 2, y: 0 }, { x: 1, y: 1 }] } }, 'adjust.set: params.curves.rgb[0].x must be a number from 0 to 1, got 2'],
      ['levels', { levels: { rgb: { inputBlack: 1 } } }, 'adjust.set: params.levels.rgb.inputBlack must be below inputWhite (1), got 1'],
      ['exposure', {}, 'adjust.set: params is empty; valid params for exposure: exposure'],
    ];
    for (const [node, params, message] of cases) {
      const error = await failure(runCommand('adjust.set', { node, params }));
      expect([error.code, error.message]).toEqual(['invalid', message]);
    }
    expect(labels()).toEqual(['New Document']);
  });

  it('is not-found for an unknown node and invalid for an ambiguous type', async () => {
    expect((await failure(runCommand('adjust.set', { node: 'vignette', params: { vignette: 1 } }))).code).toBe('not-found');
    await runCommand('adjust.add', { type: 'exposure' });
    const error = await failure(runCommand('adjust.set', { node: 'exposure', params: { exposure: 1 } }));
    expect(error.code).toBe('invalid');
    expect(error.message).toContain('has 2 exposure nodes');
  });
});

describe('adjust.remove, set-node-enabled, reorder, set-enabled', () => {
  it('remove calls removeAdjustmentNode', async () => {
    const spy = spyOn('removeAdjustmentNode');
    const id = nodeId('exposure');
    const pending = runCommand('adjust.remove', { node: id });
    expect(spy).toHaveBeenCalledWith(root().id, id);
    expect(((await pending) as Result).nodes.some((n) => n.id === id)).toBe(false);
    expect(labels()).toEqual(['New Document', 'Remove Adjustment']);
  });

  it('set-node-enabled toggles only when the state differs', async () => {
    const spy = spyOn('toggleAdjustmentNode');
    await runCommand('adjust.set-node-enabled', { node: 'exposure', enabled: true });
    expect(spy).not.toHaveBeenCalled();
    await runCommand('adjust.set-node-enabled', { node: 'exposure', enabled: false });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(root().adjustments.find((n) => n.type === 'exposure')?.enabled).toBe(false);
    expect(labels()).toEqual(['New Document', 'Toggle Adjustment']);
  });

  it('reorder calls reorderAdjustmentNodes with a permutation, and skips the current order', async () => {
    const spy = spyOn('reorderAdjustmentNodes');
    const ids = root().adjustments.map((n) => n.id);
    await runCommand('adjust.reorder', { nodes: ids });
    expect(spy).not.toHaveBeenCalled();
    const reversed = [...ids].reverse();
    expect(((await runCommand('adjust.reorder', { nodes: reversed })) as Result).nodes.map((n) => n.id)).toEqual(reversed);
    expect(labels()).toEqual(['New Document', 'Reorder Adjustments']);
    expect((await failure(runCommand('adjust.reorder', { nodes: ids.slice(1) }))).code).toBe('invalid');
    expect((await failure(runCommand('adjust.reorder', { nodes: [...ids.slice(1), ids[1]] }))).code).toBe('invalid');
  });

  it('set-enabled calls setGroupAdjustmentsEnabled with no history, only when it differs', async () => {
    const spy = spyOn('setGroupAdjustmentsEnabled');
    await runCommand('adjust.set-enabled', { enabled: true });
    expect(spy).not.toHaveBeenCalled();
    const result = (await runCommand('adjust.set-enabled', { enabled: false })) as Result;
    expect(spy).toHaveBeenCalledWith(root().id, false);
    expect(result.enabled).toBe(false);
    expect(labels()).toEqual(['New Document']);
  });
});
