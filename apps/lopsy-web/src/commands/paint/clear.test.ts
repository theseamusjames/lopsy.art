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
  clearSelectedLayerPixels: vi.fn((..._args: unknown[]) => true),
}));

vi.mock('../../engine-wasm/engine-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine-wasm/engine-state')>();
  return { ...actual, getEngine: () => mocks.engine };
});
vi.mock('../../app/delete-key', () => ({ clearSelectedLayerPixels: mocks.clearSelectedLayerPixels }));

const { useEditorStore } = await import('../../app/editor-store');
const { useUIStore } = await import('../../app/ui-store');
const { CommandError } = await import('../command');
const { runCommand } = await import('../registry');
await import('./clear');

type Layer = ReturnType<typeof useEditorStore.getState>['document']['layers'][number];

function store() {
  return useEditorStore.getState();
}

function patchActive(patch: Record<string, unknown>): void {
  const doc = store().document;
  const layers = doc.layers.map((l) => (l.id === doc.activeLayerId ? ({ ...l, ...patch } as Layer) : l));
  useEditorStore.setState({ document: { ...doc, layers } });
}

function select(): Uint8ClampedArray {
  const mask = Uint8ClampedArray.from({ length: 40 * 30 }, () => 255);
  useEditorStore.setState({ selection: { active: true, bounds: { x: 0, y: 0, width: 40, height: 30 }, mask, maskWidth: 40, maskHeight: 30 } });
  return mask;
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
  mocks.engine = null;
  store().createDocument(40, 30, false);
  useUIStore.getState().setMaskEditMode(false);
  mocks.engine = {};
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('paint.clear', () => {
  it('calls the Delete key\'s clear in the synchronous part with the layer and the selection mask', async () => {
    const mask = select();
    const id = store().document.activeLayerId;
    const pending = runCommand('paint.clear');
    expect(mocks.clearSelectedLayerPixels).toHaveBeenCalledWith(id, mask);
    expect(await pending).toEqual({ layer: id });
  });

  it('clears a locked layer, as the key does', async () => {
    select();
    patchActive({ locked: true });
    await runCommand('paint.clear');
    expect(mocks.clearSelectedLayerPixels).toHaveBeenCalledTimes(1);
  });

  it('refuses with no selection, where the key removes the layer', async () => {
    const error = await failure(runCommand('paint.clear'));
    expect([error.code, error.notice]).toEqual(['refused', null]);
    expect(error.message).toMatch(/^Nothing is selected: .*layer\.remove/);
    expect(mocks.clearSelectedLayerPixels).not.toHaveBeenCalled();
  });

  it('refuses in mask edit mode on a layer with a mask, where the key clears the mask', async () => {
    select();
    patchActive({ mask: MASK });
    useUIStore.getState().setMaskEditMode(true);
    expect((await failure(runCommand('paint.clear'))).message).toMatch(/is in mask edit mode, .*use mask\.clear/);
    expect(mocks.clearSelectedLayerPixels).not.toHaveBeenCalled();
  });

  it('refuses when the clear did not happen', async () => {
    select();
    mocks.clearSelectedLayerPixels.mockReturnValueOnce(false);
    expect((await failure(runCommand('paint.clear'))).code).toBe('refused');
  });

  it('is unavailable without an engine', async () => {
    select();
    mocks.engine = null;
    expect((await failure(runCommand('paint.clear'))).code).toBe('unavailable');
    expect(mocks.clearSelectedLayerPixels).not.toHaveBeenCalled();
  });
});
