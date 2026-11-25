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

const mocks = vi.hoisted(() => ({
  duringAwait: () => {},
  encodeBlob: vi.fn(),
  engine: null as object | null,
}));

vi.mock('../engine-wasm/engine-state', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../engine-wasm/engine-state')>()),
  getEngine: () => mocks.engine,
}));
vi.mock('../engine-wasm/engine-sync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../engine-wasm/engine-sync')>()),
  flushLayerSync: () => {},
}));
vi.mock('../engine-wasm/gpu-pixel-access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../engine-wasm/gpu-pixel-access')>()),
  readLayerBackupBlob: () => {
    mocks.duringAwait();
    return Promise.resolve(null);
  },
}));
vi.mock('../engine-wasm/wasm-bridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../engine-wasm/wasm-bridge')>()),
  getLayerTextureDimensions: () => [0, 0],
  exportPsd: () => {
    mocks.duringAwait();
    return Promise.resolve(new Uint8Array([1, 2, 3]));
  },
}));
vi.mock('../app/interactions/pending-stroke', () => ({ finalizePendingStrokeGlobal: () => {} }));
vi.mock('../app/interactions/layer-transform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../app/interactions/layer-transform')>()),
  commitLayerTransform: () => {},
}));
vi.mock('./export-image', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./export-image')>()),
  encodeDocumentImageBlob: mocks.encodeBlob,
}));

const { useEditorStore } = await import('../app/editor-store');
const { saveProject } = await import('./project-save');
const { exportPsdFile } = await import('./psd');
const { exportCanvas } = await import('../app/MenuBar/menus/file-menu');

const downloads: Array<{ name: string; blob: unknown }> = [];
const blobsByUrl = new Map<string, unknown>();

function renameDocument(name: string): void {
  const state = useEditorStore.getState();
  useEditorStore.setState({ document: { ...state.document, name } });
}

beforeEach(() => {
  downloads.length = 0;
  blobsByUrl.clear();
  mocks.duringAwait = () => {};
  mocks.engine = null;
  useEditorStore.getState().createDocument(4, 4, false);
  mocks.engine = {};
  renameDocument('Before');
  let next = 0;
  URL.createObjectURL = (blob: Blob) => {
    const url = `blob:test/${next++}`;
    blobsByUrl.set(url, blob);
    return url;
  };
  URL.revokeObjectURL = () => {};
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ name: this.download, blob: blobsByUrl.get(this.getAttribute('href') ?? '') });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the download name', () => {
  it('Save Project names the file after the document as it was when the save read it, not after its awaits', async () => {
    mocks.duringAwait = () => renameDocument('Renamed meanwhile');
    await saveProject();
    expect(downloads.map((d) => d.name)).toEqual(['Before.lopsy']);
  });

  it('Export PSD names the file after the document as it was when the export read it, not after its awaits', async () => {
    mocks.duringAwait = () => renameDocument('Renamed meanwhile');
    await exportPsdFile(16);
    expect(downloads.map((d) => d.name)).toEqual(['Before.psd']);
  });
});

describe('image export download', () => {
  it('hands the encoded Blob itself to the download, with no copy in between, and marks the document clean then', async () => {
    const blob = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
    mocks.encodeBlob.mockResolvedValue({ blob, mime: 'image/png', ext: 'png', width: 4, height: 4 });
    useEditorStore.setState({ isDirty: true });
    exportCanvas('png');
    await vi.waitFor(() => expect(downloads).toHaveLength(1));
    expect(downloads[0]).toEqual({ name: 'Before.png', blob });
    expect(downloads[0]?.blob).toBe(blob);
    expect(useEditorStore.getState().isDirty).toBe(false);
  });
});
