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
  encodeCompositeImage: vi.fn(),
  encodeImageData: vi.fn(),
  readCompositeThumbnail: vi.fn(),
  sampleColor: vi.fn(),
  getLayerTextureDimensions: vi.fn(),
  readLayerAsImageData: vi.fn(),
  readLayerThumbnail: vi.fn(),
}));

vi.mock('../../engine-wasm/engine-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine-wasm/engine-state')>();
  return { ...actual, getEngine: () => mocks.engine };
});
vi.mock('../../engine-wasm/wasm-bridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine-wasm/wasm-bridge')>();
  return {
    ...actual,
    readCompositeThumbnail: mocks.readCompositeThumbnail,
    sampleColor: mocks.sampleColor,
    getLayerTextureDimensions: mocks.getLayerTextureDimensions,
  };
});
vi.mock('../../engine-wasm/gpu-pixel-access', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine-wasm/gpu-pixel-access')>();
  return { ...actual, readLayerAsImageData: mocks.readLayerAsImageData, readLayerThumbnail: mocks.readLayerThumbnail };
});
vi.mock('../../io/export-image', () => ({
  encodeCompositeImage: mocks.encodeCompositeImage,
  encodeImageData: mocks.encodeImageData,
}));

const { useEditorStore } = await import('../../app/editor-store');
const { useToolSettingsStore } = await import('../../app/tool-settings-store');
const { CommandError } = await import('../command');
const { runCommand } = await import('../registry');
const { viewRender, viewRenderLayer, viewSample, MAX_RENDER_SIDE } = await import('./view');

function store() {
  return useEditorStore.getState();
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

const PNG = { bytes: new Uint8Array([137, 80, 78, 71]), mime: 'image/png', ext: 'png', width: 0, height: 0 };

function thumbnail(width: number, height: number): Uint8Array {
  const data = new Uint8Array(8 + width * height * 4).fill(9);
  new DataView(data.buffer).setUint32(0, width, true);
  new DataView(data.buffer).setUint32(4, height, true);
  return data;
}

function rgba(width: number, height: number): { data: Uint8Array; width: number; height: number } {
  return { data: new Uint8Array(width * height * 4).fill(7), width, height };
}

beforeEach(() => {
  mocks.engine = null;
  store().createDocument(400, 200, false);
  mocks.engine = {};
  mocks.encodeCompositeImage.mockImplementation(() => Promise.resolve({ ...PNG, width: 400, height: 200 }));
  mocks.encodeImageData.mockImplementation((image: ImageData) => Promise.resolve({ ...PNG, width: image.width, height: image.height }));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('the view commands settle before they read', () => {
  it('declares settles: before', () => {
    expect([viewRender.settles, viewRenderLayer.settles, viewSample.settles]).toEqual(['before', 'before', 'before']);
  });
});

describe('view.render', () => {
  it('encodes the full export composite as PNG, without the export pre-steps, when the document fits', async () => {
    const result = await runCommand('view.render');
    expect(mocks.encodeCompositeImage).toHaveBeenCalledWith(mocks.engine, { format: 'png', quality: 100, highQuality: false });
    expect(result).toEqual({ mime: 'image/png', width: 400, height: 200, base64: btoa(String.fromCharCode(...PNG.bytes)) });
  });

  it('reads the composite thumbnail when maxSize is smaller than the document', async () => {
    mocks.readCompositeThumbnail.mockResolvedValue(thumbnail(100, 50));
    const result = (await runCommand('view.render', { maxSize: 100 })) as { width: number; height: number };
    expect(mocks.readCompositeThumbnail).toHaveBeenCalledWith(mocks.engine, 100);
    expect(mocks.encodeCompositeImage).not.toHaveBeenCalled();
    const [image, format] = mocks.encodeImageData.mock.calls[0]! as [ImageData, string];
    expect({ width: image.width, height: image.height, format, first: image.data[0] }).toEqual({ width: 100, height: 50, format: 'png', first: 9 });
    expect({ width: result.width, height: result.height }).toEqual({ width: 100, height: 50 });
  });

  it(`caps an omitted maxSize at ${MAX_RENDER_SIDE}`, async () => {
    mocks.engine = null;
    store().createDocument(8000, 100, false);
    mocks.engine = {};
    mocks.readCompositeThumbnail.mockResolvedValue(thumbnail(4096, 51));
    await runCommand('view.render');
    expect(mocks.readCompositeThumbnail).toHaveBeenCalledWith(mocks.engine, MAX_RENDER_SIDE);
  });

  it('leaves history, the dirty flag and the selection alone', async () => {
    const before = { undo: store().undoStack.length, dirty: store().isDirty, selection: store().selection };
    await runCommand('view.render');
    expect({ undo: store().undoStack.length, dirty: store().isDirty, selection: store().selection }).toEqual(before);
  });

  it('rejects maxSize out of range, other formats, no engine and an empty composite', async () => {
    expect((await failure(runCommand('view.render', { maxSize: 0 }))).code).toBe('invalid');
    expect((await failure(runCommand('view.render', { maxSize: MAX_RENDER_SIDE + 1 }))).code).toBe('invalid');
    expect((await failure(runCommand('view.render', { format: 'jpeg' }))).code).toBe('invalid');
    mocks.encodeCompositeImage.mockResolvedValueOnce(null);
    expect((await failure(runCommand('view.render'))).code).toBe('unavailable');
    mocks.engine = null;
    expect((await failure(runCommand('view.render'))).code).toBe('unavailable');
  });
});

describe('view.render-layer', () => {
  function layerNamed(name: string) {
    const layer = store().document.layers.find((l) => l.name === name);
    if (!layer) throw new Error(`no ${name}`);
    return layer;
  }

  it('reads the full texture when it fits and reports where the layer sits', async () => {
    mocks.getLayerTextureDimensions.mockReturnValue(new Uint32Array([400, 200]));
    mocks.readLayerAsImageData.mockResolvedValue(rgba(400, 200));
    const layer = layerNamed('Layer 1');
    const result = (await runCommand('view.render-layer', { layer: 'Layer 1' })) as Record<string, unknown>;
    expect(mocks.readLayerAsImageData).toHaveBeenCalledWith(layer.id);
    expect(result).toMatchObject({ mime: 'image/png', width: 400, height: 200, x: layer.x, y: layer.y });
  });

  it('reads a thumbnail when maxSize is smaller than the texture', async () => {
    mocks.getLayerTextureDimensions.mockReturnValue(new Uint32Array([400, 200]));
    mocks.readLayerThumbnail.mockResolvedValue(rgba(40, 20));
    const result = (await runCommand('view.render-layer', { maxSize: 40 })) as { width: number };
    expect(mocks.readLayerThumbnail).toHaveBeenCalledWith(store().document.activeLayerId, 40);
    expect(result.width).toBe(40);
  });

  it('is refused for a group and an empty texture, and not-found for an unknown layer', async () => {
    expect(await failure(runCommand('view.render-layer', { layer: 'Project' }))).toMatchObject({
      code: 'refused',
      message: '"Project" is a group: it has no pixels of its own.',
    });
    mocks.getLayerTextureDimensions.mockReturnValue(new Uint32Array([0, 0]));
    expect(await failure(runCommand('view.render-layer'))).toMatchObject({ code: 'refused', message: '"Layer 1" has no pixels.' });
    expect((await failure(runCommand('view.render-layer', { layer: 'Nope' }))).code).toBe('not-found');
  });
});

describe('view.sample', () => {
  it('samples one composite pixel as the Eyedropper does and leaves the foreground', async () => {
    mocks.sampleColor.mockResolvedValue(new Uint8Array([10, 20, 30, 128]));
    const foreground = useToolSettingsStore.getState().foregroundColor;
    const result = await runCommand('view.sample', { x: 12, y: 7 });
    expect(mocks.sampleColor).toHaveBeenCalledWith(mocks.engine, 12, 7, 1);
    expect(result).toEqual({ hex: '#0a141e', alpha: 128 / 255 });
    expect(useToolSettingsStore.getState().foregroundColor).toEqual(foreground);
  });

  it('is unavailable when the engine answers short, and rejects fractional points', async () => {
    mocks.sampleColor.mockResolvedValue(new Uint8Array(0));
    expect((await failure(runCommand('view.sample', { x: 1, y: 1 }))).code).toBe('unavailable');
    expect((await failure(runCommand('view.sample', { x: 1.5, y: 1 }))).code).toBe('invalid');
  });
});
