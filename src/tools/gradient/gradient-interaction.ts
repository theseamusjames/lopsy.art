import type { InteractionContext, InteractionState } from '../../app/interactions/interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from '../../app/interactions/interaction-types';
import type { Point } from '../../types';
import { useUIStore } from '../../app/ui-store';
import { useEditorStore } from '../../app/editor-store';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import { toDocumentColor } from '../../app/document-color';
import { clearJsPixelData } from '../../app/store/clear-js-pixel-data';
import { syncLayerAfterFullSize } from '../../app/sync-layer-after-full-size';
import { getEngine } from '../../engine-wasm/engine-state';
import {
  renderLinearGradient as gpuRenderLinearGradient,
  renderRadialGradient as gpuRenderRadialGradient,
  saveGradientPreview as gpuSaveGradientPreview,
  endGradientPreview as gpuEndGradientPreview,
  renderMaskLinearGradient as gpuRenderMaskLinearGradient,
  renderMaskRadialGradient as gpuRenderMaskRadialGradient,
  renderQuickMaskLinearGradient as gpuRenderQuickMaskLinearGradient,
  renderQuickMaskRadialGradient as gpuRenderQuickMaskRadialGradient,
  uploadLayerMask,
  getLayerEngineBounds,
} from '../../engine-wasm/wasm-bridge';

export function handleGradientDown(ctx: InteractionContext): InteractionState {
  const { layerPos, activeLayerId, activeLayer } = ctx;
  const editorState = useEditorStore.getState();
  const ts = useToolSettingsStore.getState();
  const ui = useUIStore.getState();
  const maskEditMode = ui.maskMode === 'layerMask';
  const isQuickMaskMode = ui.maskMode === 'quickMask';

  const engine = getEngine();

  const gradientType = ts.settings.gradient.type;
  if (isQuickMaskMode) {
    editorState.pushHistory(gradientType === 'radial' ? 'Quick Mask Radial Gradient' : 'Quick Mask Linear Gradient');
  } else if (maskEditMode && activeLayer.mask) {
    editorState.pushHistory(gradientType === 'radial' ? 'Mask Radial Gradient' : 'Mask Linear Gradient');
    if (engine) {
      const maskBytes = new Uint8Array(activeLayer.mask.data.buffer, activeLayer.mask.data.byteOffset, activeLayer.mask.data.byteLength);
      uploadLayerMask(engine, activeLayerId, maskBytes, activeLayer.mask.width, activeLayer.mask.height);
    }
  } else {
    editorState.pushHistory(gradientType === 'radial' ? 'Radial Gradient' : 'Linear Gradient');
  }
  ts.addRecentColor(ts.foregroundColor);
  ts.addRecentColor(ts.backgroundColor);

  if (engine && !maskEditMode && !isQuickMaskMode) gpuSaveGradientPreview(engine, activeLayerId);

  return {
    drawing: true,
    lastPoint: layerPos,
    layerId: activeLayerId,
    tool: 'gradient',
    startPoint: layerPos,
    layerStartX: activeLayer.x,
    layerStartY: activeLayer.y,
    ...DEFAULT_TRANSFORM_FIELDS,
    maskMode: maskEditMode && !!activeLayer.mask,
    quickMaskMode: isQuickMaskMode,
  };
}

export function handleGradientUp(state: InteractionState): void {
  const engine = getEngine();
  if (engine) {
    gpuEndGradientPreview(engine);
    // The render path calls ensure_layer_full_size on the WASM side, which
    // expands a cropped layer texture. Sync the JS store so layer.x/y/w/h
    // match the new GPU texture extent — otherwise downstream operations
    // (cmd+click alpha selection, content bounds) read the stale offsets
    // and produce misaligned results. Issue #494.
    if (state.layerId && !state.maskMode && !state.quickMaskMode) {
      syncLayerAfterFullSize(engine, state.layerId);
    }
  }
  useUIStore.getState().setGradientPreview(null);

  if (engine && state.layerId && !state.maskMode && !state.quickMaskMode) {
    const bounds = getLayerEngineBounds(engine, state.layerId);
    if (bounds.length === 4) {
      const [ex, ey, ew, eh] = bounds;
      const store = useEditorStore.getState();
      const layer = store.document.layers.find((l) => l.id === state.layerId);
      if (layer && (layer.x !== ex || layer.y !== ey)) {
        useEditorStore.setState((s) => ({
          document: {
            ...s.document,
            layers: s.document.layers.map((l) =>
              l.id === state.layerId
                ? { ...l, x: ex!, y: ey!, ...('width' in l ? { width: ew!, height: eh! } : {}) } as typeof l
                : l,
            ),
          },
        }));
      }
    }
  }
}

export function handleGradientMove(state: InteractionState, layerLocalPos: Point, metaKey = false): void {
  if (!state.startPoint || !state.layerId) return;

  const toolSettings = useToolSettingsStore.getState();
  const gradType = toolSettings.settings.gradient.type;
  const reverse = toolSettings.settings.gradient.reverse;

  const engine = getEngine();
  if (!engine) return;

  const stops = toolSettings.settings.gradient.stops.map((s) => {
    const c = toDocumentColor(s.color);
    return {
      position: reverse ? 1 - s.position : s.position,
      r: c.r / 255,
      g: c.g / 255,
      b: c.b / 255,
      a: c.a,
    };
  });
  if (reverse) stops.reverse();
  const stopsJson = JSON.stringify(stops);

  const startX = state.startPoint.x + state.layerStartX;
  const startY = state.startPoint.y + state.layerStartY;
  let endX = layerLocalPos.x + state.layerStartX;
  let endY = layerLocalPos.y + state.layerStartY;

  if (metaKey) {
    const dx = endX - startX;
    const dy = endY - startY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const rawAngle = Math.atan2(dy, dx);
    const snapRad = Math.PI / 12; // 15 degrees
    const snappedAngle = Math.round(rawAngle / snapRad) * snapRad;
    endX = startX + dist * Math.cos(snappedAngle);
    endY = startY + dist * Math.sin(snappedAngle);
  }

  if (state.quickMaskMode) {
    if (gradType === 'linear') {
      gpuRenderQuickMaskLinearGradient(engine, startX, startY, endX, endY, stopsJson);
    } else {
      const dx = endX - startX;
      const dy = endY - startY;
      const radius = Math.sqrt(dx * dx + dy * dy);
      gpuRenderQuickMaskRadialGradient(engine, startX, startY, radius, stopsJson);
    }
  } else if (state.maskMode) {
    if (gradType === 'linear') {
      gpuRenderMaskLinearGradient(engine, state.layerId, startX, startY, endX, endY, stopsJson);
    } else {
      const dx = endX - startX;
      const dy = endY - startY;
      const radius = Math.sqrt(dx * dx + dy * dy);
      gpuRenderMaskRadialGradient(engine, state.layerId, startX, startY, radius, stopsJson);
    }
  } else {
    if (gradType === 'linear') {
      gpuRenderLinearGradient(engine, state.layerId, startX, startY, endX, endY, stopsJson);
    } else {
      const dx = endX - startX;
      const dy = endY - startY;
      const radius = Math.sqrt(dx * dx + dy * dy);
      gpuRenderRadialGradient(engine, state.layerId, startX, startY, radius, stopsJson);
    }
    clearJsPixelData(state.layerId);
  }

  useEditorStore.getState().notifyRender();

  useUIStore.getState().setGradientPreview({
    start: { x: startX, y: startY },
    end: { x: endX, y: endY },
  });
}
