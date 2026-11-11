import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PathAnchor } from '../../tools/path/path';

const PATCH = { x: 10, y: 20, width: 3, height: 2, data: new Uint8ClampedArray(24) };
const rasterizePath = vi.fn((..._args: unknown[]) => PATCH as typeof PATCH | null);
vi.mock('./path-patch', () => ({
  rasterizePathPatch: (...args: unknown[]) => rasterizePath(...args),
}));

const compositePatchOntoLayer = vi.fn();
vi.mock('../../engine-wasm/wasm-bridge', () => ({
  compositePatchOntoLayer: (...args: unknown[]) => compositePatchOntoLayer(...args),
}));
vi.mock('../../engine-wasm/engine-state', () => ({ getEngine: () => ({ __engine: 'mock' }) }));
const syncLayerAfterFullSize = vi.fn();
vi.mock('../sync-layer-after-full-size', () => ({
  syncLayerAfterFullSize: (...args: unknown[]) => syncLayerAfterFullSize(...args),
}));
const clearJsPixelData = vi.fn();
vi.mock('../store/clear-js-pixel-data', () => ({
  clearJsPixelData: (...args: unknown[]) => clearJsPixelData(...args),
}));

const guardPixelWrite = vi.fn(() => true);
vi.mock('../../layers/paint-target', () => ({
  guardPixelWrite: (...args: unknown[]) => guardPixelWrite(...(args as [])),
}));

interface MockPath { id: string; anchors: PathAnchor[]; closed: boolean }

const editorState = {
  document: {
    activeLayerId: 'layer-1',
    layers: [{ id: 'layer-1', x: 0, y: 0 }],
    width: 800,
    height: 600,
  },
  paths: [] as MockPath[],
  selectedPathId: null as string | null,
  pushHistory: vi.fn(),
  pushHistoryMetadata: vi.fn(),
  addPath: vi.fn((anchors: PathAnchor[], closed: boolean) => {
    setEditor({ paths: [...editorState.paths, { id: 'added', anchors, closed }], selectedPathId: 'added' });
  }),
  getOrCreateLayerPixelData: vi.fn(() => ({})),
  updateLayerPixelData: vi.fn(),
  notifyRender: vi.fn(),
};
type Listener<T> = (state: T, prev: T) => void;
const editorListeners: Array<Listener<typeof editorState>> = [];
vi.mock('../editor-store', () => ({
  useEditorStore: {
    getState: () => editorState,
    subscribe: (l: Listener<typeof editorState>) => { editorListeners.push(l); },
  },
}));

function setEditor(patch: Partial<typeof editorState>): void {
  const prev = { ...editorState };
  Object.assign(editorState, patch);
  for (const l of editorListeners) l(editorState, prev);
}

type Draft = { anchors: PathAnchor[]; closed: boolean } | null;
const uiState = {
  pathDraft: null as Draft,
  clearPath: vi.fn(() => { setDraft(null); }),
};
const uiListeners: Array<Listener<typeof uiState>> = [];
vi.mock('../ui-store', () => ({
  useUIStore: {
    getState: () => uiState,
    subscribe: (l: Listener<typeof uiState>) => { uiListeners.push(l); },
  },
}));

function setDraft(pathDraft: Draft): void {
  const prev = { ...uiState };
  uiState.pathDraft = pathDraft;
  for (const l of uiListeners) l(uiState, prev);
}

const toolSettings = {
  settings: { path: { strokeWidth: 12 } },
  foregroundColor: { r: 200, g: 0, b: 0, a: 1 },
  addRecentColor: vi.fn(),
};
vi.mock('../tool-settings-store', () => ({
  useToolSettingsStore: { getState: () => toolSettings },
}));

import { strokePathOnEnter } from './path-stroke';

const CANVAS = { x: 0, y: 0, width: 800, height: 600 };

function anchor(x: number, y: number): PathAnchor {
  return { point: { x, y }, handleIn: null, handleOut: null };
}

const triangle = [anchor(200, 450), anchor(400, 150), anchor(600, 450)];

describe('strokePathOnEnter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    guardPixelWrite.mockReturnValue(true);
    setDraft(null);
    setEditor({ paths: [], selectedPathId: null });
  });

  it('commits and strokes an in-progress draft (#976)', () => {
    setDraft({ anchors: [...triangle], closed: false });

    strokePathOnEnter();

    expect(editorState.addPath).toHaveBeenCalledWith(triangle, false);
    expect(editorState.pushHistory).toHaveBeenCalledWith('Stroke Path');
    expect(rasterizePath).toHaveBeenCalledWith(triangle, false, toolSettings.foregroundColor, 12, CANVAS);
  });

  it('strokes the selected closed path when no draft is in progress (#1084)', () => {
    editorState.paths = [{ id: 'p1', anchors: [...triangle], closed: true }];
    editorState.selectedPathId = 'p1';

    strokePathOnEnter();

    expect(editorState.addPath).not.toHaveBeenCalled();
    expect(editorState.pushHistory).toHaveBeenCalledWith('Stroke Path');
    expect(rasterizePath).toHaveBeenCalledWith(triangle, true, toolSettings.foregroundColor, 12, CANVAS);
  });

  it('rasterizes the path in document space whatever the layer offset', () => {
    editorState.document.layers = [{ id: 'layer-1', x: 50, y: 20 }];
    editorState.paths = [{ id: 'p1', anchors: [anchor(100, 100), anchor(200, 100)], closed: false }];
    editorState.selectedPathId = 'p1';

    strokePathOnEnter();

    expect(rasterizePath).toHaveBeenCalledWith(
      [anchor(100, 100), anchor(200, 100)],
      false,
      toolSettings.foregroundColor,
      12,
      CANVAS,
    );
    editorState.document.layers = [{ id: 'layer-1', x: 0, y: 0 }];
  });

  it('composites only the stroke patch on the GPU, without touching JS pixel buffers (#1292)', () => {
    editorState.paths = [{ id: 'p1', anchors: [...triangle], closed: true }];
    editorState.selectedPathId = 'p1';

    strokePathOnEnter();

    expect(compositePatchOntoLayer).toHaveBeenCalledTimes(1);
    const [, layerId, bytes, x, y, w, h] = compositePatchOntoLayer.mock.calls[0]!;
    expect([layerId, x, y, w, h]).toEqual(['layer-1', 10, 20, 3, 2]);
    expect((bytes as Uint8Array).byteLength).toBe(24);
    expect(editorState.getOrCreateLayerPixelData).not.toHaveBeenCalled();
    expect(editorState.updateLayerPixelData).not.toHaveBeenCalled();
    expect(syncLayerAfterFullSize).toHaveBeenCalledWith(expect.anything(), 'layer-1');
    expect(clearJsPixelData).toHaveBeenCalledWith('layer-1');
  });

  it('writes nothing when the stroke misses the canvas', () => {
    rasterizePath.mockReturnValueOnce(null);
    editorState.paths = [{ id: 'p1', anchors: [...triangle], closed: true }];
    editorState.selectedPathId = 'p1';

    strokePathOnEnter();

    expect(editorState.pushHistory).toHaveBeenCalledWith('Stroke Path');
    expect(compositePatchOntoLayer).not.toHaveBeenCalled();
  });

  it('does nothing with no draft and no selected path', () => {
    editorState.paths = [{ id: 'p1', anchors: [...triangle], closed: true }];

    strokePathOnEnter();

    expect(editorState.pushHistory).not.toHaveBeenCalled();
    expect(rasterizePath).not.toHaveBeenCalled();
  });

  it('leaves the selected path alone while a one-anchor draft is in progress', () => {
    editorState.paths = [{ id: 'p1', anchors: [...triangle], closed: true }];
    editorState.selectedPathId = 'p1';
    setDraft({ anchors: [anchor(10, 10)], closed: false });

    strokePathOnEnter();

    expect(editorState.pushHistory).not.toHaveBeenCalled();
    expect(rasterizePath).not.toHaveBeenCalled();
  });

  it('does not stroke the selected path onto a layer that refuses pixel writes', () => {
    editorState.paths = [{ id: 'p1', anchors: [...triangle], closed: true }];
    editorState.selectedPathId = 'p1';
    guardPixelWrite.mockReturnValue(false);

    strokePathOnEnter();

    expect(editorState.pushHistory).not.toHaveBeenCalled();
    expect(rasterizePath).not.toHaveBeenCalled();
  });

  describe('a repeated Enter', () => {
    function selectTriangle(): void {
      setEditor({ paths: [{ id: 'p1', anchors: [...triangle], closed: true }], selectedPathId: 'p1' });
    }

    it('does not stroke the selected path a second time', () => {
      selectTriangle();

      strokePathOnEnter();
      strokePathOnEnter();

      expect(rasterizePath).toHaveBeenCalledTimes(1);
      expect(editorState.pushHistory).toHaveBeenCalledTimes(1);
    });

    it('does not re-stroke a draft that Enter just committed and stroked', () => {
      setDraft({ anchors: [...triangle], closed: false });

      strokePathOnEnter();
      strokePathOnEnter();

      expect(editorState.selectedPathId).toBe('added');
      expect(rasterizePath).toHaveBeenCalledTimes(1);
    });

    it('strokes again once the path is re-selected', () => {
      selectTriangle();
      strokePathOnEnter();
      setEditor({ selectedPathId: null });
      setEditor({ selectedPathId: 'p1' });

      strokePathOnEnter();

      expect(rasterizePath).toHaveBeenCalledTimes(2);
    });

    it('strokes again once the path is edited (or the list restored by undo)', () => {
      selectTriangle();
      strokePathOnEnter();
      setEditor({ paths: [{ id: 'p1', anchors: [anchor(0, 0), anchor(50, 50)], closed: false }] });

      strokePathOnEnter();

      expect(rasterizePath).toHaveBeenCalledTimes(2);
    });

    it('strokes again once a new draft is started and abandoned', () => {
      selectTriangle();
      strokePathOnEnter();
      setDraft({ anchors: [anchor(5, 5)], closed: false });
      setDraft(null);

      strokePathOnEnter();

      expect(rasterizePath).toHaveBeenCalledTimes(2);
    });

    it('still strokes a different selected path', () => {
      selectTriangle();
      strokePathOnEnter();
      setEditor({
        paths: [...editorState.paths, { id: 'p2', anchors: [anchor(0, 0), anchor(50, 50)], closed: false }],
        selectedPathId: 'p2',
      });

      strokePathOnEnter();

      expect(rasterizePath).toHaveBeenCalledTimes(2);
    });
  });
});
