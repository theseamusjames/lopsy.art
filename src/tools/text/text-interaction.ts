import type { InteractionContext, InteractionState } from '../../app/interactions/interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from '../../app/interactions/interaction-types';
import type { Point } from '../../types';
import { useUIStore, type TextEditingState } from '../../app/ui-store';
import { useEditorStore } from '../../app/editor-store';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import { computeTextLayout, rasterizeText, type TextStyle } from './text';
import { hitTestTextLayer } from './text-hit-test';
import { createTextLayer } from '../../layers/layer-model';
import { clearJsPixelData } from '../../app/store/clear-js-pixel-data';

const TEXT_DRAG_THRESHOLD = 4;

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

  editorState.pushHistory('Text');
  toolSettings.addRecentColor(textColor);

  const style: TextStyle = {
    fontSize: toolSettings.textFontSize,
    fontFamily: toolSettings.textFontFamily,
    fontWeight: toolSettings.textFontWeight,
    fontStyle: toolSettings.textFontStyle,
    color: textColor,
    lineHeight: 1.4,
    letterSpacing: 0,
    textAlign: toolSettings.textAlign,
  };

  const areaWidth = editing.bounds.width;

  // Rasterize onto a canvas sized to fit the rendered glyphs (with padding
  // for antialiasing and descenders). The layout describes where the canvas
  // should sit relative to the click anchor (bounds.x/y), so center / right
  // alignment land their text at the click point and glyphs extending past
  // the document edge are preserved instead of being silently clipped.
  const { canvas: textCanvas, layout } = rasterizeText(editing.text, style, areaWidth);

  editorState.updateTextLayerProperties(editing.layerId, {
    text: editing.text,
    fontFamily: toolSettings.textFontFamily,
    fontSize: toolSettings.textFontSize,
    fontWeight: toolSettings.textFontWeight,
    fontStyle: toolSettings.textFontStyle,
    color: textColor,
    textAlign: toolSettings.textAlign,
    width: areaWidth,
    x: editing.bounds.x + layout.offsetX,
    y: editing.bounds.y + layout.offsetY,
    visible: true,
  });

  const textCtx = textCanvas.getContext('2d');
  if (textCtx) {
    const imageData = textCtx.getImageData(0, 0, layout.width, layout.height);
    editorState.updateLayerPixelData(editing.layerId, imageData);
  }
  editorState.notifyRender();
}

export function handleTextDown(ctx: InteractionContext): InteractionState | undefined {
  const { canvasPos, activeLayerId, activeLayer } = ctx;
  const uiState = useUIStore.getState();
  const editorState = useEditorStore.getState();

  // If currently editing, commit the existing text and stop — don't start a new session.
  if (uiState.textEditing) {
    commitTextEditing();
    return undefined;
  }

  // Click on an existing text layer enters edit mode for it.
  const hitLayer = hitTestTextLayer(editorState.document.layers, canvasPos);
  if (hitLayer) {
    const toolSettings = useToolSettingsStore.getState();
    toolSettings.setTextFontSize(hitLayer.fontSize);
    toolSettings.setTextFontFamily(hitLayer.fontFamily);
    toolSettings.setTextFontWeight(hitLayer.fontWeight);
    toolSettings.setTextFontStyle(hitLayer.fontStyle);
    toolSettings.setTextAlign(hitLayer.textAlign);
    toolSettings.setForegroundColor(hitLayer.color);

    editorState.setActiveLayer(hitLayer.id);

    // Drop the cached committed pixel data so the per-frame live preview
    // owns the GPU texture during editing — otherwise syncLayers would
    // re-upload the stale committed bytes on top of each preview frame.
    clearJsPixelData(hitLayer.id);

    // Recover the original click anchor (which `bounds.x/y` represents during
    // editing) from the saved layer's top-left position. commitTextEditing
    // shifts the layer by `layout.offset*` so that center / right alignment
    // and descender padding can extend the rasterized canvas; we invert that
    // shift here so re-editing preserves the click anchor semantics.
    const hitStyle: TextStyle = {
      fontSize: hitLayer.fontSize,
      fontFamily: hitLayer.fontFamily,
      fontWeight: hitLayer.fontWeight,
      fontStyle: hitLayer.fontStyle,
      color: hitLayer.color,
      lineHeight: hitLayer.lineHeight,
      letterSpacing: hitLayer.letterSpacing,
      textAlign: hitLayer.textAlign,
    };
    const hitLayout = computeTextLayout(hitLayer.text, hitStyle, hitLayer.width);
    const editingState: TextEditingState = {
      layerId: hitLayer.id,
      bounds: {
        x: hitLayer.x - hitLayout.offsetX,
        y: hitLayer.y - hitLayout.offsetY,
        width: hitLayer.width,
        height: null,
      },
      text: hitLayer.text,
      cursorPos: hitLayer.text.length,
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
    pixelBuffer: null,
    originalPixelBuffer: null,
    layerId: activeLayerId,
    tool: 'text',
    startPoint: canvasPos,
    layerStartX: activeLayer.x,
    layerStartY: activeLayer.y,
    ...DEFAULT_TRANSFORM_FIELDS,
  };
}

export function handleTextMove(state: InteractionState, canvasPos: Point): void {
  if (!state.startPoint) return;
  const uiState = useUIStore.getState();
  uiState.setTextDrag({
    startX: state.startPoint.x,
    startY: state.startPoint.y,
    currentX: canvasPos.x,
    currentY: canvasPos.y,
  });
  useEditorStore.getState().notifyRender();
}

export function handleTextUp(state: InteractionState, canvasPos: Point): void {
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

  const newLayer = createTextLayer({
    name: `Text ${editorState.document.layers.length + 1}`,
    text: '',
    fontFamily: toolSettings.textFontFamily,
    fontSize: toolSettings.textFontSize,
    color: textColor,
  });

  editorState.addTextLayer({
    ...newLayer,
    x: boundsX,
    y: boundsY,
    width: boundsW,
    fontWeight: toolSettings.textFontWeight,
    fontStyle: toolSettings.textFontStyle,
    textAlign: toolSettings.textAlign,
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
    isNew: true,
    originalVisible: true,
  };
  uiState.startTextEditing(editingState);
  editorState.notifyRender();
}
