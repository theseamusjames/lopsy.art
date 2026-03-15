import {
  hitTestHandle,
  isScaleHandle,
  isRotateHandle,
  computeScale,
  computeRotation,
  applyTransformToMask,
} from '../../tools/transform/transform';
import type { TransformState } from '../../tools/transform/transform';
import { getSelectionMaskValue } from '../../selection/selection';
import { useUIStore } from '../ui-store';
import { useEditorStore } from '../editor-store';
import type { InteractionState, InteractionContext } from './interaction-types';
import type { Point } from '../../types';

/**
 * Hit-test transform handles on mousedown and set up interaction state.
 * Returns InteractionState if a handle was hit, null otherwise (so the
 * caller can fall through to the tool switch).
 */
export function handleTransformDown(ctx: InteractionContext): InteractionState | null {
  const { canvasPos, activeLayerId, activeLayer, floatingSelectionRef, persistentTransformRef } = ctx;

  const uiState = useUIStore.getState();
  const currentTransform = uiState.transform;
  const editorState = useEditorStore.getState();

  if (!currentTransform || !editorState.selection.active) {
    return null;
  }

  const handleRadius = 8 / editorState.viewport.zoom;
  const hit = hitTestHandle(canvasPos, currentTransform, handleRadius);

  if (!hit) {
    return null;
  }

  const startAngle = isRotateHandle(hit)
    ? computeRotation(canvasPos, currentTransform) - currentTransform.rotation
    : 0;

  const sel = editorState.selection;
  editorState.pushHistory();

  // Clear floating selection when entering transform mode.
  // The persistent transform canvases should already be built
  // from the move mouseup (with correctly separated content).
  floatingSelectionRef.current = null;

  // On first grab: cut pixels into persistent offscreen canvases.
  // On subsequent grabs: reuse them so we always transform from the
  // original unmodified pixels (no re-extraction degradation).
  if (!persistentTransformRef.current && sel.active && sel.mask) {
    const imageData = editorState.getOrCreateLayerPixelData(activeLayerId);
    const w = imageData.width;
    const h = imageData.height;

    const txCanvas = document.createElement('canvas');
    txCanvas.width = w;
    txCanvas.height = h;
    const txCtx = txCanvas.getContext('2d');

    const bCanvas = document.createElement('canvas');
    bCanvas.width = w;
    bCanvas.height = h;
    const bCtx = bCanvas.getContext('2d');

    if (txCtx && bCtx) {
      const floatedData = new ImageData(new Uint8ClampedArray(imageData.data), w, h);
      const baseData = new ImageData(new Uint8ClampedArray(imageData.data), w, h);

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = (y * w + x) * 4;
          if (getSelectionMaskValue(sel, x + activeLayer.x, y + activeLayer.y) > 0) {
            baseData.data[idx] = 0;
            baseData.data[idx + 1] = 0;
            baseData.data[idx + 2] = 0;
            baseData.data[idx + 3] = 0;
          } else {
            floatedData.data[idx] = 0;
            floatedData.data[idx + 1] = 0;
            floatedData.data[idx + 2] = 0;
            floatedData.data[idx + 3] = 0;
          }
        }
      }
      txCtx.putImageData(floatedData, 0, 0);
      bCtx.putImageData(baseData, 0, 0);

      persistentTransformRef.current = {
        transformCanvas: txCanvas,
        baseCanvas: bCanvas,
        originalMask: new Uint8ClampedArray(sel.mask),
        maskWidth: sel.maskWidth,
        maskHeight: sel.maskHeight,
      };
    }
  }

  const persistent = persistentTransformRef.current;

  const activeTool = uiState.activeTool;

  const newState: InteractionState = {
    drawing: true,
    lastPoint: canvasPos,
    pixelBuffer: null,
    originalPixelBuffer: null,
    layerId: activeLayerId,
    tool: activeTool,
    startPoint: canvasPos,
    layerStartX: 0,
    layerStartY: 0,
    maskMode: false,
    transformHandle: hit,
    transformStartState: { ...currentTransform },
    transformStartAngle: startAngle,
    originalSelectionMask: persistent?.originalMask ?? null,
    originalSelectionMaskWidth: persistent?.maskWidth ?? 0,
    originalSelectionMaskHeight: persistent?.maskHeight ?? 0,
    transformCanvas: persistent?.transformCanvas ?? null,
    baseCanvas: persistent?.baseCanvas ?? null,
    moveOriginalMask: null,
    moveOriginalBounds: null,
  };

  uiState.setActiveTransformHandle(hit);

  return newState;
}

/**
 * Handle transform drag (scale / rotate) during mousemove.
 * Computes the new transform, updates the UI store, transforms the
 * selection mask, and composites the transformed pixels onto the base.
 */
export function handleTransformMove(
  state: InteractionState,
  canvasPos: Point,
  shiftKey: boolean,
): void {
  if (!state.transformHandle || !state.transformStartState || !state.startPoint) {
    return;
  }

  const handle = state.transformHandle;
  const startState = state.transformStartState;

  let newTransform: TransformState;

  if (isScaleHandle(handle)) {
    const result = computeScale(
      handle,
      state.startPoint,
      canvasPos,
      startState,
      shiftKey,
    );
    newTransform = {
      ...startState,
      scaleX: result.scaleX,
      scaleY: result.scaleY,
      translateX: result.translateX,
      translateY: result.translateY,
    };
  } else {
    const currentAngle = computeRotation(canvasPos, startState);
    const newRotation = currentAngle - state.transformStartAngle;
    const snappedRotation = shiftKey
      ? Math.round(newRotation / (Math.PI / 12)) * (Math.PI / 12)
      : newRotation;
    newTransform = {
      ...startState,
      rotation: snappedRotation,
    };
  }

  useUIStore.getState().setTransform(newTransform);

  // Update selection mask using the original mask (not the already-transformed one)
  const editorState = useEditorStore.getState();
  const origMask = state.originalSelectionMask;
  let transformedMask: Uint8ClampedArray | null = null;
  let transformedMaskWidth = 0;
  if (origMask) {
    const { mask, bounds } = applyTransformToMask(
      origMask, state.originalSelectionMaskWidth, state.originalSelectionMaskHeight, newTransform,
    );
    transformedMask = mask;
    transformedMaskWidth = state.originalSelectionMaskWidth;
    if (bounds) {
      editorState.setSelection(bounds, mask, state.originalSelectionMaskWidth, state.originalSelectionMaskHeight);
    }
  }

  // Apply full cumulative transform to the original (persistent) pixels
  if (state.transformCanvas && state.baseCanvas && state.layerId) {
    const w = state.baseCanvas.width;
    const h = state.baseCanvas.height;

    const origBounds = newTransform.originalBounds;
    const origCx = origBounds.x + origBounds.width / 2;
    const origCy = origBounds.y + origBounds.height / 2;

    // Render rotated content onto a separate canvas
    const rotatedCanvas = document.createElement('canvas');
    rotatedCanvas.width = w;
    rotatedCanvas.height = h;
    const rotCtx = rotatedCanvas.getContext('2d');
    if (rotCtx) {
      rotCtx.save();
      rotCtx.translate(origCx + newTransform.translateX, origCy + newTransform.translateY);
      rotCtx.rotate(newTransform.rotation);
      rotCtx.scale(newTransform.scaleX, newTransform.scaleY);
      rotCtx.translate(-origCx, -origCy);
      rotCtx.drawImage(state.transformCanvas, 0, 0);
      rotCtx.restore();

      // Composite: base + rotated pixels clipped to selection mask
      const baseData = state.baseCanvas.getContext('2d')!.getImageData(0, 0, w, h);
      const rotData = rotCtx.getImageData(0, 0, w, h);
      const resultData = new ImageData(new Uint8ClampedArray(baseData.data), w, h);

      for (let py = 0; py < h; py++) {
        for (let px = 0; px < w; px++) {
          const idx = (py * w + px) * 4;
          const ra = rotData.data[idx + 3] ?? 0;
          if (ra <= 0) continue;
          // Clip to selection mask so rotated content doesn't bleed outside
          if (transformedMask) {
            const maskVal = transformedMask[py * transformedMaskWidth + px] ?? 0;
            if (maskVal <= 0) continue;
          }
          // Alpha-composite rotated over base
          const ba = resultData.data[idx + 3] ?? 0;
          const raNorm = ra / 255;
          const baNorm = ba / 255;
          const outA = raNorm + baNorm * (1 - raNorm);
          if (outA > 0) {
            resultData.data[idx] = Math.round(
              ((rotData.data[idx] ?? 0) * raNorm + (resultData.data[idx] ?? 0) * baNorm * (1 - raNorm)) / outA,
            );
            resultData.data[idx + 1] = Math.round(
              ((rotData.data[idx + 1] ?? 0) * raNorm + (resultData.data[idx + 1] ?? 0) * baNorm * (1 - raNorm)) / outA,
            );
            resultData.data[idx + 2] = Math.round(
              ((rotData.data[idx + 2] ?? 0) * raNorm + (resultData.data[idx + 2] ?? 0) * baNorm * (1 - raNorm)) / outA,
            );
            resultData.data[idx + 3] = Math.round(outA * 255);
          }
        }
      }

      useEditorStore.getState().updateLayerPixelData(state.layerId, resultData);
    }
  }

  editorState.notifyRender();
}
