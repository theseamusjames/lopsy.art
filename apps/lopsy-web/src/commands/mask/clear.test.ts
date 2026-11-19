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

const mocks = vi.hoisted(() => ({
  engine: null as object | null,
  clearActiveLayerMask: vi.fn(() => true),
}));

vi.mock('../../engine-wasm/engine-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine-wasm/engine-state')>();
  return { ...actual, getEngine: () => mocks.engine };
});
vi.mock('../../app/delete-key', () => ({ clearActiveLayerMask: mocks.clearActiveLayerMask }));

const { useEditorStore } = await import('../../app/editor-store');
const { useUIStore } = await import('../../app/ui-store');
const { CommandError } = await import('../command');
const { runCommand } = await import('../registry');
await import('./clear');

type Layer = ReturnType<typeof useEditorStore.getState>['document']['layers'][number];

function store() {
  return useEditorStore.getState();
}

function giveMask(id: string): void {
  const doc = store().document;
  const mask = { data: Uint8ClampedArray.from([0, 0, 0, 0]), width: 2, height: 2, enabled: true };
  const layers = doc.layers.map((l) => (l.id === id ? ({ ...l, mask } as Layer) : l));
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

beforeEach(() => {
  mocks.engine = null;
  store().createDocument(40, 30, false);
  useUIStore.getState().setMaskEditMode(false);
  mocks.engine = {};
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('mask.clear', () => {
  it('calls the Delete key\'s mask clear in the synchronous part while the mask is being edited', async () => {
    const id = store().document.activeLayerId!;
    giveMask(id);
    useUIStore.getState().setMaskEditMode(true);
    const pending = runCommand('mask.clear');
    expect(mocks.clearActiveLayerMask).toHaveBeenCalledTimes(1);
    expect(await pending).toEqual({ layer: id });
  });

  it('first puts another layer\'s mask in edit mode, as its mask thumbnail does', async () => {
    const background = store().document.layers.find((l) => l.name === 'Background')!.id;
    giveMask(background);
    mocks.clearActiveLayerMask.mockImplementationOnce(() => {
      expect(store().document.activeLayerId).toBe(background);
      expect(useUIStore.getState().maskMode).toBe('layerMask');
      return true;
    });
    expect(await runCommand('mask.clear', { layer: 'Background' })).toEqual({ layer: background });
    expect(mocks.clearActiveLayerMask).toHaveBeenCalledTimes(1);
  });

  it('refuses a layer with no mask, and is unavailable without an engine', async () => {
    expect(await failure(runCommand('mask.clear'))).toMatchObject({ code: 'refused', message: '"Layer 1" has no mask.' });
    giveMask(store().document.activeLayerId!);
    mocks.engine = null;
    expect((await failure(runCommand('mask.clear'))).code).toBe('unavailable');
    expect(mocks.clearActiveLayerMask).not.toHaveBeenCalled();
    expect(useUIStore.getState().maskMode).toBe('off');
  });
});
