// @vitest-environment jsdom
import '../../test/canvas-mock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentInfo } from './document';

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

const mocks = vi.hoisted(() => ({ maxSide: 16384 }));

vi.mock('../../engine-wasm/engine-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine-wasm/engine-state')>();
  return { ...actual, getEngine: () => null };
});

vi.mock('../../engine-wasm/gpu-limits', () => ({ getMaxDocumentSide: () => mocks.maxSide }));

const { useEditorStore } = await import('../../app/editor-store');
const { useUIStore } = await import('../../app/ui-store');
const { useToolSettingsStore } = await import('../../app/tool-settings-store');
const { CommandError } = await import('../command');
const { runCommand } = await import('../registry');
const { docNew, docInfo } = await import('./document');

function readInfo(): DocumentInfo {
  return docInfo.run({}) as DocumentInfo;
}
const { createRectSelection } = await import('../../selection/selection');

function store() {
  return useEditorStore.getState();
}

const realCreateDocument = store().createDocument;

function spyOnCreateDocument() {
  const spy = vi.fn(realCreateDocument);
  useEditorStore.setState({ createDocument: spy });
  return spy;
}

/** What the canvas's first frame does for a new document (useCanvasRendering.ts). */
function renderFirstFrame(): void {
  if (store().undoStack.length === 0) store().pushHistory('New Document');
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

afterEach(() => {
  useEditorStore.setState({ createDocument: realCreateDocument });
  vi.restoreAllMocks();
  vi.useRealTimers();
  mocks.maxSide = 16384;
});

describe('doc.new', () => {
  it('calls createDocument with the params before its first await, and closes the New Document dialog', async () => {
    const create = spyOnCreateDocument();
    useUIStore.getState().openModal({ kind: 'newDocument' });
    const pending = runCommand('doc.new', { width: 320, height: 240, background: 'transparent', colorMode: 'grayscale', dpi: 300 });
    expect(create).toHaveBeenCalledWith(320, 240, true, 'grayscale', 300);
    expect(useUIStore.getState().modal).toBeNull();
    renderFirstFrame();
    await pending;
  });

  it('defaults to a white RGB document at 72 dpi', async () => {
    const create = spyOnCreateDocument();
    const pending = runCommand('doc.new', { width: 10, height: 20 });
    expect(create).toHaveBeenCalledWith(10, 20, false, 'rgb', 72);
    renderFirstFrame();
    await pending;
  });

  it('leaves another kind of modal open', async () => {
    useUIStore.getState().openModal({ kind: 'adjustmentLayerInfo' });
    const pending = runCommand('doc.new', { width: 10, height: 10 });
    expect(useUIStore.getState().modal).not.toBeNull();
    renderFirstFrame();
    await pending;
    useUIStore.getState().closeModal();
  });

  it('resolves only once the "New Document" entry exists, with the layers and the active layer', async () => {
    let isResolved = false;
    const pending = runCommand('doc.new', { width: 64, height: 48 }).then((result) => {
      isResolved = true;
      return result;
    });
    await new Promise((done) => setTimeout(done, 0));
    expect(isResolved).toBe(false);
    renderFirstFrame();
    const result = await pending;
    const doc = store().document;
    expect(result).toEqual({
      width: 64,
      height: 48,
      colorMode: 'rgb',
      layers: doc.layerOrder.map((id) => {
        const layer = doc.layers.find((l) => l.id === id)!;
        return { id, name: layer.name, type: layer.type };
      }),
      activeLayer: doc.activeLayerId,
    });
    expect((result as { layers: { name: string }[] }).layers.map((l) => l.name)).toEqual(['Background', 'Layer 1', 'Project']);
    expect(store().undoStack.map((e) => e.label)).toEqual(['New Document']);
  });

  it('rejects unavailable when no frame pushes the entry in time', async () => {
    vi.useFakeTimers();
    const pending = runCommand('doc.new', { width: 10, height: 10 });
    const caught = rejection(pending);
    await vi.advanceTimersByTimeAsync(10_000);
    const error = await caught;
    expect(error.code).toBe('unavailable');
    expect(error.message).toMatch(/Timed out after 10000 ms waiting for the new document's first frame/);
  });

  it('rejects unavailable when another document replaces it first', async () => {
    const pending = runCommand('doc.new', { width: 10, height: 10 });
    const caught = rejection(pending);
    store().createDocument(20, 20, false);
    const error = await caught;
    expect(error.code).toBe('unavailable');
    expect(error.message).toMatch(/replaced the new one/);
  });

  it('refuses sizes beyond the device limit, naming it, without touching the document', async () => {
    mocks.maxSide = 4096;
    const create = spyOnCreateDocument();
    const error = await rejection(runCommand('doc.new', { width: 4097, height: 100 }));
    expect(error.code).toBe('invalid');
    expect(error.message).toBe("doc.new: width and height must be at most 4096 pixels on this device (its GPU's largest texture), got 4097x100");
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    [{ height: 10 }, /width is required/],
    [{ width: 0, height: 10 }, /width must be an integer from 1 to 16384, got 0/],
    [{ width: 10.5, height: 10 }, /width must be an integer/],
    [{ width: 10, height: 16385 }, /height must be an integer from 1 to 16384/],
    [{ width: 10, height: 10, background: 'black' }, /background must be one of "white", "transparent"/],
    [{ width: 10, height: 10, colorMode: 'indexed' }, /colorMode must be one of "rgb", "grayscale", "cmyk", "lab"/],
    [{ width: 10, height: 10, dpi: 1201 }, /dpi must be an integer from 1 to 1200/],
    [{ width: 10, height: 10, depth: 8 }, /unknown param "depth"/],
  ])('rejects invalid params %j', async (params, message) => {
    const error = await rejection(runCommand('doc.new', params));
    expect(error.code).toBe('invalid');
    expect(error.message).toMatch(message);
  });

  it('is a document command', () => {
    expect(docNew.surface).toBe('document');
  });
});

describe('doc.info', () => {
  beforeEach(() => {
    store().createDocument(200, 100, false, 'rgb', 150);
    renderFirstFrame();
  });

  it('throws unavailable when no document is open', () => {
    useEditorStore.setState({ documentReady: false });
    expect(() => docInfo.run({})).toThrowError(CommandError);
    try {
      docInfo.run({});
    } catch (error) {
      expect((error as InstanceType<typeof CommandError>).code).toBe('unavailable');
    }
    useEditorStore.setState({ documentReady: true });
  });

  it('describes the document, its layers, selection, history, colours and tool', () => {
    useToolSettingsStore.getState().setForegroundColor({ r: 255, g: 0, b: 16, a: 1 });
    useToolSettingsStore.getState().setBackgroundColor({ r: 0, g: 0, b: 255, a: 0.5 });
    useUIStore.getState().setActiveTool('brush');
    const doc = store().document;
    const [bg, layer1, root] = doc.layerOrder;
    store().updateLayerOpacity(layer1!, 0.456);

    const info = readInfo();

    expect(info).toMatchObject({
      name: 'lopsy',
      width: 200,
      height: 100,
      colorMode: 'rgb',
      dpi: 150,
      selection: { active: false, bounds: null },
      history: { undo: ['New Document'], redo: [] },
      foregroundColor: '#ff0010',
      backgroundColor: '#0000ff80',
      activeTool: 'brush',
    });
    expect(info.layers.map((l) => [l.id, l.name, l.type, l.parent, l.isActive, l.isSelected])).toEqual([
      [bg, 'Background', 'raster', root, false, false],
      [layer1, 'Layer 1', 'raster', root, true, true],
      [root, 'Project', 'group', null, false, false],
    ]);
    expect(info.layers[1]).toMatchObject({
      visible: true, locked: false, opacity: 46, blendMode: 'normal', x: 0, y: 0, width: 200, height: 100, hasMask: false,
    });
    expect(info.layers[2]).toMatchObject({ width: null, height: null });
    expect(JSON.parse(JSON.stringify(info))).toEqual(info);
  });

  it('reports an active selection with its bounds', () => {
    const bounds = { x: 10, y: 20, width: 30, height: 40 };
    store().setSelection(bounds, createRectSelection(bounds, 200, 100), 200, 100);
    expect(readInfo().selection).toEqual({ active: true, bounds });
  });

  it('takes no params', async () => {
    const error = await rejection(runCommand('doc.info', { verbose: true }));
    expect(error.code).toBe('invalid');
    expect(error.message).toMatch(/unknown param "verbose"; it takes none/);
  });
});
