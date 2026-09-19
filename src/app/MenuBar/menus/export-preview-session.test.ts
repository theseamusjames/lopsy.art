// @vitest-environment jsdom
import '../../../test/canvas-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// jsdom doesn't implement canvas.toBlob (it needs the `canvas` npm
// package). The encode path only cares that a Blob comes back; stub
// toBlob to resolve with an empty Blob so the tests can measure how
// many times the composite runs, not the encode itself.
if (!('toBlob' in HTMLCanvasElement.prototype) ||
    (HTMLCanvasElement.prototype as unknown as { toBlob: unknown }).toBlob === undefined) {
  Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', {
    configurable: true,
    writable: true,
    value: function toBlobStub(this: HTMLCanvasElement, cb: (b: Blob | null) => void) {
      cb(new Blob(['x'], { type: 'image/png' }));
    },
  });
} else {
  (HTMLCanvasElement.prototype as unknown as { toBlob: (cb: (b: Blob | null) => void) => void }).toBlob =
    function toBlobStub(cb: (b: Blob | null) => void) {
      cb(new Blob(['x'], { type: 'image/png' }));
    };
}

if (typeof URL.createObjectURL !== 'function') {
  (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = () => 'blob:stub';
  (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = () => {};
}

// A pretend engine — the tests don't need a real one, just the object
// identity that `getEngine()` returns.
const fakeEngine = {} as unknown as import('../../../engine-wasm/wasm-bridge').Engine;

const compositeForExportMock = vi.fn(() => new Uint8Array(64 * 64 * 4).fill(200));
const getCompositeSizeMock = vi.fn(() => new Int32Array([64, 64]));
const flushLayerSyncMock = vi.fn();
const finalizePendingStrokeGlobalMock = vi.fn();
const getEngineMock = vi.fn(() => fakeEngine);
const useEditorStoreMock = {
  getState: () => ({
    document: { name: 'test', layers: [], layerOrder: [] },
    dirtyLayerIds: new Set(),
    markClean: vi.fn(),
  }),
};

vi.mock('../../../engine-wasm/engine-state', () => ({
  getEngine: getEngineMock,
}));

vi.mock('../../../engine-wasm/wasm-bridge', () => ({
  compositeForExport: compositeForExportMock,
  getCompositeSize: getCompositeSizeMock,
  buildIccProfile: vi.fn(),
  convertP3ToSrgb: vi.fn((x: Uint8Array) => x),
  exportPng16: vi.fn(),
}));

vi.mock('../../../engine-wasm/engine-sync', () => ({
  flushLayerSync: flushLayerSyncMock,
}));

vi.mock('../../interactions/pending-stroke', () => ({
  finalizePendingStrokeGlobal: finalizePendingStrokeGlobalMock,
}));

vi.mock('../../editor-store', () => ({
  useEditorStore: useEditorStoreMock,
}));

vi.mock('../../notifications-store', () => ({
  notifyError: vi.fn(),
  describeError: (err: unknown) => String(err),
}));

vi.mock('../../../io/psd', () => ({
  exportPsdFile: vi.fn(),
  importPsdFile: vi.fn(),
}));

vi.mock('../../../io/dng', () => ({
  importDngFile: vi.fn(),
}));

vi.mock('../../../io/raf', () => ({
  importRafFile: vi.fn(),
}));

vi.mock('../../../io/project-save', () => ({ saveProject: vi.fn() }));
vi.mock('../../../io/project-load', () => ({ loadProject: vi.fn() }));

vi.mock('../../../engine/color-space', () => ({
  contextOptions: {},
  canvasColorSpace: 'srgb',
  isWideGamut: () => false,
  createImageDataFromArray: (data: Uint8ClampedArray, w: number, h: number) => ({ data, width: w, height: h }),
}));

vi.mock('../../../engine/bitmap-cache', () => ({
  seedBitmapFromBlob: vi.fn(),
}));

vi.mock('../../../utils/image-metadata', () => ({
  addPngMetadata: vi.fn(async (b: Blob) => b),
  addJpegComment: vi.fn(async (b: Blob) => b),
}));

vi.mock('../../../utils/bmp-encoder', () => ({
  encodeBMP: vi.fn(),
}));

// canvas.toBlob is patched by src/test/canvas-mock — it resolves to a valid
// Blob so the encode() promise resolves without needing a real 2D context.

const { createExportPreviewSession } = await import('./file-menu');

/**
 * Issue #762 — Export dialog re-composited the whole document on every
 * format click and Quality-slider pause. `createExportPreviewSession`
 * composites once per open; format/quality changes only re-run toBlob
 * on the cached thumbnail.
 */
describe('createExportPreviewSession — cached preview thumbnail (#762)', () => {
  beforeEach(() => {
    compositeForExportMock.mockClear();
    getCompositeSizeMock.mockClear();
    flushLayerSyncMock.mockClear();
    finalizePendingStrokeGlobalMock.mockClear();
  });

  it('composites exactly once per session', async () => {
    const session = createExportPreviewSession();
    expect(session).not.toBeNull();
    expect(compositeForExportMock).toHaveBeenCalledTimes(1);

    // Re-encoding at different format/quality must not re-composite.
    await session!.encode({ format: 'png', quality: 100, highQuality: false, filename: 'f' });
    await session!.encode({ format: 'jpeg', quality: 92, highQuality: false, filename: 'f' });
    await session!.encode({ format: 'jpeg', quality: 60, highQuality: false, filename: 'f' });
    await session!.encode({ format: 'webp', quality: 80, highQuality: false, filename: 'f' });
    await session!.encode({ format: 'bmp', quality: 100, highQuality: false, filename: 'f' });

    expect(compositeForExportMock).toHaveBeenCalledTimes(1);
  });

  it('starts a fresh session with a fresh composite', () => {
    const s1 = createExportPreviewSession();
    expect(s1).not.toBeNull();
    expect(compositeForExportMock).toHaveBeenCalledTimes(1);

    const s2 = createExportPreviewSession();
    expect(s2).not.toBeNull();
    expect(compositeForExportMock).toHaveBeenCalledTimes(2);
  });

  it('returns null when the engine is unavailable', () => {
    getEngineMock.mockReturnValueOnce(null as unknown as typeof fakeEngine);
    const session = createExportPreviewSession();
    expect(session).toBeNull();
    expect(compositeForExportMock).not.toHaveBeenCalled();
  });

  it('returns null when the composite has zero size', () => {
    getCompositeSizeMock.mockReturnValueOnce(new Int32Array([0, 0]));
    const session = createExportPreviewSession();
    expect(session).toBeNull();
    // getCompositeSize was consulted, but the composite was never asked for.
    expect(compositeForExportMock).not.toHaveBeenCalled();
  });
});
