import { describe, it, expect, vi, beforeEach } from 'vitest';

const renderShape = vi.fn();
const renderShapeExpanded = vi.fn();
const saveShapePreview = vi.fn();
const endShapePreview = vi.fn();
const getLayerEngineBounds = vi.fn((..._args: unknown[]): Int32Array => new Int32Array(0));

vi.mock('../../engine-wasm/wasm-bridge', () => ({
  renderShape: (...args: unknown[]) => renderShape(...args),
  renderShapeExpanded: (...args: unknown[]) => renderShapeExpanded(...args),
  saveShapePreview: (...args: unknown[]) => saveShapePreview(...args),
  endShapePreview: (...args: unknown[]) => endShapePreview(...args),
  getLayerEngineBounds: (...args: unknown[]) => getLayerEngineBounds(...args),
}));

let engine: { __engine: string } | null = { __engine: 'mock' };
vi.mock('../../engine-wasm/engine-state', () => ({
  getEngine: () => engine,
}));

const clearJsPixelData = vi.fn();
vi.mock('../../app/store/clear-js-pixel-data', () => ({
  clearJsPixelData: (...args: unknown[]) => clearJsPixelData(...args),
}));

const pixelDataManagerRemove = vi.fn();
vi.mock('../../engine/pixel-data-manager', () => ({
  pixelDataManager: { remove: (...args: unknown[]) => pixelDataManagerRemove(...args) },
}));

interface MockLayer {
  id: string;
  type: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
}

const DOC_W = 200;
const DOC_H = 200;

const editorState = {
  document: {
    width: DOC_W,
    height: DOC_H,
    layers: [{ id: 'layer-1', type: 'raster', x: 0, y: 0, width: DOC_W, height: DOC_H }] as MockLayer[],
  },
  dirtyLayerIds: new Set<string>(),
  pushHistory: vi.fn(),
  notifyRender: vi.fn(),
  undo: vi.fn(),
  addPath: vi.fn(),
};
const setState = vi.fn((update: Partial<typeof editorState>) => {
  Object.assign(editorState, update);
});
vi.mock('../../app/editor-store', () => ({
  useEditorStore: {
    getState: () => editorState,
    setState: (update: Partial<typeof editorState>) => setState(update),
  },
}));

import type { ShapeSizeClick } from '../../app/ui-store';

const uiState = {
  setPendingShapeClick: vi.fn(),
};
vi.mock('../../app/ui-store', () => ({
  useUIStore: { getState: () => uiState },
}));

import type { Color } from '../../types';

const ts = {
  shapeMode: 'ellipse' as 'ellipse' | 'polygon',
  shapeOutput: 'pixels' as 'pixels' | 'path',
  shapeFillColor: { r: 255, g: 0, b: 0, a: 1 } as Color | null,
  shapeStrokeColor: { r: 0, g: 0, b: 255, a: 0.5 } as Color | null,
  shapeStrokeWidth: 2,
  shapePolygonSides: 5,
  shapeCornerRadius: 0,
  aspectRatioLocked: false,
  aspectRatioW: 1,
  aspectRatioH: 1,
  addRecentColor: vi.fn(),
};
vi.mock('../../app/tool-settings-store', () => ({
  useToolSettingsStore: { getState: () => ts },
}));

import {
  handleShapeDown,
  handleShapeMove,
  handleShapeUp,
  confirmShapeSize,
} from './shape-interaction';
import type { PathAnchor } from '../path/path';
import type { InteractionContext, InteractionState } from '../../app/interactions/interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from '../../app/interactions/interaction-types';

function makeCtx(overrides: Partial<InteractionContext> = {}): InteractionContext {
  const layer = { id: 'layer-1', x: 0, y: 0, visible: true } as unknown as InteractionContext['activeLayer'];
  return {
    canvasPos: { x: 50, y: 50 },
    layerPos: { x: 50, y: 50 },
    shiftKey: false,
    altKey: false,
    metaKey: false,
    activeLayerId: 'layer-1',
    activeLayer: layer,
    clientX: 0,
    clientY: 0,
    stateRef: { current: {} } as unknown as InteractionContext['stateRef'],
    floatingSelectionRef: { current: null },
    persistentTransformRef: { current: null },
    stampSourceRef: { current: null },
    stampOffsetRef: { current: null },
    lastPaintPointRef: { current: null },
    ...overrides,
  };
}

function makeState(overrides: Partial<InteractionState> = {}): InteractionState {
  return {
    drawing: true,
    lastPoint: { x: 50, y: 50 },
    layerId: 'layer-1',
    tool: 'shape',
    startPoint: { x: 50, y: 50 },
    layerStartX: 0,
    layerStartY: 0,
    ...DEFAULT_TRANSFORM_FIELDS,
    ...overrides,
  };
}

beforeEach(() => {
  engine = { __engine: 'mock' };
  renderShape.mockClear();
  renderShapeExpanded.mockClear();
  saveShapePreview.mockClear();
  endShapePreview.mockClear();
  getLayerEngineBounds.mockReset();
  // Default: engine bounds match the layer exactly, so no sync is needed.
  getLayerEngineBounds.mockReturnValue(new Int32Array([0, 0, DOC_W, DOC_H]));
  clearJsPixelData.mockClear();
  pixelDataManagerRemove.mockClear();
  editorState.document = {
    width: DOC_W,
    height: DOC_H,
    layers: [{ id: 'layer-1', type: 'raster', x: 0, y: 0, width: DOC_W, height: DOC_H }],
  };
  editorState.dirtyLayerIds = new Set<string>();
  editorState.pushHistory.mockClear();
  editorState.notifyRender.mockClear();
  editorState.undo.mockClear();
  editorState.addPath.mockClear();
  setState.mockClear();
  uiState.setPendingShapeClick.mockClear();
  ts.shapeMode = 'ellipse';
  ts.shapeOutput = 'pixels';
  ts.shapeFillColor = { r: 255, g: 0, b: 0, a: 1 };
  ts.shapeStrokeColor = { r: 0, g: 0, b: 255, a: 0.5 };
  ts.shapeStrokeWidth = 2;
  ts.shapePolygonSides = 5;
  ts.shapeCornerRadius = 0;
  ts.aspectRatioLocked = false;
  ts.addRecentColor.mockClear();
});

describe('shape down', () => {
  it('pushes history, snapshots the preview, and anchors at the layer point', () => {
    const layer = { id: 'layer-1', x: 30, y: 40, visible: true } as unknown as InteractionContext['activeLayer'];
    const state = handleShapeDown(makeCtx({ layerPos: { x: 15, y: 25 }, activeLayer: layer }));
    expect(editorState.pushHistory).toHaveBeenCalledWith('Shape');
    expect(saveShapePreview).toHaveBeenCalledWith(expect.anything(), 'layer-1');
    expect(ts.addRecentColor).toHaveBeenCalledWith({ r: 255, g: 0, b: 0, a: 1 });
    expect(ts.addRecentColor).toHaveBeenCalledWith({ r: 0, g: 0, b: 255, a: 0.5 });
    expect(state).toMatchObject({
      drawing: true,
      tool: 'shape',
      startPoint: { x: 15, y: 25 },
      layerStartX: 30,
      layerStartY: 40,
    });
  });

  it('does not record recent colors when fill and stroke are disabled', () => {
    ts.shapeFillColor = null;
    ts.shapeStrokeColor = null;
    handleShapeDown(makeCtx());
    expect(ts.addRecentColor).not.toHaveBeenCalled();
  });

  it('still returns a state without snapshotting when no engine exists', () => {
    engine = null;
    const state = handleShapeDown(makeCtx());
    expect(saveShapePreview).not.toHaveBeenCalled();
    expect(state.tool).toBe('shape');
  });
});

describe('shape move', () => {
  it('renders an ellipse centered at the start point with drag-derived size', () => {
    handleShapeMove(makeState({ startPoint: { x: 50, y: 50 } }), { x: 80, y: 70 });
    expect(renderShape).toHaveBeenCalledTimes(1);
    const args = renderShape.mock.calls[0]!;
    // (engine, layerId, mode, cx, cy, w, h, fill rgba, stroke rgba, sw, sides, cornerRadius)
    expect(args[1]).toBe('layer-1');
    expect(args[2]).toBe(0); // ellipse
    expect(args[3]).toBe(50);
    expect(args[4]).toBe(50);
    expect(args[5]).toBe(60); // rx 30 * 2
    expect(args[6]).toBe(40); // ry 20 * 2
    expect(args[7]).toBe(1); // fill r
    expect(args[8]).toBe(0);
    expect(args[9]).toBe(0);
    expect(args[10]).toBe(1); // fill a
    expect(args[11]).toBe(0); // stroke r
    expect(args[14]).toBe(0.5); // stroke a
    expect(args[15]).toBe(2); // stroke width
    expect(args[16]).toBe(5); // sides
    expect(args[17]).toBe(0); // corner radius
    expect(clearJsPixelData).toHaveBeenCalledWith('layer-1');
    expect(editorState.notifyRender).toHaveBeenCalled();
  });

  it('translates the center into document space for an offset layer', () => {
    handleShapeMove(
      makeState({ startPoint: { x: 50, y: 50 }, layerStartX: 100, layerStartY: 200 }),
      { x: 80, y: 70 },
    );
    const args = renderShape.mock.calls[0]!;
    expect(args[3]).toBe(150);
    expect(args[4]).toBe(250);
  });

  it('renders polygons with mode 1', () => {
    ts.shapeMode = 'polygon';
    handleShapeMove(makeState(), { x: 80, y: 70 });
    expect(renderShape.mock.calls[0]![2]).toBe(1);
  });

  it('meta key constrains the shape to a circle', () => {
    handleShapeMove(makeState({ startPoint: { x: 50, y: 50 } }), { x: 80, y: 60 }, true);
    const args = renderShape.mock.calls[0]!;
    // rx 30, ry 10 constrained to ratio 1 => both radii become 10.
    expect(args[5]).toBe(20);
    expect(args[6]).toBe(20);
  });

  it('honors a locked aspect ratio from tool settings', () => {
    ts.aspectRatioLocked = true;
    ts.aspectRatioW = 2;
    ts.aspectRatioH = 1;
    handleShapeMove(makeState({ startPoint: { x: 50, y: 50 } }), { x: 90, y: 60 });
    const args = renderShape.mock.calls[0]!;
    // rx 40 / ry 10 = 4 > 2, so rx shrinks to ry * 2 = 20.
    expect(args[5]).toBe(40);
    expect(args[6]).toBe(20);
  });

  it('caps the corner radius at half the smaller dimension', () => {
    ts.shapeCornerRadius = 50;
    handleShapeMove(makeState({ startPoint: { x: 50, y: 50 } }), { x: 80, y: 60 });
    // w 60, h 20 => cap is 10.
    expect(renderShape.mock.calls[0]![17]).toBe(10);
  });

  it('renders a transparent fill when the fill color is disabled', () => {
    ts.shapeFillColor = null;
    handleShapeMove(makeState(), { x: 80, y: 70 });
    const args = renderShape.mock.calls[0]!;
    expect(args[7]).toBe(0);
    expect(args[10]).toBe(0); // fill alpha 0
  });

  it('ignores sub-pixel drags', () => {
    handleShapeMove(makeState({ startPoint: { x: 50, y: 50 } }), { x: 50.5, y: 80 });
    expect(renderShape).not.toHaveBeenCalled();
    expect(editorState.notifyRender).not.toHaveBeenCalled();
  });

  it('does nothing without an engine', () => {
    engine = null;
    handleShapeMove(makeState(), { x: 80, y: 70 });
    expect(renderShape).not.toHaveBeenCalled();
  });

  it('does nothing without a start point', () => {
    handleShapeMove(makeState({ startPoint: null }), { x: 80, y: 70 });
    expect(renderShape).not.toHaveBeenCalled();
  });
});

describe('shape up — click vs drag', () => {
  it('a sub-4px gesture undoes the preview and asks for an explicit size', () => {
    handleShapeUp(
      makeState({ startPoint: { x: 50, y: 50 }, layerStartX: 7, layerStartY: 9 }),
      { x: 52, y: 52 },
    );
    expect(endShapePreview).toHaveBeenCalledTimes(1);
    expect(editorState.undo).toHaveBeenCalledTimes(1);
    expect(uiState.setPendingShapeClick).toHaveBeenCalledWith({
      center: { x: 50, y: 50 },
      layerId: 'layer-1',
      layerX: 7,
      layerY: 9,
    });
    expect(renderShapeExpanded).not.toHaveBeenCalled();
  });

  it('a click in path-output mode undoes without opening the size modal', () => {
    ts.shapeOutput = 'path';
    handleShapeUp(makeState({ startPoint: { x: 50, y: 50 } }), { x: 51, y: 51 });
    expect(editorState.undo).toHaveBeenCalledTimes(1);
    expect(uiState.setPendingShapeClick).not.toHaveBeenCalled();
    expect(editorState.addPath).not.toHaveBeenCalled();
  });

  it('does nothing without a start point', () => {
    handleShapeUp(makeState({ startPoint: null }), { x: 80, y: 70 });
    expect(endShapePreview).not.toHaveBeenCalled();
    expect(editorState.undo).not.toHaveBeenCalled();
  });
});

describe('shape up — committing pixels', () => {
  it('a drag fully inside the document keeps the preview render as-is', () => {
    handleShapeUp(makeState({ startPoint: { x: 100, y: 100 } }), { x: 130, y: 120 });
    expect(endShapePreview).toHaveBeenCalledTimes(1);
    expect(editorState.undo).not.toHaveBeenCalled();
    expect(renderShapeExpanded).not.toHaveBeenCalled();
    expect(getLayerEngineBounds).toHaveBeenCalledWith(expect.anything(), 'layer-1');
    expect(uiState.setPendingShapeClick).not.toHaveBeenCalled();
  });

  it('re-renders expanded when the shape overflows the document bounds', () => {
    // Center (20, 100) with rx 40 + stroke 2 extends past the left edge.
    handleShapeUp(makeState({ startPoint: { x: 20, y: 100 } }), { x: 60, y: 120 });
    expect(renderShapeExpanded).toHaveBeenCalledTimes(1);
    const args = renderShapeExpanded.mock.calls[0]!;
    expect(args[1]).toBe('layer-1');
    expect(args[3]).toBe(20); // doc-space cx
    expect(args[4]).toBe(100);
    expect(args[5]).toBe(80); // rx 40 * 2
    expect(args[6]).toBe(40); // ry 20 * 2
  });

  it('syncs moved layer bounds from the engine after the commit', () => {
    getLayerEngineBounds.mockReturnValue(new Int32Array([-5, -3, 210, 208]));
    handleShapeUp(makeState({ startPoint: { x: 100, y: 100 } }), { x: 130, y: 120 });
    expect(setState).toHaveBeenCalledTimes(1);
    const layer = editorState.document.layers.find((l) => l.id === 'layer-1')!;
    expect(layer).toMatchObject({ x: -5, y: -3, width: 210, height: 208 });
    expect(pixelDataManagerRemove).toHaveBeenCalledWith('layer-1');
    expect(editorState.dirtyLayerIds.has('layer-1')).toBe(true);
  });

  it('leaves the store untouched when the engine bounds already match', () => {
    handleShapeUp(makeState({ startPoint: { x: 100, y: 100 } }), { x: 130, y: 120 });
    expect(setState).not.toHaveBeenCalled();
    expect(pixelDataManagerRemove).not.toHaveBeenCalled();
  });

  it('applies the meta constraint when deciding overflow and committing', () => {
    // Unconstrained rx 95 would overflow; constrained to ry 10 it fits.
    handleShapeUp(makeState({ startPoint: { x: 100, y: 100 } }), { x: 195, y: 110 }, true);
    expect(renderShapeExpanded).not.toHaveBeenCalled();
  });

  it('skips all engine work when no engine is available', () => {
    engine = null;
    handleShapeUp(makeState({ startPoint: { x: 100, y: 100 } }), { x: 130, y: 120 });
    expect(endShapePreview).not.toHaveBeenCalled();
    expect(getLayerEngineBounds).not.toHaveBeenCalled();
    expect(renderShapeExpanded).not.toHaveBeenCalled();
  });
});

describe('shape up — path output', () => {
  beforeEach(() => {
    ts.shapeOutput = 'path';
  });

  it('undoes the raster preview and adds a closed ellipse path', () => {
    handleShapeUp(makeState({ startPoint: { x: 50, y: 50 } }), { x: 80, y: 70 });
    expect(editorState.undo).toHaveBeenCalledTimes(1);
    expect(editorState.addPath).toHaveBeenCalledTimes(1);
    const [anchors, closed] = editorState.addPath.mock.calls[0]! as [PathAnchor[], boolean];
    expect(closed).toBe(true);
    expect(anchors).toHaveLength(4);
    // Ellipse centered (50,50), rx 30, ry 20: top, right, bottom, left.
    expect(anchors[0]!.point).toEqual({ x: 50, y: 30 });
    expect(anchors[1]!.point).toEqual({ x: 80, y: 50 });
    expect(anchors[2]!.point).toEqual({ x: 50, y: 70 });
    expect(anchors[3]!.point).toEqual({ x: 20, y: 50 });
    expect(editorState.notifyRender).toHaveBeenCalled();
  });

  it('emits the path in document space for an offset layer', () => {
    handleShapeUp(
      makeState({ startPoint: { x: 50, y: 50 }, layerStartX: 100, layerStartY: 200 }),
      { x: 80, y: 70 },
    );
    const [anchors] = editorState.addPath.mock.calls[0]! as [PathAnchor[]];
    expect(anchors[0]!.point).toEqual({ x: 150, y: 230 });
  });

  it('adds a polygon path with one anchor per side', () => {
    ts.shapeMode = 'polygon';
    ts.shapePolygonSides = 3;
    handleShapeUp(makeState({ startPoint: { x: 50, y: 50 } }), { x: 80, y: 70 });
    const [anchors] = editorState.addPath.mock.calls[0]! as [PathAnchor[]];
    expect(anchors).toHaveLength(3);
    // First vertex points straight up from the center.
    expect(anchors[0]!.point.x).toBeCloseTo(50);
    expect(anchors[0]!.point.y).toBeCloseTo(30);
    expect(anchors[0]!.handleIn).toBeNull();
  });

  it('drops a path that the meta constraint collapsed to nothing', () => {
    // Horizontal drag with meta: ry 0 forces rx to 0 as well.
    handleShapeUp(makeState({ startPoint: { x: 50, y: 50 } }), { x: 55, y: 50 }, true);
    expect(editorState.undo).toHaveBeenCalledTimes(1);
    expect(editorState.addPath).not.toHaveBeenCalled();
  });
});

describe('confirmShapeSize', () => {
  const click: ShapeSizeClick = {
    center: { x: 30, y: 20 },
    layerId: 'layer-1',
    layerX: 5,
    layerY: 7,
  };

  it('renders the shape at the click center with the requested dimensions', () => {
    confirmShapeSize(60, 40, click);
    expect(editorState.pushHistory).toHaveBeenCalledWith('Shape');
    expect(ts.addRecentColor).toHaveBeenCalledWith({ r: 255, g: 0, b: 0, a: 1 });
    expect(renderShapeExpanded).toHaveBeenCalledTimes(1);
    const args = renderShapeExpanded.mock.calls[0]!;
    expect(args[1]).toBe('layer-1');
    expect(args[3]).toBe(35); // 30 + layerX 5
    expect(args[4]).toBe(27); // 20 + layerY 7
    expect(args[5]).toBe(60);
    expect(args[6]).toBe(40);
    expect(getLayerEngineBounds).toHaveBeenCalledWith(expect.anything(), 'layer-1');
    expect(clearJsPixelData).toHaveBeenCalledWith('layer-1');
    expect(editorState.notifyRender).toHaveBeenCalled();
  });

  it('caps the corner radius at half the smaller dimension', () => {
    ts.shapeCornerRadius = 100;
    confirmShapeSize(60, 40, click);
    expect(renderShapeExpanded.mock.calls[0]![17]).toBe(20);
  });

  it('pushes history but renders nothing without an engine', () => {
    engine = null;
    confirmShapeSize(60, 40, click);
    expect(editorState.pushHistory).toHaveBeenCalledWith('Shape');
    expect(renderShapeExpanded).not.toHaveBeenCalled();
    expect(editorState.notifyRender).not.toHaveBeenCalled();
  });
});
