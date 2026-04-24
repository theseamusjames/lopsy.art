import type { InteractionContext, InteractionState } from '../../app/interactions/interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from '../../app/interactions/interaction-types';
import type { Point } from '../../types';
import { useUIStore } from '../../app/ui-store';
import { useEditorStore } from '../../app/editor-store';
import { useToolSettingsStore } from '../../app/tool-settings-store';

export function handleCropDown(ctx: InteractionContext): InteractionState {
  const { canvasPos, activeLayerId } = ctx;
  useUIStore.getState().setCropRect(null);
  return {
    drawing: true,
    lastPoint: canvasPos,
    pixelBuffer: null,
    originalPixelBuffer: null,
    layerId: activeLayerId,
    tool: 'crop',
    startPoint: canvasPos,
    layerStartX: 0,
    layerStartY: 0,
    ...DEFAULT_TRANSFORM_FIELDS,
  };
}

export function handleCropMove(state: InteractionState, canvasPos: Point): void {
  if (!state.startPoint) return;
  const edDoc = useEditorStore.getState().document;
  const toolSettings = useToolSettingsStore.getState();
  const x1 = Math.max(0, Math.min(state.startPoint.x, canvasPos.x));
  const y1 = Math.max(0, Math.min(state.startPoint.y, canvasPos.y));
  const x2 = Math.min(edDoc.width, Math.max(state.startPoint.x, canvasPos.x));
  const y2 = Math.min(edDoc.height, Math.max(state.startPoint.y, canvasPos.y));
  let cw = x2 - x1;
  let ch = y2 - y1;
  if (toolSettings.aspectRatioLocked && toolSettings.aspectRatioW > 0 && toolSettings.aspectRatioH > 0) {
    const ratio = toolSettings.aspectRatioW / toolSettings.aspectRatioH;
    if (cw / ch > ratio) {
      cw = ch * ratio;
    } else {
      ch = cw / ratio;
    }
  }
  if (cw > 0 && ch > 0) {
    useUIStore.getState().setCropRect({ x: x1, y: y1, width: cw, height: ch });
    useEditorStore.getState().notifyRender();
  }
}

export function handleCropUp(state: InteractionState): void {
  if (state.tool !== 'crop') return;
  const cropRect = useUIStore.getState().cropRect;
  if (cropRect && cropRect.width > 1 && cropRect.height > 1) {
    useEditorStore.getState().cropCanvas(cropRect);
  }
  useUIStore.getState().setCropRect(null);
}
