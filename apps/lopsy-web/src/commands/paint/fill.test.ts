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

const engine = { current: {} as unknown };
vi.mock('../../engine-wasm/engine-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine-wasm/engine-state')>();
  return { ...actual, getEngine: () => engine.current };
});

const fillSelection = vi.fn();
vi.mock('../../app/fill-selection', () => ({ fillSelection }));

const { useEditorStore } = await import('../../app/editor-store');
const { useUIStore } = await import('../../app/ui-store');
const { CommandError } = await import('../command');
const { runCommand } = await import('../registry');
await import('./fill');

type Layer = ReturnType<typeof useEditorStore.getState>['document']['layers'][number];

function store() {
  return useEditorStore.getState();
}

function activeLayer(): Layer {
  const doc = store().document;
  const layer = doc.layers.find((l) => l.id === doc.activeLayerId);
  if (!layer) throw new Error('no active layer');
  return layer;
}

function patchActive(patch: Record<string, unknown>): void {
  const doc = store().document;
  const layers = doc.layers.map((l) => (l.id === doc.activeLayerId ? ({ ...l, ...patch } as Layer) : l));
  useEditorStore.setState({ document: { ...doc, layers } });
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

const MASK = { data: Uint8ClampedArray.from([0, 0, 0, 0]), width: 2, height: 2, enabled: true };

beforeEach(() => {
  engine.current = null;
  fillSelection.mockClear();
  store().createDocument(40, 30, false);
  engine.current = {};
  useUIStore.getState().setMaskEditMode(false);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('paint.fill', () => {
  it('calls Edit > Fill\'s fillSelection in the synchronous part and reports the pixels target', async () => {
    const id = activeLayer().id;
    const pending = runCommand('paint.fill');
    expect(fillSelection).toHaveBeenCalledTimes(1);
    expect(await pending).toEqual({ layer: id, target: 'pixels' });
  });

  it('reports the mask target in mask edit mode on a layer with a mask', async () => {
    patchActive({ mask: MASK });
    useUIStore.getState().setMaskEditMode(true);
    expect(await runCommand('paint.fill')).toEqual({ layer: activeLayer().id, target: 'mask' });
    expect(fillSelection).toHaveBeenCalledTimes(1);
  });

  it('fills the mask of a text layer in mask edit mode, as the menu does', async () => {
    patchActive({ type: 'text', mask: MASK });
    useUIStore.getState().setMaskEditMode(true);
    expect(await runCommand('paint.fill')).toMatchObject({ target: 'mask' });
  });

  it('refuses a locked layer silently, as the menu returns', async () => {
    patchActive({ locked: true });
    const error = await failure(runCommand('paint.fill'));
    expect(error.code).toBe('refused');
    expect(error.notice).toBeNull();
    expect(error.message).toBe(`"${activeLayer().name}" is locked: unlock it to fill it.`);
    expect(fillSelection).not.toHaveBeenCalled();
  });

  it('refuses a text layer with the text guardPixelWrite toasts', async () => {
    patchActive({ type: 'text' });
    const error = await failure(runCommand('paint.fill'));
    expect([error.code, error.notice, error.message]).toEqual([
      'refused', 'info', 'Text layers must be rasterized before they can be painted on.',
    ]);
    expect(fillSelection).not.toHaveBeenCalled();
  });

  it('refuses a group with the text guardPixelWrite toasts', async () => {
    const rootId = store().document.rootGroupId;
    if (!rootId) throw new Error('no root group');
    useEditorStore.setState({ document: { ...store().document, activeLayerId: rootId } });
    const error = await failure(runCommand('paint.fill'));
    expect([error.code, error.message]).toEqual(['refused', "Groups can't be painted on. Select a layer inside the group."]);
  });

  it('refuses a text layer before the engine starts as Edit > Fill does: the toasted text refusal, not the silent missing engine', async () => {
    engine.current = null;
    patchActive({ type: 'text' });
    const error = await failure(runCommand('paint.fill'));
    expect([error.code, error.notice, error.message]).toEqual(['refused', 'info', 'Text layers must be rasterized before they can be painted on.']);
    expect(fillSelection).not.toHaveBeenCalled();
  });

  it('is unavailable without an engine', async () => {
    engine.current = null;
    expect((await failure(runCommand('paint.fill'))).code).toBe('unavailable');
    expect(fillSelection).not.toHaveBeenCalled();
  });

  it('takes no params', async () => {
    expect((await failure(runCommand('paint.fill', { color: '#fff' }))).code).toBe('invalid');
  });
});
