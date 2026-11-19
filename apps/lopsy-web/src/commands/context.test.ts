// @vitest-environment jsdom
import '../test/canvas-mock';
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

const mocks = vi.hoisted(() => ({ engine: null as object | null, isContextLost: false }));

vi.mock('../engine-wasm/engine-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../engine-wasm/engine-state')>();
  return { ...actual, getEngine: () => mocks.engine, isGpuContextLost: () => mocks.isContextLost };
});

const { useEditorStore } = await import('../app/editor-store');
const { CommandError } = await import('./command');
const { MAX_ENCODED_BYTES, decodeBase64, encodeBase64, gpuContextPreflight, layerSummary, requireDocument, requireEngine, resolveLayer, waitForEditorState } = await import('./context');

function store() {
  return useEditorStore.getState();
}

function caught(fn: () => unknown): InstanceType<typeof CommandError> {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(CommandError);
    return error as InstanceType<typeof CommandError>;
  }
  throw new Error('expected a throw');
}

beforeEach(() => {
  store().createDocument(40, 30, false);
});

afterEach(() => {
  mocks.engine = null;
  vi.useRealTimers();
});

describe('requireDocument / requireEngine', () => {
  it('returns the open document, or throws unavailable', () => {
    expect(requireDocument()).toBe(store().document);
    useEditorStore.setState({ documentReady: false });
    expect(caught(requireDocument).code).toBe('unavailable');
    useEditorStore.setState({ documentReady: true });
  });

  it('returns the engine, or throws unavailable', () => {
    expect(caught(requireEngine).code).toBe('unavailable');
    mocks.engine = {};
    expect(requireEngine()).toBe(mocks.engine);
  });

  it('does not look at the graphics context: the UI still runs its function while it is lost', () => {
    mocks.engine = {};
    mocks.isContextLost = true;
    expect(requireEngine()).toBe(mocks.engine);
    mocks.isContextLost = false;
  });
});

describe('gpuContextPreflight', () => {
  it('refuses unavailable while an engine exists and its graphics context is lost', () => {
    mocks.engine = {};
    mocks.isContextLost = true;
    const error = caught(gpuContextPreflight);
    mocks.isContextLost = false;
    expect(error.code).toBe('unavailable');
    expect(error.message).toContain('graphics context is lost');
  });

  it('lets calls through before any engine exists, where there is no context to lose', () => {
    mocks.engine = null;
    mocks.isContextLost = true;
    expect(() => gpuContextPreflight()).not.toThrow();
    mocks.isContextLost = false;
    mocks.engine = {};
    expect(() => gpuContextPreflight()).not.toThrow();
  });
});

describe('resolveLayer', () => {
  it('resolves the active layer, an id, or a unique name', () => {
    const doc = store().document;
    const bg = doc.layers.find((l) => l.name === 'Background')!;
    expect(resolveLayer().id).toBe(doc.activeLayerId);
    expect(resolveLayer(bg.id)).toBe(bg);
    expect(resolveLayer('Background')).toBe(bg);
  });

  it('is invalid for a name several layers share, listing their ids', () => {
    const doc = store().document;
    const layer1 = doc.layers.find((l) => l.name === 'Layer 1')!;
    const bg = doc.layers.find((l) => l.name === 'Background')!;
    store().renameLayer(bg.id, 'Layer 1');
    const error = caught(() => resolveLayer('Layer 1'));
    expect(error.code).toBe('invalid');
    expect(error.message).toContain(bg.id);
    expect(error.message).toContain(layer1.id);
  });

  it('is not-found for a ref that matches nothing, or with no active layer', () => {
    expect(caught(() => resolveLayer('Nope')).code).toBe('not-found');
    useEditorStore.setState({ document: { ...store().document, activeLayerId: null } });
    expect(caught(() => resolveLayer()).code).toBe('not-found');
  });
});

describe('layerSummary', () => {
  it('is the id, name and type', () => {
    const layer = store().document.layers[0]!;
    expect(layerSummary(layer)).toEqual({ id: layer.id, name: layer.name, type: layer.type });
  });
});

describe('waitForEditorState', () => {
  it('resolves at once when the state is already ready', async () => {
    await expect(waitForEditorState(() => true, { timeoutMs: 10, waitingFor: 'x' })).resolves.toBeUndefined();
  });

  it('resolves on the store change that makes it ready', async () => {
    const pending = waitForEditorState((s) => s.undoStack.length > 0, { timeoutMs: 1000, waitingFor: 'x' });
    store().pushHistory('Edit');
    await expect(pending).resolves.toBeUndefined();
  });

  it('rejects unavailable on timeout, saying what it waited for', async () => {
    vi.useFakeTimers();
    const pending = waitForEditorState(() => false, { timeoutMs: 500, waitingFor: 'the moon' });
    const assertion = expect(pending).rejects.toMatchObject({
      code: 'unavailable',
      message: 'Timed out after 500 ms waiting for the moon.',
    });
    await vi.advanceTimersByTimeAsync(500);
    await assertion;
  });
});

describe('base64', () => {
  it('round-trips bytes, including runs longer than one encode chunk', () => {
    const bytes = new Uint8Array(70_000).map((_, i) => (i * 31) % 256);
    expect(decodeBase64('x.op', 'base64', encodeBase64(bytes))).toEqual(bytes);
    expect(encodeBase64(new Uint8Array([0, 255, 128]))).toBe('AP+A');
  });

  it('accepts missing padding and line breaks', () => {
    expect(decodeBase64('x.op', 'base64', 'AP+A\nAP8')).toEqual(new Uint8Array([0, 255, 128, 0, 255]));
  });

  it('rejects anything that is not base64, or decodes to nothing, as invalid naming the param', () => {
    for (const bad of ['not*base64', 'A', '====', 'AB=C', '']) {
      try {
        decodeBase64('doc.open', 'base64', bad);
        throw new Error(`accepted ${bad}`);
      } catch (error) {
        expect(error).toBeInstanceOf(CommandError);
        expect((error as InstanceType<typeof CommandError>).message).toBe('doc.open: base64 is not valid base64');
      }
    }
  });
});

describe('encodeBase64 size limit', () => {
  it('refuses a file too large for one base64 string before encoding any of it', () => {
    const subarray = vi.fn();
    const huge = { length: MAX_ENCODED_BYTES + 1, subarray } as unknown as Uint8Array;
    const error = caught(() => encodeBase64(huge));
    expect(error.code).toBe('refused');
    expect(error.message).toMatch(/^The file is 192\.0 MiB, more than the 192\.0 MiB a command can return as base64: use view\.render with maxSize/);
    expect(subarray).not.toHaveBeenCalled();
  });
});
