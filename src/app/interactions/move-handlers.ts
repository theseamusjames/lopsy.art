import type { MutableRefObject } from 'react';
import type { Point } from '../../types';
import { PixelBuffer } from '../../engine/pixel-data';
import { getSelectionMaskValue } from '../../selection/selection';
import { snapPositionToGrid } from '../../tools/move/move';
import { createTransformState } from '../../tools/transform/transform';
import { useUIStore } from '../ui-store';
import { useEditorStore } from '../editor-store';
import type {
  InteractionState,
  InteractionContext,
  FloatingSelection,
  PersistentTransform,
} from './interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from './interaction-types';

export function handleMoveDown(ctx: InteractionContext): InteractionState {
  const editorState = useEditorStore.getState();
  editorState.pushHistory();

  const sel = editorState.selection;
  const {
    canvasPos,
    activeLayerId,
    activeLayer,
    pixelBuffer,
    floatingSelectionRef,
    persistentTransformRef,
  } = ctx;

  if (sel.active && sel.mask) {
    let floated: PixelBuffer;
    let base: PixelBuffer;
    const existing = floatingSelectionRef.current;

    if (existing) {
      // Reuse the persistent floating selection (don't re-cut)
      floated = existing.floated;
      base = existing.base;
    } else if (persistentTransformRef.current) {
      // After a rotate/scale, derive floating selection from
      // the already-separated transform canvases so we never
      // re-cut from the composited layer data.
      // We must render the transform canvas WITH the current
      // rotation/scale applied so the floated pixels reflect
      // the transformed state (not the original orientation).
      const ptRef = persistentTransformRef.current;
      const bCtx = ptRef.baseCanvas.getContext('2d');
      const w = ptRef.transformCanvas.width;
      const h = ptRef.transformCanvas.height;
      const currentXform = useUIStore.getState().transform;
      if (bCtx) {
        // Render the transform canvas with current rotation/scale
        const renderedCanvas = document.createElement('canvas');
        renderedCanvas.width = w;
        renderedCanvas.height = h;
        const rCtx = renderedCanvas.getContext('2d')!;
        if (currentXform && currentXform.rotation !== 0 || currentXform && (currentXform.scaleX !== 1 || currentXform.scaleY !== 1)) {
          const origBounds = sel.bounds!;
          const cx = origBounds.x + origBounds.width / 2;
          const cy = origBounds.y + origBounds.height / 2;
          rCtx.save();
          rCtx.translate(cx + currentXform.translateX, cy + currentXform.translateY);
          rCtx.rotate(currentXform.rotation);
          rCtx.scale(currentXform.scaleX, currentXform.scaleY);
          rCtx.translate(-cx, -cy);
          rCtx.drawImage(ptRef.transformCanvas, 0, 0);
          rCtx.restore();
        } else {
          rCtx.drawImage(ptRef.transformCanvas, 0, 0);
        }
        const renderedImg = rCtx.getImageData(0, 0, w, h);
        const bImg = bCtx.getImageData(0, 0, w, h);
        floated = PixelBuffer.fromImageData(renderedImg);
        base = PixelBuffer.fromImageData(bImg);

        // Build a new mask from the rendered (rotated) pixels so
        // the marching ants track the actual content, not the
        // pre-rotation selection shape.
        const edState = useEditorStore.getState();
        const { width: docW, height: docH } = edState.document;
        const newMask = new Uint8ClampedArray(docW * docH);
        let minX = docW, minY = docH, maxX = 0, maxY = 0;
        for (let py = 0; py < h && py < docH; py++) {
          for (let px = 0; px < w && px < docW; px++) {
            const alpha = renderedImg.data[(py * w + px) * 4 + 3] ?? 0;
            if (alpha > 0) {
              newMask[py * docW + px] = 255;
              if (px < minX) minX = px;
              if (px > maxX) maxX = px;
              if (py < minY) minY = py;
              if (py > maxY) maxY = py;
            }
          }
        }
        const newBounds = minX <= maxX
          ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
          : { ...sel.bounds! };
        edState.setSelection(newBounds, newMask, docW, docH);
        useUIStore.getState().setTransform(createTransformState(newBounds));

        floatingSelectionRef.current = {
          floated, base, offsetX: 0, offsetY: 0,
          originalMask: newMask,
          originalBounds: newBounds,
        };
      } else {
        // Fallback: cut from layer (shouldn't happen)
        base = pixelBuffer.clone();
        floated = new PixelBuffer(pixelBuffer.width, pixelBuffer.height);
        for (let y = 0; y < pixelBuffer.height; y++) {
          for (let x = 0; x < pixelBuffer.width; x++) {
            if (getSelectionMaskValue(sel, x + activeLayer.x, y + activeLayer.y) > 0) {
              floated.setPixel(x, y, pixelBuffer.getPixel(x, y));
              base.setPixel(x, y, { r: 0, g: 0, b: 0, a: 0 });
            }
          }
        }
        floatingSelectionRef.current = {
          floated, base, offsetX: 0, offsetY: 0,
          originalMask: new Uint8ClampedArray(sel.mask),
          originalBounds: { ...sel.bounds! },
        };
      }
    } else {
      // First move: cut selected pixels out of the layer
      base = pixelBuffer.clone();
      floated = new PixelBuffer(pixelBuffer.width, pixelBuffer.height);
      for (let y = 0; y < pixelBuffer.height; y++) {
        for (let x = 0; x < pixelBuffer.width; x++) {
          if (getSelectionMaskValue(sel, x + activeLayer.x, y + activeLayer.y) > 0) {
            floated.setPixel(x, y, pixelBuffer.getPixel(x, y));
            base.setPixel(x, y, { r: 0, g: 0, b: 0, a: 0 });
          }
        }
      }
      floatingSelectionRef.current = {
        floated, base, offsetX: 0, offsetY: 0,
        originalMask: new Uint8ClampedArray(sel.mask),
        originalBounds: { ...sel.bounds! },
      };
    }
    // Clear transform canvases — they'll be rebuilt at move mouseup
    persistentTransformRef.current = null;
    const floatRef = floatingSelectionRef.current!;
    return {
      drawing: true,
      lastPoint: canvasPos,
      pixelBuffer: floated,
      originalPixelBuffer: base,
      layerId: activeLayerId,
      tool: 'move',
      startPoint: canvasPos,
      layerStartX: 0,
      layerStartY: 0,
      ...DEFAULT_TRANSFORM_FIELDS,
      moveOriginalMask: floatRef.originalMask,
      moveOriginalBounds: floatRef.originalBounds,
    };
  }

  return {
    drawing: true,
    lastPoint: canvasPos,
    pixelBuffer: null,
    originalPixelBuffer: null,
    layerId: activeLayerId,
    tool: 'move',
    startPoint: canvasPos,
    layerStartX: activeLayer.x,
    layerStartY: activeLayer.y,
    ...DEFAULT_TRANSFORM_FIELDS,
  };
}

export function handleMoveMove(
  state: InteractionState,
  canvasPos: Point,
  floatingSelectionRef: MutableRefObject<FloatingSelection | null>,
): void {
  if (!state.startPoint) return;
  const dragDx = Math.round(canvasPos.x - state.startPoint.x);
  const dragDy = Math.round(canvasPos.y - state.startPoint.y);

  if (state.pixelBuffer && state.originalPixelBuffer) {
    // Total offset = persistent offset from prior moves + this drag's delta
    const floatState = floatingSelectionRef.current;
    let dx = (floatState?.offsetX ?? 0) + dragDx;
    let dy = (floatState?.offsetY ?? 0) + dragDy;
    const uiSnap = useUIStore.getState();
    if (uiSnap.showGrid && uiSnap.snapToGrid) {
      const snapped = snapPositionToGrid(dx, dy, uiSnap.gridSize);
      dx = snapped.x;
      dy = snapped.y;
    }
    // Moving selected pixels: composite floated pixels at offset onto the base
    const base = state.originalPixelBuffer.clone();
    const floated = state.pixelBuffer;
    for (let y = 0; y < floated.height; y++) {
      for (let x = 0; x < floated.width; x++) {
        const fp = floated.getPixel(x, y);
        if (fp.a <= 0) continue;
        const destX = x + dx;
        const destY = y + dy;
        if (destX < 0 || destX >= base.width || destY < 0 || destY >= base.height) continue;
        const bp = base.getPixel(destX, destY);
        const outA = fp.a + bp.a * (1 - fp.a);
        if (outA > 0) {
          base.setPixel(destX, destY, {
            r: Math.round((fp.r * fp.a + bp.r * bp.a * (1 - fp.a)) / outA),
            g: Math.round((fp.g * fp.a + bp.g * bp.a * (1 - fp.a)) / outA),
            b: Math.round((fp.b * fp.a + bp.b * bp.a * (1 - fp.a)) / outA),
            a: outA,
          });
        }
      }
    }
    useEditorStore.getState().updateLayerPixelData(state.layerId!, base.toImageData());

    // Shift selection bounds and mask to follow the moved content
    if (state.moveOriginalMask && state.moveOriginalBounds) {
      const edState = useEditorStore.getState();
      const { width: docW, height: docH } = edState.document;
      const origMask = state.moveOriginalMask;
      const newMask = new Uint8ClampedArray(docW * docH);
      for (let y = 0; y < docH; y++) {
        for (let x = 0; x < docW; x++) {
          const srcX = x - dx;
          const srcY = y - dy;
          if (srcX >= 0 && srcX < docW && srcY >= 0 && srcY < docH) {
            newMask[y * docW + x] = origMask[srcY * docW + srcX] ?? 0;
          }
        }
      }
      const newBounds = {
        x: state.moveOriginalBounds.x + dx,
        y: state.moveOriginalBounds.y + dy,
        width: state.moveOriginalBounds.width,
        height: state.moveOriginalBounds.height,
      };
      edState.setSelection(newBounds, newMask, docW, docH);
      useUIStore.getState().setTransform(createTransformState(newBounds));
    }
  } else {
    let newX = state.layerStartX + dragDx;
    let newY = state.layerStartY + dragDy;
    const uiState = useUIStore.getState();
    if (uiState.showGrid && uiState.snapToGrid) {
      const snapped = snapPositionToGrid(newX, newY, uiState.gridSize);
      newX = snapped.x;
      newY = snapped.y;
    }
    useEditorStore.getState().updateLayerPosition(
      state.layerId!,
      newX,
      newY,
    );
  }
}

export function handleMoveUp(
  state: InteractionState,
  canvasPos: Point,
  floatingSelectionRef: MutableRefObject<FloatingSelection | null>,
  persistentTransformRef: MutableRefObject<PersistentTransform | null>,
): void {
  if (!state.pixelBuffer || !state.startPoint || !floatingSelectionRef.current) return;

  const dragDx = Math.round(canvasPos.x - state.startPoint.x);
  const dragDy = Math.round(canvasPos.y - state.startPoint.y);
  floatingSelectionRef.current.offsetX += dragDx;
  floatingSelectionRef.current.offsetY += dragDy;

  // Build persistent transform canvases from the floating selection so
  // that a subsequent rotation (on any tool) uses the already-separated
  // floated/base pixel data instead of re-cutting from the composited layer.
  const floatRef = floatingSelectionRef.current;
  const sel = useEditorStore.getState().selection;
  if (sel.active && sel.bounds && sel.mask) {
    const baseImg = floatRef.base.toImageData();
    const floatedImg = floatRef.floated.toImageData();
    const w = baseImg.width;
    const h = baseImg.height;
    const txCanvas = document.createElement('canvas');
    txCanvas.width = w;
    txCanvas.height = h;
    const txCtx = txCanvas.getContext('2d');
    const bCanvas = document.createElement('canvas');
    bCanvas.width = w;
    bCanvas.height = h;
    const bCtx = bCanvas.getContext('2d');
    if (txCtx && bCtx) {
      const shifted = new ImageData(w, h);
      const ox = floatRef.offsetX;
      const oy = floatRef.offsetY;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const srcX = x - ox;
          const srcY = y - oy;
          if (srcX >= 0 && srcX < w && srcY >= 0 && srcY < h) {
            const di = (y * w + x) * 4;
            const si = (srcY * w + srcX) * 4;
            shifted.data[di] = floatedImg.data[si]!;
            shifted.data[di + 1] = floatedImg.data[si + 1]!;
            shifted.data[di + 2] = floatedImg.data[si + 2]!;
            shifted.data[di + 3] = floatedImg.data[si + 3]!;
          }
        }
      }
      txCtx.putImageData(shifted, 0, 0);
      bCtx.putImageData(baseImg, 0, 0);
      persistentTransformRef.current = {
        transformCanvas: txCanvas,
        baseCanvas: bCanvas,
        originalMask: new Uint8ClampedArray(sel.mask),
        maskWidth: sel.maskWidth,
        maskHeight: sel.maskHeight,
      };
    }
    useUIStore.getState().setTransform(createTransformState(sel.bounds));
  }
}

export function handleNudgeMove(
  dx: number,
  dy: number,
  floatingSelectionRef: MutableRefObject<FloatingSelection | null>,
  persistentTransformRef: MutableRefObject<PersistentTransform | null>,
): void {
  const editor = useEditorStore.getState();
  const activeId = editor.document.activeLayerId;
  if (!activeId) return;
  const layer = editor.document.layers.find((l) => l.id === activeId);
  if (!layer || layer.locked) return;

  const sel = editor.selection;
  editor.pushHistory();

  if (sel.active && sel.mask) {
    // Cut selected pixels into a floating buffer if not already floating
    const existing = floatingSelectionRef.current;
    let floated: PixelBuffer;
    let base: PixelBuffer;
    let origMask: Uint8ClampedArray;
    let origBounds: { x: number; y: number; width: number; height: number };

    if (existing) {
      floated = existing.floated;
      base = existing.base;
      origMask = existing.originalMask;
      origBounds = existing.originalBounds;
    } else {
      const imageData = editor.getOrCreateLayerPixelData(activeId);
      const pixelBuffer = PixelBuffer.fromImageData(imageData);
      base = pixelBuffer.clone();
      floated = new PixelBuffer(pixelBuffer.width, pixelBuffer.height);
      for (let y = 0; y < pixelBuffer.height; y++) {
        for (let x = 0; x < pixelBuffer.width; x++) {
          if (getSelectionMaskValue(sel, x + layer.x, y + layer.y) > 0) {
            floated.setPixel(x, y, pixelBuffer.getPixel(x, y));
            base.setPixel(x, y, { r: 0, g: 0, b: 0, a: 0 });
          }
        }
      }
      origMask = new Uint8ClampedArray(sel.mask);
      origBounds = { ...sel.bounds! };
      persistentTransformRef.current = null;
    }

    const newOffsetX = (existing?.offsetX ?? 0) + dx;
    const newOffsetY = (existing?.offsetY ?? 0) + dy;

    floatingSelectionRef.current = {
      floated, base, offsetX: newOffsetX, offsetY: newOffsetY,
      originalMask: origMask,
      originalBounds: origBounds,
    };

    // Composite floated onto base at new offset
    const composited = base.clone();
    for (let y = 0; y < floated.height; y++) {
      for (let x = 0; x < floated.width; x++) {
        const fp = floated.getPixel(x, y);
        if (fp.a <= 0) continue;
        const destX = x + newOffsetX;
        const destY = y + newOffsetY;
        if (destX < 0 || destX >= composited.width || destY < 0 || destY >= composited.height) continue;
        const bp = composited.getPixel(destX, destY);
        const outA = fp.a + bp.a * (1 - fp.a);
        if (outA > 0) {
          composited.setPixel(destX, destY, {
            r: Math.round((fp.r * fp.a + bp.r * bp.a * (1 - fp.a)) / outA),
            g: Math.round((fp.g * fp.a + bp.g * bp.a * (1 - fp.a)) / outA),
            b: Math.round((fp.b * fp.a + bp.b * bp.a * (1 - fp.a)) / outA),
            a: outA,
          });
        }
      }
    }
    editor.updateLayerPixelData(activeId, composited.toImageData());

    // Shift selection mask
    const { width: docW, height: docH } = editor.document;
    const newMask = new Uint8ClampedArray(docW * docH);
    for (let y = 0; y < docH; y++) {
      for (let x = 0; x < docW; x++) {
        const srcX = x - newOffsetX;
        const srcY = y - newOffsetY;
        if (srcX >= 0 && srcX < docW && srcY >= 0 && srcY < docH) {
          newMask[y * docW + x] = origMask[srcY * docW + srcX] ?? 0;
        }
      }
    }
    const newBounds = {
      x: origBounds.x + newOffsetX,
      y: origBounds.y + newOffsetY,
      width: origBounds.width,
      height: origBounds.height,
    };
    editor.setSelection(newBounds, newMask, docW, docH);
    useUIStore.getState().setTransform(createTransformState(newBounds));
  } else {
    editor.updateLayerPosition(activeId, layer.x + dx, layer.y + dy);
  }
}
