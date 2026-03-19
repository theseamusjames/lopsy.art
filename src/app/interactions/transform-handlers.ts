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
import { createImageDataFromArray, contextOptions } from '../../engine/color-space';
import { useUIStore } from '../ui-store';
import { useEditorStore } from '../editor-store';
import { markLayerGpuDirty } from '../../engine-wasm/gpu-dirty';
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
    const txCtx = txCanvas.getContext('2d', contextOptions);

    const bCanvas = document.createElement('canvas');
    bCanvas.width = w;
    bCanvas.height = h;
    const bCtx = bCanvas.getContext('2d', contextOptions);

    if (txCtx && bCtx) {
      const floatedData = createImageDataFromArray(new Uint8ClampedArray(imageData.data), w, h);
      const baseData = createImageDataFromArray(new Uint8ClampedArray(imageData.data), w, h);

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
  if (origMask) {
    const { mask, bounds } = applyTransformToMask(
      origMask, state.originalSelectionMaskWidth, state.originalSelectionMaskHeight, newTransform,
    );
    transformedMask = mask;
    if (bounds) {
      editorState.setSelection(bounds, mask, state.originalSelectionMaskWidth, state.originalSelectionMaskHeight);
    }
  }

  // Apply full cumulative transform to the original (persistent) pixels.
  // During drag we write directly to the existing ImageData buffer and mark
  // GPU dirty — skipping the expensive cropLayerToContent + store update.
  // The full updateLayerPixelData is deferred to mouseup (finalize).
  if (state.transformCanvas && state.baseCanvas && state.layerId) {
    const layerData = useEditorStore.getState().expandLayerForEditing(state.layerId);
    if (!layerData) { editorState.notifyRender(); return; }

    const w = layerData.width;
    const h = layerData.height;

    const origBounds = newTransform.originalBounds;
    const origCx = origBounds.x + origBounds.width / 2;
    const origCy = origBounds.y + origBounds.height / 2;

    // Reuse a single scratch canvas (stored on the interaction state)
    if (!state._scratchCanvas || state._scratchCanvas.width !== w || state._scratchCanvas.height !== h) {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      state._scratchCanvas = c;
    }
    const rotCtx = state._scratchCanvas.getContext('2d', contextOptions);
    if (rotCtx) {
      rotCtx.clearRect(0, 0, w, h);
      rotCtx.save();
      rotCtx.translate(origCx + newTransform.translateX, origCy + newTransform.translateY);
      rotCtx.rotate(newTransform.rotation);
      rotCtx.scale(newTransform.scaleX, newTransform.scaleY);
      rotCtx.translate(-origCx, -origCy);
      rotCtx.drawImage(state.transformCanvas, 0, 0);
      rotCtx.restore();

      // Composite: base + rotated pixels clipped to selection mask
      // Write directly into existing layerData to avoid allocation
      const baseCtx = state.baseCanvas.getContext('2d', contextOptions)!;
      const baseData = baseCtx.getImageData(0, 0, w, h);
      const rotData = rotCtx.getImageData(0, 0, w, h);
      const out = layerData.data;

      // Copy base first
      out.set(baseData.data);

      // Composite rotated pixels on top
      for (let i = 0; i < w * h; i++) {
        const idx = i * 4;
        const ra = rotData.data[idx + 3]!;
        if (ra <= 0) continue;
        if (transformedMask) {
          const maskVal = transformedMask[i] ?? 0;
          if (maskVal <= 0) continue;
        }
        const ba = out[idx + 3]!;
        const raNorm = ra / 255;
        const baNorm = ba / 255;
        const outA = raNorm + baNorm * (1 - raNorm);
        if (outA > 0) {
          const invOutA = 1 / outA;
          out[idx] = (rotData.data[idx]! * raNorm + out[idx]! * baNorm * (1 - raNorm)) * invOutA + 0.5 | 0;
          out[idx + 1] = (rotData.data[idx + 1]! * raNorm + out[idx + 1]! * baNorm * (1 - raNorm)) * invOutA + 0.5 | 0;
          out[idx + 2] = (rotData.data[idx + 2]! * raNorm + out[idx + 2]! * baNorm * (1 - raNorm)) * invOutA + 0.5 | 0;
          out[idx + 3] = outA * 255 + 0.5 | 0;
        }
      }

      // Mark GPU dirty so the sync re-uploads the modified buffer (no store churn)
      markLayerGpuDirty(state.layerId);
    }
  }

  editorState.notifyRender();
}
