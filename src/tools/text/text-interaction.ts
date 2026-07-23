import type { InteractionContext, InteractionState } from '../../app/interactions/interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from '../../app/interactions/interaction-types';
import type { Point, TextLayer } from '../../types';
import { useUIStore, type TextEditingState } from '../../app/ui-store';
import { useEditorStore } from '../../app/editor-store';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import { hitTestTextLayer } from './text-hit-test';
import { createTextLayer } from '../../layers/layer-model';
import { clearJsPixelData } from '../../app/store/clear-js-pixel-data';
import { getEngine } from '../../engine-wasm/engine-state';
import {
  setTextLayerContent,
  renderTextLayer,
  getRenderedTextPixels,
  uploadLayerPixels,
  textHitPosition,
  getLayerTextureDimensions,
} from '../../engine-wasm/wasm-bridge';
import { utf8ToUtf16 } from '../../engine-wasm/text-offset';
import { wordAt } from './text-input';
import { extractFamilyName } from '../../utils/font-loader';

const TEXT_DRAG_THRESHOLD = 4;

/**
 * Transient state for a click-drag text selection inside the layer being
 * edited. `anchorPos` is the fixed end (UTF-16 index) the drag extends from.
 */
const dragSelectState = {
  active: false,
  anchorPos: 0,
  layerId: '',
};

/**
 * True when the current pointer gesture started as a click *inside* the edited
 * text (caret placement, shift-click, or double-click). It tells handleTextUp
 * not to create a new text layer when the gesture ends.
 */
let editingGesture = false;

const DOUBLE_CLICK_MS = 350;
const DOUBLE_CLICK_DIST = 4;

/**
 * Last caret-click, for detecting double-clicks. The canvas dispatches pointer
 * events, whose `detail` is 0 (not the click count), so we time consecutive
 * clicks ourselves.
 */
const lastClick = { time: 0, x: 0, y: 0, layerId: '' };

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Reset transient click/drag state. For test isolation only. */
export function resetTextInteractionState(): void {
  dragSelectState.active = false;
  dragSelectState.anchorPos = 0;
  dragSelectState.layerId = '';
  editingGesture = false;
  lastClick.time = 0;
  lastClick.x = 0;
  lastClick.y = 0;
  lastClick.layerId = '';
}

/** Map a document-space point to a UTF-16 offset in the edited text via the engine. */
function hitTestOffset(layerId: string, text: string, boundsX: number, boundsY: number, canvasPos: Point): number {
  const engine = getEngine();
  if (!engine) return text.length;
  const byte = textHitPosition(engine, layerId, canvasPos.x - boundsX, canvasPos.y - boundsY);
  return byte >= 0 ? utf8ToUtf16(text, byte) : text.length;
}


/** Commit the current text editing session: render text to pixels and update the layer. */
export function commitTextEditing(): void {
  const uiState = useUIStore.getState();
  const editing = uiState.textEditing;
  if (!editing) return;

  // Clear editing state first to prevent re-entry.
  uiState.commitTextEditing();

  const editorState = useEditorStore.getState();

  const layerExists = editorState.document.layers.some((l) => l.id === editing.layerId);
  if (!layerExists) {
    editorState.notifyRender();
    return;
  }

  // If no text was entered, just cancel.
  if (editing.text.trim() === '') {
    if (editing.isNew) {
      editorState.removeLayer(editing.layerId);
    } else {
      editorState.updateTextLayerProperties(editing.layerId, { visible: editing.originalVisible });
    }
    editorState.notifyRender();
    return;
  }

  const toolSettings = useToolSettingsStore.getState();
  const textColor = toolSettings.foregroundColor;

  const areaWidth = editing.bounds.width;
  let finalX = editing.bounds.x;
  let finalY = editing.bounds.y;

  // Check if this text layer is bound to a path — if so, skip the normal
  // WASM text render (syncPathTextLayers handles the texture) and keep
  // the layer at (0, 0) since path text uses document-space coordinates.
  const currentLayer = editorState.document.layers.find((l) => l.id === editing.layerId);
  const isPathText = currentLayer?.type === 'text' && !!(currentLayer as import('../../types').TextLayer).pathId;

  if (isPathText) {
    finalX = 0;
    finalY = 0;
  } else {
    // Explicitly render text to the GPU texture before pushHistory snapshots it.
    // This ensures the snapshot contains the final text pixels regardless of
    // whether the rAF-driven syncTextLayers loop had time to fire.
    const engine = getEngine();
    if (engine) {
      const text = toolSettings.settings.text;
      const propsJson = JSON.stringify({
        text: editing.text,
        fontFamily: text.fontFamily,
        fontSize: text.fontSize,
        fontWeight: text.fontWeight,
        fontStyle: text.fontStyle,
        color: [textColor.r / 255, textColor.g / 255, textColor.b / 255, textColor.a],
        lineHeight: text.lineHeight,
        letterSpacing: text.letterSpacing,
        paragraphSpacing: text.paragraphSpacing,
        textAlign: text.align,
        areaWidth: areaWidth ?? null,
        underline: text.underline,
        strikethrough: text.strikethrough,
      });
      setTextLayerContent(engine, editing.layerId, propsJson);
      const boundsResult = renderTextLayer(engine, editing.layerId);
      if (boundsResult.length === 4) {
        const width = boundsResult[0]!;
        const height = boundsResult[1]!;
        const offsetX = boundsResult[2]!;
        const offsetY = boundsResult[3]!;
        const pixels = getRenderedTextPixels(engine, editing.layerId);
        if (pixels.length > 0) {
          finalX = editing.bounds.x + offsetX;
          finalY = editing.bounds.y + offsetY;
          uploadLayerPixels(engine, editing.layerId, pixels, width, height, finalX, finalY);
        }
      }
    } else {
      // Fallback: use position set by the last syncTextLayers call if engine unavailable.
      finalX = currentLayer?.x ?? editing.bounds.x;
      finalY = currentLayer?.y ?? editing.bounds.y;
    }
  }

  editorState.pushHistory('Text');
  toolSettings.addRecentColor(textColor);

  const textForLayer = toolSettings.settings.text;
  toolSettings.addRecentFont(extractFamilyName(textForLayer.fontFamily));
  editorState.updateTextLayerProperties(editing.layerId, {
    text: editing.text,
    fontFamily: textForLayer.fontFamily,
    fontSize: textForLayer.fontSize,
    fontWeight: textForLayer.fontWeight,
    fontStyle: textForLayer.fontStyle,
    color: textColor,
    textAlign: textForLayer.align,
    lineHeight: textForLayer.lineHeight,
    letterSpacing: textForLayer.letterSpacing,
    paragraphSpacing: textForLayer.paragraphSpacing,
    width: areaWidth,
    x: finalX,
    y: finalY,
    visible: true,
    underline: textForLayer.underline,
    strikethrough: textForLayer.strikethrough,
  });

  editorState.notifyRender();
}

export function handleTextDown(ctx: InteractionContext): InteractionState | undefined {
  const { canvasPos, activeLayerId, activeLayer } = ctx;
  const uiState = useUIStore.getState();
  const editorState = useEditorStore.getState();

  dragSelectState.active = false;
  editingGesture = false;

  // While editing, a click inside the edited layer moves the caret / selects;
  // a click outside commits. This lets the user reposition within the text
  // instead of always committing on the next click.
  if (uiState.textEditing) {
    const editing = uiState.textEditing;
    const editingLayer = editorState.document.layers.find(
      (l): l is TextLayer => l.id === editing.layerId && l.type === 'text',
    );
    // Hit-test against the live GPU texture bounds — during editing the layer's
    // `text` field is still empty (the buffer lives in `textEditing`), so
    // hitTestTextLayer would compute a zero-width box.
    const engine = getEngine();
    const dims = editingLayer && engine ? getLayerTextureDimensions(engine, editing.layerId) : null;
    const texW = dims && dims.length >= 2 ? dims[0]! : 0;
    const texH = dims && dims.length >= 2 ? dims[1]! : 0;
    const insideEditing = !!editingLayer && texW > 1 && texH > 1
      && canvasPos.x >= editingLayer.x - 2 && canvasPos.x <= editingLayer.x + texW + 2
      && canvasPos.y >= editingLayer.y - 2 && canvasPos.y <= editingLayer.y + texH + 2;

    if (editingLayer && insideEditing) {
      editingGesture = true;
      const pos = hitTestOffset(editing.layerId, editing.text, editing.bounds.x, editing.bounds.y, canvasPos);

      const t = now();
      const isDoubleClick = (ctx.clickDetail ?? 0) >= 2
        || (t - lastClick.time < DOUBLE_CLICK_MS
          && lastClick.layerId === editing.layerId
          && Math.abs(canvasPos.x - lastClick.x) < DOUBLE_CLICK_DIST
          && Math.abs(canvasPos.y - lastClick.y) < DOUBLE_CLICK_DIST);
      lastClick.time = t;
      lastClick.x = canvasPos.x;
      lastClick.y = canvasPos.y;
      lastClick.layerId = editing.layerId;

      if (isDoubleClick) {
        // Double-click selects the word under the caret.
        const [start, end] = wordAt(editing.text, pos);
        uiState.updateTextEditingSelection(editing.text, end, start);
      } else if (ctx.shiftKey) {
        // Shift-click extends the current selection (or starts one).
        const anchor = editing.selectionAnchor ?? editing.cursorPos;
        uiState.updateTextEditingSelection(editing.text, pos, anchor);
        dragSelectState.active = true;
        dragSelectState.anchorPos = anchor;
        dragSelectState.layerId = editing.layerId;
      } else {
        // Plain click places the caret and may begin a drag-select.
        uiState.updateTextEditingSelection(editing.text, pos, null);
        dragSelectState.active = true;
        dragSelectState.anchorPos = pos;
        dragSelectState.layerId = editing.layerId;
      }
      editorState.notifyRender();
      // Return a live state so move/up route back here for the drag-select.
      return {
        drawing: true,
        lastPoint: canvasPos,
        layerId: editing.layerId,
        tool: 'text',
        startPoint: canvasPos,
        layerStartX: editingLayer.x,
        layerStartY: editingLayer.y,
        ...DEFAULT_TRANSFORM_FIELDS,
      };
    }

    // Click outside the edited text commits and stops.
    commitTextEditing();
    return undefined;
  }

  // Click on an existing text layer enters edit mode for it.
  const hitLayer = hitTestTextLayer(editorState.document.layers, canvasPos);
  if (hitLayer) {
    const toolSettings = useToolSettingsStore.getState();
    toolSettings.setTextSetting('fontSize', hitLayer.fontSize);
    toolSettings.setTextSetting('fontFamily', hitLayer.fontFamily);
    toolSettings.setTextSetting('fontWeight', hitLayer.fontWeight);
    toolSettings.setTextSetting('fontStyle', hitLayer.fontStyle);
    toolSettings.setTextSetting('align', hitLayer.textAlign);
    toolSettings.setForegroundColor(hitLayer.color);
    toolSettings.setTextSetting('underline', hitLayer.underline);
    toolSettings.setTextSetting('strikethrough', hitLayer.strikethrough);
    toolSettings.setTextSetting('lineHeight', hitLayer.lineHeight);
    toolSettings.setTextSetting('letterSpacing', hitLayer.letterSpacing);
    toolSettings.setTextSetting('paragraphSpacing', hitLayer.paragraphSpacing);

    editorState.setActiveLayer(hitLayer.id);

    // Drop the cached committed pixel data so the per-frame live preview
    // owns the GPU texture during editing — otherwise syncLayers would
    // re-upload the stale committed bytes on top of each preview frame.
    clearJsPixelData(hitLayer.id);

    // Recover the original click anchor (which `bounds.x/y` represents during
    // editing) from the saved layer's top-left position. commitTextEditing
    // shifts the layer by the engine's offsetX/offsetY; we invert that shift
    // here so re-editing preserves the click anchor semantics.
    //
    // Use the Rust engine for measurement — it uses the same layout/padding as
    // commit time, whereas the JS canvas uses different padding (fontSize*0.5
    // vs 2px), which would give wrong anchor recovery.
    let boundsX = hitLayer.x;
    let boundsY = hitLayer.y;
    const reEditEngine = getEngine();
    if (reEditEngine && hitLayer.text.trim().length > 0) {
      const reEditPropsJson = JSON.stringify({
        text: hitLayer.text,
        fontFamily: hitLayer.fontFamily,
        fontSize: hitLayer.fontSize,
        fontWeight: hitLayer.fontWeight,
        fontStyle: hitLayer.fontStyle,
        color: [hitLayer.color.r / 255, hitLayer.color.g / 255, hitLayer.color.b / 255, hitLayer.color.a],
        lineHeight: hitLayer.lineHeight,
        letterSpacing: hitLayer.letterSpacing,
        paragraphSpacing: hitLayer.paragraphSpacing,
        textAlign: hitLayer.textAlign,
        areaWidth: hitLayer.width ?? null,
      });
      setTextLayerContent(reEditEngine, hitLayer.id, reEditPropsJson);
      const boundsResult = renderTextLayer(reEditEngine, hitLayer.id);
      if (boundsResult.length === 4) {
        boundsX = hitLayer.x - (boundsResult[2] ?? 0);
        boundsY = hitLayer.y - (boundsResult[3] ?? 0);
      }
    }

    const editingState: TextEditingState = {
      layerId: hitLayer.id,
      bounds: {
        x: boundsX,
        y: boundsY,
        width: hitLayer.width,
        height: null,
      },
      text: hitLayer.text,
      cursorPos: hitLayer.text.length,
      selectionAnchor: null,
      isNew: false,
      originalVisible: hitLayer.visible,
    };
    uiState.startTextEditing(editingState);
    editorState.notifyRender();
    return undefined;
  }

  // Otherwise, start dragging to create a new text area.
  uiState.setTextDrag({
    startX: canvasPos.x,
    startY: canvasPos.y,
    currentX: canvasPos.x,
    currentY: canvasPos.y,
  });

  return {
    drawing: true,
    lastPoint: canvasPos,
    layerId: activeLayerId,
    tool: 'text',
    startPoint: canvasPos,
    layerStartX: activeLayer.x,
    layerStartY: activeLayer.y,
    ...DEFAULT_TRANSFORM_FIELDS,
  };
}

export function handleTextMove(state: InteractionState, canvasPos: Point): void {
  const uiState = useUIStore.getState();

  // Drag-select inside the edited text: extend the selection to the cursor.
  if (dragSelectState.active) {
    const editing = uiState.textEditing;
    if (!editing || editing.layerId !== dragSelectState.layerId) {
      dragSelectState.active = false;
      return;
    }
    const pos = hitTestOffset(editing.layerId, editing.text, editing.bounds.x, editing.bounds.y, canvasPos);
    uiState.updateTextEditingSelection(editing.text, pos, dragSelectState.anchorPos);
    useEditorStore.getState().notifyRender();
    return;
  }

  if (!state.startPoint) return;
  uiState.setTextDrag({
    startX: state.startPoint.x,
    startY: state.startPoint.y,
    currentX: canvasPos.x,
    currentY: canvasPos.y,
  });
  useEditorStore.getState().notifyRender();
}

export function handleTextUp(state: InteractionState, canvasPos: Point): void {
  // A gesture that began inside the edited text (caret/drag-select/word) only
  // adjusts the selection — it must never fall through to new-layer creation.
  if (editingGesture || dragSelectState.active) {
    dragSelectState.active = false;
    editingGesture = false;
    return;
  }

  if (!state.startPoint) return;

  const uiState = useUIStore.getState();
  const editorState = useEditorStore.getState();
  const toolSettings = useToolSettingsStore.getState();
  const textColor = toolSettings.foregroundColor;

  uiState.setTextDrag(null);

  const dx = canvasPos.x - state.startPoint.x;
  const dy = canvasPos.y - state.startPoint.y;
  const isAreaText = Math.abs(dx) > TEXT_DRAG_THRESHOLD || Math.abs(dy) > TEXT_DRAG_THRESHOLD;

  const boundsX = Math.min(state.startPoint.x, canvasPos.x);
  const boundsY = Math.min(state.startPoint.y, canvasPos.y);
  const boundsW = isAreaText ? Math.abs(dx) : null;
  const boundsH = isAreaText ? Math.abs(dy) : null;

  const text = toolSettings.settings.text;
  const newLayer = createTextLayer({
    name: `Text ${editorState.document.layers.length + 1}`,
    text: '',
    fontFamily: text.fontFamily,
    fontSize: text.fontSize,
    color: textColor,
  });

  editorState.addTextLayer({
    ...newLayer,
    x: boundsX,
    y: boundsY,
    width: boundsW,
    fontWeight: text.fontWeight,
    fontStyle: text.fontStyle,
    textAlign: text.align,
    visible: true, // GPU renders text preview in real-time
  });

  const editingState: TextEditingState = {
    layerId: newLayer.id,
    bounds: {
      x: boundsX,
      y: boundsY,
      width: boundsW,
      height: boundsH,
    },
    text: '',
    cursorPos: 0,
    selectionAnchor: null,
    isNew: true,
    originalVisible: true,
  };
  uiState.startTextEditing(editingState);
  editorState.notifyRender();
}
