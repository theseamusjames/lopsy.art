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
const { useUIStore } = await import('../../app/ui-store');
const { CommandError } = await import('../command');
const { runCommand } = await import('../registry');
await import('./mask');

type Store = ReturnType<typeof useEditorStore.getState>;
type ActionName = 'addLayerMask' | 'removeLayerMask' | 'toggleLayerMask' | 'setActiveLayer' | 'setSelection';
const ACTIONS: ActionName[] = ['addLayerMask', 'removeLayerMask', 'toggleLayerMask', 'setActiveLayer', 'setSelection'];
const real = Object.fromEntries(ACTIONS.map((name) => [name, useEditorStore.getState()[name]])) as Pick<Store, ActionName>;

function store(): Store {
  return useEditorStore.getState();
}

function spyOn<K extends ActionName>(name: K) {
  const spy = vi.fn(real[name] as (...args: unknown[]) => unknown);
  useEditorStore.setState({ [name]: spy } as unknown as Partial<Store>);
  return spy;
}

function layerNamed(name: string) {
  const layer = store().document.layers.find((l) => l.name === name);
  if (!layer) throw new Error(`no layer ${name}`);
  return layer;
}

function labels(): string[] {
  return store().undoStack.map((e) => e.label);
}

function maskMode(): string {
  return useUIStore.getState().maskMode;
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

/** A selection of the doc rectangle (x0,y0)-(x1,y1), exclusive. */
function select(x0: number, y0: number, x1: number, y1: number): void {
  const { width, height } = store().document;
  const inside = (i: number): boolean => {
    const x = i % width;
    const y = Math.floor(i / width);
    return x >= x0 && x < x1 && y >= y0 && y < y1;
  };
  const mask = Uint8ClampedArray.from({ length: width * height }, (_, i) => (inside(i) ? 255 : 0));
  store().setSelection({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, mask, width, height);
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

describe('mask.add', () => {
  it('adds the mask and enters mask edit mode before its first await', async () => {
    const add = spyOn('addLayerMask');
    const id = layerNamed('Layer 1').id;
    const pending = runCommand('mask.add', {});
    expect(add).toHaveBeenCalledWith(id);
    expect(maskMode()).toBe('layerMask');
    expect(await pending).toEqual({ layer: id, hasMask: true, enabled: true, editing: true });
    expect(labels()).toEqual(['New Document', 'Add Mask']);
    expect(layerNamed('Layer 1').mask?.data.every((v) => v === 255)).toBe(true);
  });

  it('reveals only the selection and drops it', async () => {
    select(10, 5, 20, 15);
    await runCommand('mask.add', {});
    const mask = layerNamed('Layer 1').mask!;
    expect(mask.data[7 * mask.width + 12]).toBe(255);
    expect(mask.data[0]).toBe(0);
    expect(store().selection.active).toBe(false);
  });

  it('makes another layer active first, as a row click', async () => {
    const id = layerNamed('Background').id;
    await runCommand('mask.add', { layer: 'Background' });
    expect(store().document.activeLayerId).toBe(id);
    expect(layerNamed('Background').mask).not.toBeNull();
  });

  it('refuses a layer that already has a mask', async () => {
    await runCommand('mask.add', {});
    const add = spyOn('addLayerMask');
    const error = await failure(runCommand('mask.add', {}));
    expect(error.code).toBe('refused');
    expect(error.message).toBe('"Layer 1" already has a mask: the Add Mask button is hidden while the active layer has one.');
    expect(add).not.toHaveBeenCalled();
  });
});

describe('mask.remove', () => {
  it('removes the mask and leaves mask edit mode before its first await', async () => {
    await runCommand('mask.add', {});
    const remove = spyOn('removeLayerMask');
    const id = layerNamed('Layer 1').id;
    const pending = runCommand('mask.remove', {});
    expect(remove).toHaveBeenCalledWith(id);
    expect(maskMode()).toBe('off');
    expect(await pending).toEqual({ layer: id, hasMask: false, enabled: null, editing: false });
    expect(labels()).toEqual(['New Document', 'Add Mask', 'Remove Mask']);
  });

  it('refuses a layer with no mask', async () => {
    const error = await failure(runCommand('mask.remove', { layer: 'Background' }));
    expect(error.message).toBe('"Background" has no mask.');
  });
});

describe('mask.set-enabled', () => {
  it('toggles the mask only when it is not already in the requested state', async () => {
    await runCommand('mask.add', {});
    const toggle = spyOn('toggleLayerMask');
    const pending = runCommand('mask.set-enabled', { enabled: false });
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(await pending).toMatchObject({ enabled: false });
    await runCommand('mask.set-enabled', { enabled: false });
    expect(toggle).toHaveBeenCalledTimes(1);
    await runCommand('mask.set-enabled', { enabled: true });
    expect(labels()).toEqual(['New Document', 'Add Mask', 'Toggle Mask', 'Toggle Mask']);
    expect(layerNamed('Layer 1').mask?.enabled).toBe(true);
  });

  it('refuses a layer with no mask, and requires enabled', async () => {
    expect((await failure(runCommand('mask.set-enabled', { enabled: true }))).message).toBe('"Layer 1" has no mask.');
    expect((await failure(runCommand('mask.set-enabled', {}))).code).toBe('invalid');
  });
});

describe('mask.edit', () => {
  it('enters mask edit mode on the layer, making it active, as the mask thumbnail does', async () => {
    await runCommand('mask.add', { layer: 'Background' });
    store().setActiveLayer(layerNamed('Layer 1').id);
    useUIStore.getState().setMaskEditMode(false);
    const activate = spyOn('setActiveLayer');
    const id = layerNamed('Background').id;
    const pending = runCommand('mask.edit', { layer: 'Background', enabled: true });
    expect(activate).toHaveBeenCalledWith(id);
    expect(maskMode()).toBe('layerMask');
    expect(await pending).toEqual({ layer: id, hasMask: true, enabled: true, editing: true });
    expect(labels()).toEqual(['New Document', 'Add Mask']);
  });

  it('leaves mask edit mode as a row click does', async () => {
    await runCommand('mask.add', {});
    const result = await runCommand('mask.edit', { enabled: false });
    expect(maskMode()).toBe('off');
    expect(result).toMatchObject({ hasMask: true, editing: false });
    expect(store().document.selectedLayerIds).toEqual([layerNamed('Layer 1').id]);
  });

  it('refuses to edit a mask that is not there', async () => {
    const error = await failure(runCommand('mask.edit', { enabled: true }));
    expect(error.message).toBe('"Layer 1" has no mask.');
    expect(maskMode()).toBe('off');
  });
});

describe('mask.to-selection', () => {
  it('selects what the mask hides and leaves mask edit mode, before its first await', async () => {
    select(10, 5, 20, 15);
    await runCommand('mask.add', {});
    const setSelection = spyOn('setSelection');
    const pending = runCommand('mask.to-selection', {});
    expect(setSelection).toHaveBeenCalledTimes(1);
    expect(maskMode()).toBe('off');
    expect(await pending).toEqual({ selection: { x: 0, y: 0, width: 40, height: 30 }, editing: false });
    const { selection, document } = store();
    expect(selection.mask?.[7 * document.width + 12]).toBe(0);
    expect(selection.mask?.[0]).toBe(255);
  });

  it('leaves the selection alone when the mask hides nothing', async () => {
    await runCommand('mask.add', {});
    expect(await runCommand('mask.to-selection', {})).toEqual({ selection: null, editing: false });
  });

  it('refuses a layer with no mask', async () => {
    expect((await failure(runCommand('mask.to-selection', {}))).message).toBe('"Layer 1" has no mask.');
  });
});
