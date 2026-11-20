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

// A named layer that is not active is acted on once the engine has settled (context.ts actOnLayer); there is no render loop here.
const settle = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../settled', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../settled')>()),
  settled: () => {
    settle.calls++;
    return Promise.resolve();
  },
}));

vi.mock('../../engine-wasm/engine-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine-wasm/engine-state')>();
  return { ...actual, getEngine: () => null };
});

const { useEditorStore } = await import('../../app/editor-store');
const { useUIStore } = await import('../../app/ui-store');
const { CommandError } = await import('../command');
const { runCommand } = await import('../registry');
await import('./layer');

type Store = ReturnType<typeof useEditorStore.getState>;
type ActionName =
  | 'addLayer' | 'addGroup' | 'renameLayer' | 'removeLayer' | 'removeSelectedLayers' | 'setActiveLayer'
  | 'toggleLayerSelection' | 'selectLayerRange' | 'toggleLayerVisibility' | 'toggleLayerLock'
  | 'updateLayerOpacity' | 'updateLayerBlendMode' | 'duplicateLayer' | 'mergeDown'
  | 'flattenImage' | 'dropLayer' | 'setLayerSelection' | 'groupSelectedLayers' | 'pushHistory' | 'pushHistoryMetadata';

function store(): Store {
  return useEditorStore.getState();
}

const ACTIONS: ActionName[] = [
  'addLayer', 'addGroup', 'renameLayer', 'removeLayer', 'removeSelectedLayers', 'setActiveLayer',
  'toggleLayerSelection', 'selectLayerRange', 'toggleLayerVisibility', 'toggleLayerLock',
  'updateLayerOpacity', 'updateLayerBlendMode', 'duplicateLayer', 'mergeDown',
  'flattenImage', 'dropLayer', 'setLayerSelection', 'groupSelectedLayers', 'pushHistory', 'pushHistoryMetadata',
];
const real = Object.fromEntries(ACTIONS.map((name) => [name, store()[name]])) as Pick<Store, ActionName>;

function spyOn<K extends ActionName>(name: K) {
  const spy = vi.fn(real[name] as (...args: unknown[]) => unknown);
  useEditorStore.setState({ [name]: spy } as unknown as Partial<Store>);
  return spy;
}

async function rejection(promise: Promise<unknown>): Promise<InstanceType<typeof CommandError>> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CommandError);
    return error as InstanceType<typeof CommandError>;
  }
  throw new Error('expected a rejection');
}

async function refusedWith(promise: Promise<unknown>, message: string | RegExp, code = 'refused'): Promise<void> {
  const error = await rejection(promise);
  expect(error.code).toBe(code);
  if (typeof message === 'string') expect(error.message).toBe(message);
  else expect(error.message).toMatch(message);
}

function doc() {
  return store().document;
}

function idOf(name: string): string {
  const layer = doc().layers.find((l) => l.name === name);
  if (!layer) throw new Error(`no layer ${name}`);
  return layer.id;
}

function layer(name: string) {
  return doc().layers.find((l) => l.id === idOf(name))!;
}

function childrenOf(name: string): readonly string[] {
  const group = layer(name);
  if (group.type !== 'group') throw new Error(`${name} is not a group`);
  return group.children;
}

function labels(): string[] {
  return store().undoStack.map((e) => e.label);
}

function orderNames(): string[] {
  return doc().layerOrder.map((id) => doc().layers.find((l) => l.id === id)!.name);
}

beforeEach(() => {
  store().createDocument(40, 30, false);
  store().pushHistory('New Document');
  useUIStore.getState().setMaskEditMode(false);
});

afterEach(() => {
  useEditorStore.setState(real);
  vi.restoreAllMocks();
});

describe('layer.add', () => {
  it('calls addLayer before its first await and returns the new active layer id', async () => {
    const add = spyOn('addLayer');
    const pending = runCommand('layer.add', {});
    expect(add).toHaveBeenCalledTimes(1);
    const result = await pending;
    expect(result).toEqual({ id: doc().activeLayerId });
    expect(orderNames()).toEqual(['Background', 'Layer 1', 'Layer 2', 'Project']);
    expect(labels()).toEqual(['New Document', 'Add Layer']);
  });

  it('renames with a trimmed name as a second history step, as Add then rename in the panel', async () => {
    const rename = spyOn('renameLayer');
    const pending = runCommand('layer.add', { name: '  Sky ' });
    const { id } = (await pending) as { id: string };
    expect(rename).toHaveBeenCalledWith(id, 'Sky');
    expect(layer('Sky').id).toBe(id);
    expect(labels()).toEqual(['New Document', 'Add Layer', 'Rename Layer']);
  });

  it('rejects a blank name before adding anything', async () => {
    const add = spyOn('addLayer');
    await refusedWith(runCommand('layer.add', { name: '   ' }), 'layer.add: name must contain something other than spaces', 'invalid');
    await refusedWith(runCommand('layer.add', { name: '' }), /^layer\.add: name must be a string of at least 1 characters/, 'invalid');
    expect(add).not.toHaveBeenCalled();
  });

  it('in an Indexed document calls addLayer, which toasts, and then refuses silently with the same text', async () => {
    useEditorStore.setState({ document: { ...doc(), colorMode: 'indexed' } });
    const add = spyOn('addLayer');
    const { useNotificationsStore } = await import('../../app/notifications-store');
    const toastsBefore = useNotificationsStore.getState().notifications.length;
    const pending = runCommand('layer.add', {});
    expect(add).toHaveBeenCalledTimes(1);
    const error = await rejection(pending);
    expect(error.code).toBe('refused');
    expect(error.message).toBe('Indexed mode does not support layers. Convert to RGB first.');
    expect(error.notice).toBeNull();
    expect(useNotificationsStore.getState().notifications.length).toBe(toastsBefore + 1);
    expect(doc().layers).toHaveLength(3);
  });
});

describe('layer.add-group', () => {
  it('calls addGroup(name) and pushes no history', async () => {
    const addGroup = spyOn('addGroup');
    const pending = runCommand('layer.add-group', { name: 'Trees' });
    expect(addGroup).toHaveBeenCalledWith('Trees');
    expect(await pending).toEqual({ id: idOf('Trees') });
    expect(layer('Trees').type).toBe('group');
    expect(labels()).toEqual(['New Document']);
  });

  it('names it "Group" by default', async () => {
    const addGroup = spyOn('addGroup');
    await runCommand('layer.add-group', {});
    expect(addGroup).toHaveBeenCalledWith(undefined);
    expect(doc().activeLayerId).toBe(idOf('Group'));
  });

  it('refuses in an Indexed document', async () => {
    useEditorStore.setState({ document: { ...doc(), colorMode: 'indexed' } });
    await refusedWith(runCommand('layer.add-group', {}), /does not support layers/);
  });
});

describe('layer.remove', () => {
  it('calls removeLayer(id) for the active layer by default, as "Delete Layer"', async () => {
    const remove = spyOn('removeLayer');
    const layer1 = idOf('Layer 1');
    const pending = runCommand('layer.remove', {});
    expect(remove).toHaveBeenCalledWith(layer1);
    expect(await pending).toEqual({ removed: [layer1], activeLayer: idOf('Background') });
    expect(labels()).toEqual(['New Document', 'Delete Layer']);
  });

  it('removes a named layer that is not active', async () => {
    await runCommand('layer.remove', { layer: 'Background' });
    expect(orderNames()).toEqual(['Layer 1', 'Project']);
  });

  it('refuses the root group, and a ref that matches nothing is not-found', async () => {
    const remove = spyOn('removeLayer');
    await refusedWith(runCommand('layer.remove', { layer: 'Project' }), 'The root group cannot be deleted.');
    await refusedWith(runCommand('layer.remove', { layer: 'Nope' }), 'No layer has the id or name "Nope".', 'not-found');
    expect(remove).not.toHaveBeenCalled();
  });
});

describe('layer.remove-selected', () => {
  it('calls removeSelectedLayers and reports every removed layer', async () => {
    const background = idOf('Background');
    const layer1 = idOf('Layer 1');
    store().toggleLayerSelection(background);
    const remove = spyOn('removeSelectedLayers');
    const pending = runCommand('layer.remove-selected', {});
    expect(remove).toHaveBeenCalledTimes(1);
    const result = (await pending) as { removed: string[]; activeLayer: string | null };
    expect([...result.removed].sort()).toEqual([background, layer1].sort());
    expect(orderNames()).toEqual(['Project']);
    expect(labels()).toEqual(['New Document', 'Delete Layers']);
  });

  it('refuses when only the root group is selected, as the disabled button', async () => {
    store().setActiveLayer(doc().rootGroupId!);
    const remove = spyOn('removeSelectedLayers');
    await refusedWith(runCommand('layer.remove-selected', {}), 'No deletable layer is selected: the root group cannot be deleted.');
    expect(remove).not.toHaveBeenCalled();
  });
});

describe('layer.select', () => {
  it('replace calls setActiveLayer and leaves mask edit mode, as a row click', async () => {
    useUIStore.getState().setMaskEditMode(true);
    const set = spyOn('setActiveLayer');
    const background = idOf('Background');
    const pending = runCommand('layer.select', { layer: background });
    expect(set).toHaveBeenCalledWith(background);
    expect(useUIStore.getState().maskMode).toBe('off');
    expect(await pending).toEqual({ activeLayer: background, selectedLayers: [background] });
  });

  it('toggle calls toggleLayerSelection and keeps the active layer', async () => {
    const toggle = spyOn('toggleLayerSelection');
    useUIStore.getState().setMaskEditMode(true);
    const pending = runCommand('layer.select', { layer: 'Background', mode: 'toggle' });
    expect(toggle).toHaveBeenCalledWith(idOf('Background'));
    expect(await pending).toEqual({ activeLayer: idOf('Layer 1'), selectedLayers: [idOf('Layer 1'), idOf('Background')] });
    expect(useUIStore.getState().maskMode).toBe('layerMask');
  });

  it('toggle refuses the active layer, which always stays selected', async () => {
    await refusedWith(
      runCommand('layer.select', { layer: 'Layer 1', mode: 'toggle' }),
      'The active layer always stays selected: make another layer active first.',
    );
  });

  it('range calls selectLayerRange from the active layer', async () => {
    store().addLayer();
    const range = spyOn('selectLayerRange');
    const pending = runCommand('layer.select', { layer: 'Background', mode: 'range' });
    expect(range).toHaveBeenCalledWith(idOf('Layer 2'), idOf('Background'));
    expect(((await pending) as { selectedLayers: string[] }).selectedLayers).toEqual([idOf('Layer 2'), idOf('Layer 1'), idOf('Background')]);
  });

  it('range with no active layer acts as a plain click, as the panel does', async () => {
    useEditorStore.setState({ document: { ...doc(), activeLayerId: null } });
    const set = spyOn('setActiveLayer');
    await runCommand('layer.select', { layer: 'Background', mode: 'range' });
    expect(set).toHaveBeenCalledWith(idOf('Background'));
  });

  it('rejects an unknown mode and needs a layer', async () => {
    await refusedWith(runCommand('layer.select', { layer: 'Background', mode: 'add' }), /^layer\.select: mode must be one of "replace", "toggle", "range"/, 'invalid');
    await refusedWith(runCommand('layer.select', {}), /^layer\.select: layer is required/, 'invalid');
  });

  it('lists the candidates when a name matches several layers', async () => {
    store().renameLayer(idOf('Background'), 'Layer 1');
    const error = await rejection(runCommand('layer.select', { layer: 'Layer 1' }));
    expect(error.code).toBe('invalid');
    expect(error.message).toMatch(/^2 layers are named "Layer 1": pass one of their ids/);
  });
});

describe('layer.set', () => {
  it('renames with a trimmed name ("Rename Layer")', async () => {
    const rename = spyOn('renameLayer');
    const id = idOf('Layer 1');
    const pending = runCommand('layer.set', { name: ' Sky ' });
    expect(rename).toHaveBeenCalledWith(id, 'Sky');
    expect(await pending).toEqual({ id, name: 'Sky', type: 'raster', visible: true, locked: false, opacity: 100, blendMode: 'normal' });
    expect(labels()).toEqual(['New Document', 'Rename Layer']);
  });

  it('sets visibility and lock to the requested state, toggling only when they differ', async () => {
    const visibility = spyOn('toggleLayerVisibility');
    const lock = spyOn('toggleLayerLock');
    await runCommand('layer.set', { layer: 'Background', visible: false, locked: true });
    expect(visibility).toHaveBeenCalledWith(idOf('Background'));
    expect(lock).toHaveBeenCalledWith(idOf('Background'));
    await runCommand('layer.set', { layer: 'Background', visible: false, locked: true });
    expect(visibility).toHaveBeenCalledTimes(1);
    expect(lock).toHaveBeenCalledTimes(1);
    expect(labels()).toEqual(['New Document', 'Toggle Visibility', 'Lock Layer']);
  });

  it('sets opacity in percent as one "Change Opacity" step, as the slider', async () => {
    const opacity = spyOn('updateLayerOpacity');
    const pending = runCommand('layer.set', { opacity: 40 });
    expect(opacity).toHaveBeenCalledWith(idOf('Layer 1'), 0.4);
    expect((await pending) as { opacity: number }).toMatchObject({ opacity: 40 });
    expect(labels()).toEqual(['New Document', 'Change Opacity']);
    await runCommand('layer.set', { opacity: 40 });
    expect(labels()).toEqual(['New Document', 'Change Opacity']);
  });

  it('sets the blend mode as one "Change Blend Mode" step', async () => {
    const blend = spyOn('updateLayerBlendMode');
    await runCommand('layer.set', { blendMode: 'multiply' });
    expect(blend).toHaveBeenCalledWith(idOf('Layer 1'), 'multiply');
    expect(labels()).toEqual(['New Document', 'Change Blend Mode']);
  });

  it('applies several properties in the documented order, one step each', async () => {
    await runCommand('layer.set', { blendMode: 'screen', opacity: 50, locked: false, visible: false, name: 'A' });
    expect(labels()).toEqual(['New Document', 'Rename Layer', 'Toggle Visibility', 'Change Opacity', 'Change Blend Mode']);
  });

  it('needs at least one property', async () => {
    await refusedWith(
      runCommand('layer.set', { layer: 'Background' }),
      'layer.set: pass at least one of name, visible, locked, opacity, blendMode',
      'invalid',
    );
  });

  it('rejects out-of-range opacity, unknown blend modes and the old position params', async () => {
    await refusedWith(runCommand('layer.set', { opacity: 101 }), /^layer\.set: opacity must be an integer from 0 to 100/, 'invalid');
    await refusedWith(runCommand('layer.set', { opacity: 50.5 }), /^layer\.set: opacity must be an integer/, 'invalid');
    await refusedWith(runCommand('layer.set', { blendMode: 'add' }), /^layer\.set: blendMode must be one of "pass-through", "normal"/, 'invalid');
    await refusedWith(runCommand('layer.set', { x: 1 }), /^layer\.set: unknown param "x"/, 'invalid');
  });

  it('refuses root-only properties on the root group, before changing anything', async () => {
    const rename = spyOn('renameLayer');
    await refusedWith(
      runCommand('layer.set', { layer: 'Project', name: 'Root', visible: false, opacity: 50 }),
      'The root group has no visible, opacity of its own to change.',
    );
    expect(rename).not.toHaveBeenCalled();
    await runCommand('layer.set', { layer: 'Project', name: 'Root', locked: true });
    expect(labels()).toEqual(['New Document', 'Rename Layer', 'Lock Layer']);
  });

  it('refuses pass-through on a raster layer and HSL modes where the colour mode lacks them', async () => {
    await refusedWith(runCommand('layer.set', { blendMode: 'pass-through' }), 'pass-through is only for groups.');
    useEditorStore.setState({ document: { ...doc(), colorMode: 'grayscale' } });
    await refusedWith(runCommand('layer.set', { blendMode: 'hue' }), 'The hue blend mode is not available in grayscale documents.');
    await runCommand('layer.add-group', {});
    await runCommand('layer.set', { blendMode: 'pass-through' });
    expect(layer('Group').blendMode).toBe('pass-through');
  });

});

describe('layer.duplicate', () => {
  it('calls duplicateLayer for the active layer and returns the copy id', async () => {
    const duplicate = spyOn('duplicateLayer');
    const pending = runCommand('layer.duplicate', {});
    expect(duplicate).toHaveBeenCalledTimes(1);
    expect(await pending).toEqual({ id: idOf('Layer 1 copy') });
    expect(labels()).toEqual(['New Document', 'Duplicate Layer']);
  });

  it('makes another layer active first, as a row click, and leaves mask edit mode', async () => {
    useUIStore.getState().setMaskEditMode(true);
    const set = spyOn('setActiveLayer');
    await runCommand('layer.duplicate', { layer: 'Background' });
    expect(set).toHaveBeenCalledWith(idOf('Background'));
    expect(useUIStore.getState().maskMode).toBe('off');
    expect(orderNames()).toEqual(['Background', 'Background copy', 'Layer 1', 'Project']);
  });

  it('refuses the root group, as the disabled button, without changing the active layer', async () => {
    const duplicate = spyOn('duplicateLayer');
    await refusedWith(
      runCommand('layer.duplicate', { layer: 'Project' }),
      'The root group cannot be duplicated: the Duplicate Layer button is disabled while it is active.',
    );
    expect(duplicate).not.toHaveBeenCalled();
    expect(doc().activeLayerId).toBe(idOf('Layer 1'));
  });

  it('refuses in an Indexed document', async () => {
    useEditorStore.setState({ document: { ...doc(), colorMode: 'indexed' } });
    await refusedWith(runCommand('layer.duplicate', {}), /does not support layers/);
  });
});

describe('layer.merge-down', () => {
  it('calls mergeDown and returns the layer merged into', async () => {
    const background = idOf('Background');
    const merge = spyOn('mergeDown');
    const pending = runCommand('layer.merge-down', {});
    expect(merge).toHaveBeenCalledTimes(1);
    expect(await pending).toEqual({ id: background });
    expect(orderNames()).toEqual(['Background', 'Project']);
    expect(labels()).toEqual(['New Document', 'Merge Down']);
  });

  it('refuses the bottom layer and the root group with the reason, leaving the active layer alone', async () => {
    const merge = spyOn('mergeDown');
    await refusedWith(runCommand('layer.merge-down', { layer: 'Background' }), 'There is no layer below the active layer to merge into.');
    await refusedWith(runCommand('layer.merge-down', { layer: 'Project' }), /^The active layer is a group, and the layer below it is inside it/);
    expect(merge).not.toHaveBeenCalled();
    expect(doc().activeLayerId).toBe(idOf('Layer 1'));
  });

  it('for the active layer still calls mergeDown, which flushes and does nothing, as Cmd+E does, then refuses silently', async () => {
    store().setActiveLayer(idOf('Background'));
    const merge = spyOn('mergeDown');
    const pending = runCommand('layer.merge-down', {});
    expect(merge).toHaveBeenCalledTimes(1);
    const error = await rejection(pending);
    expect([error.code, error.notice, error.message]).toEqual(['refused', null, 'There is no layer below the active layer to merge into.']);
    expect(labels()).toEqual(['New Document']);
  });

  it('makes a named layer active first', async () => {
    store().addLayer();
    const layer1 = idOf('Layer 1');
    const set = spyOn('setActiveLayer');
    await runCommand('layer.merge-down', { layer: 'Layer 1' });
    expect(set).toHaveBeenCalledWith(layer1);
    expect(orderNames()).toEqual(['Background', 'Layer 2', 'Project']);
  });
});

describe('layer.flatten', () => {
  it('calls flattenImage synchronously and resolves with the flattened layer once it has finished', async () => {
    const flatten = spyOn('flattenImage');
    const pending = runCommand('layer.flatten', {});
    expect(flatten).toHaveBeenCalledTimes(1);
    const result = await pending;
    expect(orderNames()).toEqual(['Background', 'Project']);
    expect(result).toEqual({ id: idOf('Background') });
    expect(labels()).toEqual(['New Document', 'Flatten Image']);
  });

  it('refuses with a single layer', async () => {
    useEditorStore.setState({ document: { ...doc(), layers: doc().layers.slice(0, 1) } });
    await refusedWith(runCommand('layer.flatten', {}), 'There is nothing to flatten.');
  });
});

describe('layer.reorder', () => {
  beforeEach(() => {
    store().addLayer();
    store().addGroup('G');
  });

  it('below: calls dropLayer with the target as belowId', async () => {
    const drop = spyOn('dropLayer');
    const pending = runCommand('layer.reorder', { layer: 'Layer 2', target: 'Background', position: 'below' });
    expect(drop).toHaveBeenCalledWith(idOf('Layer 2'), { parentId: doc().rootGroupId, belowId: idOf('Background') });
    expect(await pending).toEqual({ parent: doc().rootGroupId });
    expect(orderNames()).toEqual(['Layer 2', 'Background', 'Layer 1', 'G', 'Project']);
    expect(labels()).toEqual(['New Document', 'Add Layer', 'Reorder Layer']);
  });

  it('above: under the sibling directly above the target', async () => {
    await runCommand('layer.reorder', { layer: 'G', target: 'Layer 1', position: 'above' });
    expect(orderNames()).toEqual(['Background', 'Layer 1', 'G', 'Layer 2', 'Project']);
    await runCommand('layer.reorder', { layer: 'Background', target: 'Layer 2', position: 'above' });
    expect(orderNames()).toEqual(['Layer 1', 'G', 'Layer 2', 'Background', 'Project']);
  });

  it('inside: at the top of the group', async () => {
    const drop = spyOn('dropLayer');
    await runCommand('layer.reorder', { layer: 'Layer 1', target: 'G', position: 'inside' });
    expect(drop).toHaveBeenCalledWith(idOf('Layer 1'), { parentId: idOf('G'), belowId: null });
    expect(childrenOf('G')).toEqual([idOf('Layer 1')]);
  });

  it('refuses what the drag refuses', async () => {
    const drop = spyOn('dropLayer');
    await runCommand('layer.reorder', { layer: 'Layer 1', target: 'G', position: 'inside' });
    drop.mockClear();
    const cases: Array<[Record<string, string>, string]> = [
      [{ layer: 'Project', target: 'G', position: 'below' }, 'The root group cannot be moved.'],
      [{ layer: 'G', target: 'G', position: 'inside' }, 'A layer cannot be placed relative to itself.'],
      [{ layer: 'G', target: 'Layer 1', position: 'below' }, '"Layer 1" is inside "G": a group cannot be moved into itself.'],
      [{ layer: 'Layer 2', target: 'Background', position: 'inside' }, '"Background" is not a group: only a group can take a layer inside it.'],
      [{ layer: 'Layer 2', target: 'Project', position: 'above' }, 'Nothing can be placed above or below the root group: use position "inside" for the top of the document.'],
      [{ layer: 'Layer 2', target: 'Background', position: 'above' }, '"Layer 2" is already above "Background".'],
      [{ layer: 'Layer 1', target: 'G', position: 'inside' }, '"Layer 1" is already inside "G".'],
    ];
    for (const [params, message] of cases) {
      await refusedWith(runCommand('layer.reorder', params), message);
    }
    expect(drop).not.toHaveBeenCalled();
  });

  it('needs a position', async () => {
    await refusedWith(runCommand('layer.reorder', { layer: 'G', target: 'Background' }), /^layer\.reorder: position is required/, 'invalid');
  });
});

describe('layer.group', () => {
  it('wraps the single selected layer, as the menu does, and returns the group id', async () => {
    const group = spyOn('groupSelectedLayers');
    const pending = runCommand('layer.group', {});
    expect(group).toHaveBeenCalledTimes(1);
    const { id } = (await pending) as { id: string };
    expect(id).toBe(idOf('Group'));
    expect(childrenOf('Group')).toEqual([idOf('Layer 1')]);
    expect(labels()).toEqual(['New Document', 'Group Layers']);
  });

  it('sets the selection to exactly `layers` first', async () => {
    const select = spyOn('setLayerSelection');
    const background = idOf('Background');
    const layer1 = idOf('Layer 1');
    await runCommand('layer.group', { layers: ['Background', layer1, 'Background'] });
    expect(select).toHaveBeenCalledWith([background, layer1]);
    expect([...childrenOf('Group')].sort()).toEqual([background, layer1].sort());
  });

  it('adds an empty group with no history when only the root group is selected', async () => {
    store().setActiveLayer(doc().rootGroupId!);
    await runCommand('layer.group', {});
    expect(childrenOf('Group')).toEqual([]);
    expect(labels()).toEqual(['New Document']);
  });

  it('rejects the root group, an empty list and unknown layers', async () => {
    const group = spyOn('groupSelectedLayers');
    await refusedWith(runCommand('layer.group', { layers: ['Project'] }), 'layer.group: the root group cannot be grouped', 'invalid');
    await refusedWith(runCommand('layer.group', { layers: [] }), /^layer\.group: layers must be an array of at least 1 items/, 'invalid');
    await refusedWith(runCommand('layer.group', { layers: ['Nope'] }), 'No layer has the id or name "Nope".', 'not-found');
    expect(group).not.toHaveBeenCalled();
  });

  it('refuses in an Indexed document', async () => {
    useEditorStore.setState({ document: { ...doc(), colorMode: 'indexed' } });
    await refusedWith(runCommand('layer.group', {}), /does not support layers/);
  });
});

describe('layer commands without a document', () => {
  it.each([
    ['layer.add', {}],
    ['layer.remove-selected', {}],
    ['layer.select', { layer: 'x' }],
    ['layer.flatten', {}],
  ] as const)('%s is unavailable', async (id, params) => {
    useEditorStore.setState({ documentReady: false });
    await refusedWith(runCommand(id, params), /No document is open/, 'unavailable');
    useEditorStore.setState({ documentReady: true });
  });
});
