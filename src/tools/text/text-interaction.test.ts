import { describe, it, expect, vi, beforeEach } from 'vitest';

const setTextLayerContent = vi.fn();
const renderTextLayer = vi.fn((..._args: unknown[]): Float32Array => new Float32Array(0));
const getRenderedTextPixels = vi.fn((..._args: unknown[]): Uint8Array => new Uint8Array(0));
const uploadLayerPixels = vi.fn();
const textHitPosition = vi.fn((..._args: unknown[]): number => 0);
const getLayerTextureDimensions = vi.fn((..._args: unknown[]): Uint32Array => new Uint32Array([200, 40]));

vi.mock('../../engine-wasm/wasm-bridge', () => ({
  setTextLayerContent: (...args: unknown[]) => setTextLayerContent(...args),
  renderTextLayer: (...args: unknown[]) => renderTextLayer(...args),
  getRenderedTextPixels: (...args: unknown[]) => getRenderedTextPixels(...args),
  uploadLayerPixels: (...args: unknown[]) => uploadLayerPixels(...args),
  textHitPosition: (...args: unknown[]) => textHitPosition(...args),
  getLayerTextureDimensions: (...args: unknown[]) => getLayerTextureDimensions(...args),
}));

let engine: { __engine: string } | null = { __engine: 'mock' };
vi.mock('../../engine-wasm/engine-state', () => ({
  getEngine: () => engine,
}));

const clearJsPixelData = vi.fn();
vi.mock('../../app/store/clear-js-pixel-data', () => ({
  clearJsPixelData: (...args: unknown[]) => clearJsPixelData(...args),
}));

import type { TextEditingState } from '../../app/ui-store';

const uiState = {
  textEditing: null as TextEditingState | null,
  commitTextEditing: vi.fn(() => { uiState.textEditing = null; }),
  startTextEditing: vi.fn((s: TextEditingState) => { uiState.textEditing = s; }),
  updateTextEditingSelection: vi.fn((text: string, cursorPos: number, selectionAnchor: number | null) => {
    if (uiState.textEditing) uiState.textEditing = { ...uiState.textEditing, text, cursorPos, selectionAnchor };
  }),
  setTextDrag: vi.fn(),
};
vi.mock('../../app/ui-store', () => ({
  useUIStore: { getState: () => uiState },
}));

import type { Layer, TextLayer } from '../../types';

const editorState = {
  document: { width: 400, height: 300, layers: [] as Layer[] },
  pushHistory: vi.fn(),
  notifyRender: vi.fn(),
  removeLayer: vi.fn(),
  updateTextLayerProperties: vi.fn(),
  setActiveLayer: vi.fn(),
  addTextLayer: vi.fn(),
};
vi.mock('../../app/editor-store', () => ({
  useEditorStore: { getState: () => editorState },
}));

const ts = {
  foregroundColor: { r: 255, g: 128, b: 0, a: 1 },
  settings: {
    text: {
      content: 'Text',
      fontFamily: 'Inter',
      fontSize: 24,
      fontWeight: 400,
      fontStyle: 'normal' as 'normal' | 'italic',
      align: 'left' as 'left' | 'center' | 'right' | 'justify',
      underline: false,
      strikethrough: false,
      lineHeight: 1.4,
      letterSpacing: 0,
      paragraphSpacing: 0,
    },
  },
  addRecentColor: vi.fn(),
  addRecentFont: vi.fn(),
  setTextSetting: vi.fn(),
  setForegroundColor: vi.fn(),
};
vi.mock('../../app/tool-settings-store', () => ({
  useToolSettingsStore: { getState: () => ts },
}));

import {
  handleTextDown,
  handleTextMove,
  handleTextUp,
  commitTextEditing,
  resetTextInteractionState,
} from './text-interaction';
import { DEFAULT_EFFECTS } from '../../layers/layer-model';
import type { InteractionContext, InteractionState } from '../../app/interactions/interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from '../../app/interactions/interaction-types';

function makeTextLayer(overrides: Partial<TextLayer> = {}): TextLayer {
  return {
    id: 'text-1',
    name: 'Text 1',
    type: 'text',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 100,
    y: 50,
    clipToBelow: false,
    effects: DEFAULT_EFFECTS,
    mask: null,
    text: 'Hello',
    fontFamily: 'Inter',
    fontSize: 24,
    fontWeight: 400,
    fontStyle: 'normal',
    color: { r: 10, g: 20, b: 30, a: 1 },
    lineHeight: 1.4,
    letterSpacing: 0,
    paragraphSpacing: 0,
    textAlign: 'left',
    width: null,
    underline: false,
    strikethrough: false,
    ...overrides,
  };
}

function makeCtx(overrides: Partial<InteractionContext> = {}): InteractionContext {
  const layer = { id: 'layer-1', x: 0, y: 0, visible: true } as unknown as InteractionContext['activeLayer'];
  return {
    canvasPos: { x: 10, y: 10 },
    layerPos: { x: 10, y: 10 },
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
    lastPoint: { x: 10, y: 10 },
    layerId: 'layer-1',
    tool: 'text',
    startPoint: { x: 10, y: 10 },
    layerStartX: 0,
    layerStartY: 0,
    ...DEFAULT_TRANSFORM_FIELDS,
    ...overrides,
  };
}

function editingState(overrides: Partial<TextEditingState> = {}): TextEditingState {
  return {
    layerId: 'text-1',
    bounds: { x: 30, y: 40, width: null, height: null },
    text: 'New text',
    cursorPos: 8,
    selectionAnchor: null,
    isNew: false,
    originalVisible: true,
    ...overrides,
  };
}

beforeEach(() => {
  engine = { __engine: 'mock' };
  setTextLayerContent.mockClear();
  renderTextLayer.mockReset();
  renderTextLayer.mockReturnValue(new Float32Array(0));
  getRenderedTextPixels.mockReset();
  getRenderedTextPixels.mockReturnValue(new Uint8Array(0));
  uploadLayerPixels.mockClear();
  clearJsPixelData.mockClear();
  textHitPosition.mockReset();
  textHitPosition.mockReturnValue(0);
  getLayerTextureDimensions.mockReset();
  getLayerTextureDimensions.mockReturnValue(new Uint32Array([200, 40]));
  resetTextInteractionState();
  uiState.textEditing = null;
  uiState.commitTextEditing.mockClear();
  uiState.startTextEditing.mockClear();
  uiState.updateTextEditingSelection.mockClear();
  uiState.setTextDrag.mockClear();
  editorState.document = { width: 400, height: 300, layers: [] };
  editorState.pushHistory.mockClear();
  editorState.notifyRender.mockClear();
  editorState.removeLayer.mockClear();
  editorState.updateTextLayerProperties.mockClear();
  editorState.setActiveLayer.mockClear();
  editorState.addTextLayer.mockClear();
  ts.addRecentColor.mockClear();
  ts.addRecentFont.mockClear();
  ts.setTextSetting.mockClear();
  ts.setForegroundColor.mockClear();
  ts.foregroundColor = { r: 255, g: 128, b: 0, a: 1 };
  ts.settings.text = {
    content: 'Text',
    fontFamily: 'Inter',
    fontSize: 24,
    fontWeight: 400,
    fontStyle: 'normal',
    align: 'left',
    underline: false,
    strikethrough: false,
    lineHeight: 1.4,
    letterSpacing: 0,
    paragraphSpacing: 0,
  };
});

describe('text down — new text drag', () => {
  it('anchors a text drag at the click point on blank canvas', () => {
    const layer = { id: 'layer-1', x: 7, y: 9, visible: true } as unknown as InteractionContext['activeLayer'];
    const state = handleTextDown(makeCtx({ canvasPos: { x: 25, y: 35 }, activeLayer: layer }));
    expect(uiState.setTextDrag).toHaveBeenCalledWith({
      startX: 25,
      startY: 35,
      currentX: 25,
      currentY: 35,
    });
    expect(state).toMatchObject({
      drawing: true,
      tool: 'text',
      startPoint: { x: 25, y: 35 },
      layerStartX: 7,
      layerStartY: 9,
    });
    expect(uiState.startTextEditing).not.toHaveBeenCalled();
  });

  it('commits an active editing session instead of starting a new one', () => {
    uiState.textEditing = editingState({ layerId: 'ghost' });
    const result = handleTextDown(makeCtx());
    expect(result).toBeUndefined();
    expect(uiState.commitTextEditing).toHaveBeenCalledTimes(1);
    expect(uiState.setTextDrag).not.toHaveBeenCalled();
    expect(uiState.startTextEditing).not.toHaveBeenCalled();
  });
});

describe('text down — clicking an existing text layer', () => {
  it('enters edit mode and pulls the layer typography into tool settings', () => {
    const layer = makeTextLayer({
      fontSize: 36,
      fontFamily: 'Georgia',
      fontWeight: 700,
      fontStyle: 'italic',
      textAlign: 'center',
      underline: true,
      strikethrough: true,
    });
    editorState.document.layers = [layer];
    // Hit region: x 100..100+5*36*0.6, y 50..50+36*1.4
    const result = handleTextDown(makeCtx({ canvasPos: { x: 110, y: 60 } }));
    expect(result).toBeUndefined();
    expect(ts.setTextSetting).toHaveBeenCalledWith('fontSize', 36);
    expect(ts.setTextSetting).toHaveBeenCalledWith('fontFamily', 'Georgia');
    expect(ts.setTextSetting).toHaveBeenCalledWith('fontWeight', 700);
    expect(ts.setTextSetting).toHaveBeenCalledWith('fontStyle', 'italic');
    expect(ts.setTextSetting).toHaveBeenCalledWith('align', 'center');
    expect(ts.setForegroundColor).toHaveBeenCalledWith({ r: 10, g: 20, b: 30, a: 1 });
    expect(ts.setTextSetting).toHaveBeenCalledWith('underline', true);
    expect(ts.setTextSetting).toHaveBeenCalledWith('strikethrough', true);
    expect(editorState.setActiveLayer).toHaveBeenCalledWith('text-1');
    expect(clearJsPixelData).toHaveBeenCalledWith('text-1');
    expect(uiState.startTextEditing).toHaveBeenCalledWith(
      expect.objectContaining({
        layerId: 'text-1',
        text: 'Hello',
        cursorPos: 5,
        isNew: false,
        originalVisible: true,
      }),
    );
    expect(uiState.setTextDrag).not.toHaveBeenCalled();
    expect(editorState.notifyRender).toHaveBeenCalled();
  });

  it('recovers the original click anchor via the engine layout offsets', () => {
    editorState.document.layers = [makeTextLayer()];
    // (width, height, offsetX, offsetY) from the Rust layout pass.
    renderTextLayer.mockReturnValue(new Float32Array([80, 30, 6, 9]));
    handleTextDown(makeCtx({ canvasPos: { x: 110, y: 60 } }));
    const editing = uiState.startTextEditing.mock.calls[0]![0];
    expect(editing.bounds.x).toBe(94); // 100 - 6
    expect(editing.bounds.y).toBe(41); // 50 - 9
    const props = JSON.parse(setTextLayerContent.mock.calls[0]![2] as string) as {
      text: string;
      areaWidth: number | null;
    };
    expect(props.text).toBe('Hello');
    expect(props.areaWidth).toBeNull();
  });

  it('uses the raw layer position when no engine is available', () => {
    engine = null;
    editorState.document.layers = [makeTextLayer()];
    handleTextDown(makeCtx({ canvasPos: { x: 110, y: 60 } }));
    expect(setTextLayerContent).not.toHaveBeenCalled();
    const editing = uiState.startTextEditing.mock.calls[0]![0];
    expect(editing.bounds.x).toBe(100);
    expect(editing.bounds.y).toBe(50);
  });

  it('skips the engine measurement for whitespace-only text', () => {
    editorState.document.layers = [makeTextLayer({ text: ' ' })];
    handleTextDown(makeCtx({ canvasPos: { x: 105, y: 60 } }));
    expect(setTextLayerContent).not.toHaveBeenCalled();
    expect(uiState.startTextEditing).toHaveBeenCalledWith(
      expect.objectContaining({ bounds: expect.objectContaining({ x: 100, y: 50 }) }),
    );
  });

  it('ignores invisible text layers and starts a drag instead', () => {
    editorState.document.layers = [makeTextLayer({ visible: false })];
    const state = handleTextDown(makeCtx({ canvasPos: { x: 110, y: 60 } }));
    expect(state?.drawing).toBe(true);
    expect(uiState.setTextDrag).toHaveBeenCalledTimes(1);
    expect(uiState.startTextEditing).not.toHaveBeenCalled();
  });

  it('ignores locked text layers and starts a drag instead', () => {
    editorState.document.layers = [makeTextLayer({ locked: true })];
    const state = handleTextDown(makeCtx({ canvasPos: { x: 110, y: 60 } }));
    expect(state?.drawing).toBe(true);
    expect(uiState.startTextEditing).not.toHaveBeenCalled();
  });

  it('hits the topmost of two overlapping text layers', () => {
    editorState.document.layers = [
      makeTextLayer({ id: 'below' }),
      makeTextLayer({ id: 'above' }),
    ];
    handleTextDown(makeCtx({ canvasPos: { x: 110, y: 60 } }));
    expect(editorState.setActiveLayer).toHaveBeenCalledWith('above');
  });
});

describe('text move', () => {
  it('stretches the drag rectangle from the anchor to the cursor', () => {
    handleTextMove(makeState({ startPoint: { x: 10, y: 20 } }), { x: 50, y: 60 });
    expect(uiState.setTextDrag).toHaveBeenCalledWith({
      startX: 10,
      startY: 20,
      currentX: 50,
      currentY: 60,
    });
    expect(editorState.notifyRender).toHaveBeenCalled();
  });

  it('does nothing without a start point', () => {
    handleTextMove(makeState({ startPoint: null }), { x: 50, y: 60 });
    expect(uiState.setTextDrag).not.toHaveBeenCalled();
  });
});

describe('text up', () => {
  it('a click creates a point-text layer (no width) and opens editing', () => {
    const state = makeState({ startPoint: { x: 40, y: 40 } });
    handleTextUp(state, { x: 40, y: 40 });
    expect(uiState.setTextDrag).toHaveBeenCalledWith(null);
    expect(editorState.addTextLayer).toHaveBeenCalledTimes(1);
    const added = editorState.addTextLayer.mock.calls[0]![0] as TextLayer;
    expect(added).toMatchObject({
      type: 'text',
      x: 40,
      y: 40,
      width: null,
      text: '',
      visible: true,
      fontFamily: 'Inter',
      fontSize: 24,
      name: 'Text 1',
    });
    expect(uiState.startTextEditing).toHaveBeenCalledWith({
      layerId: added.id,
      bounds: { x: 40, y: 40, width: null, height: null },
      text: '',
      cursorPos: 0,
      selectionAnchor: null,
      isNew: true,
      originalVisible: true,
    });
    expect(editorState.notifyRender).toHaveBeenCalled();
  });

  it('a move of exactly the 4px threshold still counts as a click', () => {
    handleTextUp(makeState({ startPoint: { x: 40, y: 40 } }), { x: 44, y: 44 });
    const added = editorState.addTextLayer.mock.calls[0]![0] as TextLayer;
    expect(added.width).toBeNull();
    expect(added.x).toBe(40);
  });

  it('a drag past the threshold creates area text sized by the drag', () => {
    handleTextUp(makeState({ startPoint: { x: 100, y: 80 } }), { x: 160, y: 120 });
    const added = editorState.addTextLayer.mock.calls[0]![0] as TextLayer;
    expect(added).toMatchObject({ x: 100, y: 80, width: 60 });
    expect(uiState.startTextEditing).toHaveBeenCalledWith(
      expect.objectContaining({
        bounds: { x: 100, y: 80, width: 60, height: 40 },
        isNew: true,
      }),
    );
  });

  it('normalizes a reversed drag to the top-left corner', () => {
    handleTextUp(makeState({ startPoint: { x: 160, y: 120 } }), { x: 100, y: 80 });
    const added = editorState.addTextLayer.mock.calls[0]![0] as TextLayer;
    expect(added).toMatchObject({ x: 100, y: 80, width: 60 });
  });

  it('names new layers sequentially from the layer count', () => {
    editorState.document.layers = [makeTextLayer(), makeTextLayer({ id: 'text-2' })];
    handleTextUp(makeState({ startPoint: { x: 200, y: 200 } }), { x: 200, y: 200 });
    const added = editorState.addTextLayer.mock.calls[0]![0] as TextLayer;
    expect(added.name).toBe('Text 3');
  });

  it('does nothing without a start point', () => {
    handleTextUp(makeState({ startPoint: null }), { x: 40, y: 40 });
    expect(uiState.setTextDrag).not.toHaveBeenCalled();
    expect(editorState.addTextLayer).not.toHaveBeenCalled();
  });
});

describe('commitTextEditing', () => {
  it('does nothing when no editing session is active', () => {
    commitTextEditing();
    expect(uiState.commitTextEditing).not.toHaveBeenCalled();
    expect(editorState.notifyRender).not.toHaveBeenCalled();
  });

  it('only re-renders when the edited layer no longer exists', () => {
    uiState.textEditing = editingState({ layerId: 'ghost' });
    commitTextEditing();
    expect(uiState.commitTextEditing).toHaveBeenCalledTimes(1);
    expect(editorState.removeLayer).not.toHaveBeenCalled();
    expect(editorState.updateTextLayerProperties).not.toHaveBeenCalled();
    expect(editorState.notifyRender).toHaveBeenCalledTimes(1);
  });

  it('removes a brand-new layer when no text was entered', () => {
    editorState.document.layers = [makeTextLayer()];
    uiState.textEditing = editingState({ text: '   ', isNew: true });
    commitTextEditing();
    expect(editorState.removeLayer).toHaveBeenCalledWith('text-1');
    expect(editorState.pushHistory).not.toHaveBeenCalled();
  });

  it('restores visibility on an existing layer when text was cleared', () => {
    editorState.document.layers = [makeTextLayer()];
    uiState.textEditing = editingState({ text: '', isNew: false, originalVisible: false });
    commitTextEditing();
    expect(editorState.removeLayer).not.toHaveBeenCalled();
    expect(editorState.updateTextLayerProperties).toHaveBeenCalledWith('text-1', { visible: false });
  });

  it('renders via the engine and positions the layer at bounds plus layout offset', () => {
    editorState.document.layers = [makeTextLayer()];
    uiState.textEditing = editingState({
      bounds: { x: 30, y: 40, width: 200, height: null },
      text: 'New text',
    });
    renderTextLayer.mockReturnValue(new Float32Array([120, 50, 4, 6]));
    getRenderedTextPixels.mockReturnValue(new Uint8Array(120 * 50 * 4));

    commitTextEditing();

    const props = JSON.parse(setTextLayerContent.mock.calls[0]![2] as string) as {
      text: string;
      fontFamily: string;
      fontSize: number;
      color: number[];
      areaWidth: number | null;
      textAlign: string;
    };
    expect(props.text).toBe('New text');
    expect(props.fontFamily).toBe('Inter');
    expect(props.fontSize).toBe(24);
    expect(props.color).toEqual([1, 128 / 255, 0, 1]);
    expect(props.areaWidth).toBe(200);

    // (engine, layerId, pixels, width, height, x, y)
    const up = uploadLayerPixels.mock.calls[0]!;
    expect(up[1]).toBe('text-1');
    expect(up[3]).toBe(120);
    expect(up[4]).toBe(50);
    expect(up[5]).toBe(34); // 30 + offsetX 4
    expect(up[6]).toBe(46); // 40 + offsetY 6

    expect(editorState.pushHistory).toHaveBeenCalledWith('Text');
    expect(ts.addRecentColor).toHaveBeenCalledWith({ r: 255, g: 128, b: 0, a: 1 });
    expect(editorState.updateTextLayerProperties).toHaveBeenCalledWith(
      'text-1',
      expect.objectContaining({
        text: 'New text',
        x: 34,
        y: 46,
        width: 200,
        visible: true,
        color: { r: 255, g: 128, b: 0, a: 1 },
      }),
    );
    expect(editorState.notifyRender).toHaveBeenCalled();
  });

  it('keeps the bounds position when the engine returns no pixels', () => {
    editorState.document.layers = [makeTextLayer()];
    uiState.textEditing = editingState({ bounds: { x: 30, y: 40, width: null, height: null } });
    renderTextLayer.mockReturnValue(new Float32Array([120, 50, 4, 6]));
    getRenderedTextPixels.mockReturnValue(new Uint8Array(0));
    commitTextEditing();
    expect(uploadLayerPixels).not.toHaveBeenCalled();
    expect(editorState.updateTextLayerProperties).toHaveBeenCalledWith(
      'text-1',
      expect.objectContaining({ x: 30, y: 40 }),
    );
  });

  it('falls back to the layer position when no engine is available', () => {
    engine = null;
    editorState.document.layers = [makeTextLayer({ x: 12, y: 34 })];
    uiState.textEditing = editingState();
    commitTextEditing();
    expect(setTextLayerContent).not.toHaveBeenCalled();
    expect(editorState.updateTextLayerProperties).toHaveBeenCalledWith(
      'text-1',
      expect.objectContaining({ x: 12, y: 34 }),
    );
    expect(editorState.pushHistory).toHaveBeenCalledWith('Text');
  });

  it('skips the WASM render for path-bound text and pins it to the origin', () => {
    editorState.document.layers = [makeTextLayer({ pathId: 'path-1' })];
    uiState.textEditing = editingState();
    commitTextEditing();
    expect(setTextLayerContent).not.toHaveBeenCalled();
    expect(uploadLayerPixels).not.toHaveBeenCalled();
    expect(editorState.updateTextLayerProperties).toHaveBeenCalledWith(
      'text-1',
      expect.objectContaining({ x: 0, y: 0 }),
    );
  });

  it('clears the editing session first so a second commit is a no-op', () => {
    editorState.document.layers = [makeTextLayer()];
    uiState.textEditing = editingState();
    commitTextEditing();
    commitTextEditing();
    expect(editorState.pushHistory).toHaveBeenCalledTimes(1);
    expect(uiState.commitTextEditing).toHaveBeenCalledTimes(1);
  });
});

describe('text down — caret + selection while editing', () => {
  // A wide, tall editing layer so clicks land inside its estimated box.
  const editLayer = () => makeTextLayer({ id: 'text-1', text: 'Hello World', x: 30, y: 40, fontSize: 24 });

  function startEditing(cursorPos = 11, selectionAnchor: number | null = null) {
    editorState.document.layers = [editLayer()];
    uiState.textEditing = editingState({ text: 'Hello World', cursorPos, selectionAnchor });
  }

  it('places the caret on a click inside the edited text (no commit)', () => {
    startEditing();
    textHitPosition.mockReturnValue(6); // byte offset 6 → "World"
    handleTextDown(makeCtx({ canvasPos: { x: 80, y: 50 } }));
    expect(uiState.commitTextEditing).not.toHaveBeenCalled();
    expect(uiState.updateTextEditingSelection).toHaveBeenCalledWith('Hello World', 6, null);
  });

  it('commits when the click is outside the edited text', () => {
    startEditing();
    handleTextDown(makeCtx({ canvasPos: { x: 5000, y: 5000 } }));
    expect(uiState.commitTextEditing).toHaveBeenCalled();
  });

  it('shift-click extends the selection from the existing cursor', () => {
    startEditing(2, null);
    textHitPosition.mockReturnValue(7);
    handleTextDown(makeCtx({ canvasPos: { x: 90, y: 50 }, shiftKey: true }));
    expect(uiState.updateTextEditingSelection).toHaveBeenCalledWith('Hello World', 7, 2);
  });

  it('double-click selects the word under the caret', () => {
    startEditing();
    textHitPosition.mockReturnValue(7); // inside "World" [6, 11)
    handleTextDown(makeCtx({ canvasPos: { x: 90, y: 50 }, clickDetail: 2 }));
    expect(uiState.updateTextEditingSelection).toHaveBeenCalledWith('Hello World', 11, 6);
  });

  it('drag after a caret click extends the selection', () => {
    startEditing();
    textHitPosition.mockReturnValue(0);
    const state = handleTextDown(makeCtx({ canvasPos: { x: 30, y: 50 } }))!;
    expect(state.drawing).toBe(true);
    textHitPosition.mockReturnValue(5);
    handleTextMove(state, { x: 70, y: 50 });
    expect(uiState.updateTextEditingSelection).toHaveBeenLastCalledWith('Hello World', 5, 0);
  });

  it('drag-select up does not create a new text layer', () => {
    startEditing();
    textHitPosition.mockReturnValue(0);
    const state = handleTextDown(makeCtx({ canvasPos: { x: 30, y: 50 } }))!;
    handleTextMove(state, { x: 70, y: 50 });
    handleTextUp(state, { x: 70, y: 50 });
    expect(editorState.addTextLayer).not.toHaveBeenCalled();
  });
});
