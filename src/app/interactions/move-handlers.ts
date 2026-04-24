import type { MutableRefObject } from 'react';
import type { Point } from '../../types';
import { snapPositionToGrid } from '../../tools/move/move';
import { createTransformState } from '../../tools/transform/transform';
import { useUIStore } from '../ui-store';
import { useEditorStore } from '../editor-store';
import { clearJsPixelData } from '../store/clear-js-pixel-data';
import { getEngine } from '../../engine-wasm/engine-state';
import {
  floatSelection,
  restoreFloatBase,
  compositeFloat,
  hasFloat,
  setSelectionMask,
} from '../../engine-wasm/wasm-bridge';
import { selectLayerAlpha } from '../../panels/LayerPanel/layer-selection';
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
    altKey,
    activeLayer,
    floatingSelectionRef,
    persistentTransformRef,
  } = ctx;
  let { activeLayerId } = ctx;

  // Option+drag with no selection: duplicate layer first, then move the copy
  if (altKey && !(sel.active && sel.mask)) {
    editorState.duplicateLayer();
    const newState = useEditorStore.getState();
    activeLayerId = newState.document.activeLayerId ?? activeLayerId;
  }

  if (sel.active && sel.mask) {
    const engine = getEngine();

    // If a transform float is active (persistentTransformRef set), commit it
    // first so the layer texture has the transformed content and we can
    // re-select from the actual pixel alpha before floating for the move.
    // selectLayerAlpha handles: dropFloat + clear JS data + rebuild mask.
    if (persistentTransformRef.current) {
      persistentTransformRef.current = null;
      floatingSelectionRef.current = null;
      selectLayerAlpha(activeLayerId);

      // Force-sync the new selection mask to GPU immediately so the
      // subsequent floatSelection uses the correct mask (not the stale one
      // from before the transform was committed).
      const selAfter = useEditorStore.getState().selection;
      if (engine && selAfter.active && selAfter.mask) {
        const maskBytes = new Uint8Array(selAfter.mask.buffer, selAfter.mask.byteOffset, selAfter.mask.byteLength);
        setSelectionMask(engine, maskBytes, selAfter.maskWidth, selAfter.maskHeight);
      }
    }

    // If the GPU float was dropped (e.g., by cmd+click re-select),
    // clear the stale JS refs so we re-float with the current selection.
    if (floatingSelectionRef.current && engine && !hasFloat(engine)) {
      floatingSelectionRef.current = null;
      persistentTransformRef.current = null;
    }

    // Re-read selection after potential mask rebuild
    const selNow = useEditorStore.getState().selection;

    if (floatingSelectionRef.current) {
      // Reuse existing float — GPU already has the textures
    } else if (engine && selNow.active && selNow.mask) {
      // Ensure selection mask is on the GPU before floating
      const maskBytes = new Uint8Array(selNow.mask.buffer, selNow.mask.byteOffset, selNow.mask.byteLength);
      setSelectionMask(engine, maskBytes, selNow.maskWidth, selNow.maskHeight);

      // First move: float the selection on the GPU
      floatSelection(engine, activeLayerId);
      compositeFloat(engine, 0, 0);

      // Option+drag: restore the float base so selected pixels remain in
      // place — floatSelection cuts them, but option means "copy, don't cut".
      if (altKey) {
        restoreFloatBase(engine, activeLayerId);
      }

      clearJsPixelData(activeLayerId);

      floatingSelectionRef.current = {
        offsetX: 0,
        offsetY: 0,
        originalMask: new Uint8ClampedArray(selNow.mask),
        originalBounds: { ...selNow.bounds! },
        gpuResident: true,
      };
    }

    // Clear persistentTransformRef — transform is committed
    persistentTransformRef.current = null;
    const floatRef = floatingSelectionRef.current!;
    return {
      drawing: true,
      lastPoint: canvasPos,
      pixelBuffer: null,
      originalPixelBuffer: null,
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

  // Crop the layer to content bounds before moving so that only opaque
  // pixels are repositioned — transparent areas should stay behind.
  editorState.expandLayerForEditing(activeLayerId);
  editorState.cropLayerToContent(activeLayerId);
  const croppedLayer = useEditorStore.getState().document.layers.find(
    (l) => l.id === activeLayerId,
  );

  return {
    drawing: true,
    lastPoint: canvasPos,
    pixelBuffer: null,
    originalPixelBuffer: null,
    layerId: activeLayerId,
    tool: 'move',
    startPoint: canvasPos,
    layerStartX: croppedLayer?.x ?? activeLayer.x,
    layerStartY: croppedLayer?.y ?? activeLayer.y,
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

  const engine = getEngine();
  if (floatingSelectionRef.current && engine && hasFloat(engine)) {
    // GPU path: composite float at new offset
    const floatState = floatingSelectionRef.current;
    let dx = floatState.offsetX + dragDx;
    let dy = floatState.offsetY + dragDy;
    const uiSnap = useUIStore.getState();
    if (uiSnap.showGrid && uiSnap.snapToGrid) {
      const snapped = snapPositionToGrid(dx, dy, uiSnap.gridSize);
      dx = snapped.x;
      dy = snapped.y;
    }

    compositeFloat(engine, dx, dy);
    useEditorStore.getState().notifyRender();

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
    // No selection: just move the layer position
    let newX = state.layerStartX + dragDx;
    let newY = state.layerStartY + dragDy;
    const uiState = useUIStore.getState();
    if (uiState.showGrid && uiState.snapToGrid) {
      const { width: docW, height: docH } = useEditorStore.getState().document;
      const snapped = snapPositionToGrid(newX, newY, uiState.gridSize, docW, docH);
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
  _persistentTransformRef: MutableRefObject<PersistentTransform | null>,
): void {
  if (!floatingSelectionRef.current || !state.startPoint) return;

  const dragDx = Math.round(canvasPos.x - state.startPoint.x);
  const dragDy = Math.round(canvasPos.y - state.startPoint.y);
  floatingSelectionRef.current.offsetX += dragDx;
  floatingSelectionRef.current.offsetY += dragDy;

  // Rebuild transform state for potential subsequent rotation
  const sel = useEditorStore.getState().selection;
  if (sel.active && sel.bounds) {
    useUIStore.getState().setTransform(createTransformState(sel.bounds));
  }
}

export function handleNudgeMove(
  dx: number,
  dy: number,
  floatingSelectionRef: MutableRefObject<FloatingSelection | null>,
  _persistentTransformRef: MutableRefObject<PersistentTransform | null>,
): void {
  const editor = useEditorStore.getState();
  const activeId = editor.document.activeLayerId;
  if (!activeId) return;
  const layer = editor.document.layers.find((l) => l.id === activeId);
  if (!layer || layer.locked) return;

  const sel = editor.selection;
  editor.pushHistory();

  if (sel.active && sel.mask) {
    const engine = getEngine();
    if (!engine) return;

    // Float selection on GPU if not already floating
    if (!floatingSelectionRef.current) {
      // Ensure selection mask is on the GPU before floating
      const maskBytes = new Uint8Array(sel.mask.buffer, sel.mask.byteOffset, sel.mask.byteLength);
      setSelectionMask(engine, maskBytes, sel.maskWidth, sel.maskHeight);

      floatSelection(engine, activeId);
      compositeFloat(engine, 0, 0);

      clearJsPixelData(activeId);

      floatingSelectionRef.current = {
        offsetX: 0,
        offsetY: 0,
        originalMask: new Uint8ClampedArray(sel.mask),
        originalBounds: { ...sel.bounds! },
        gpuResident: true,
      };
    }

    const newOffsetX = floatingSelectionRef.current.offsetX + dx;
    const newOffsetY = floatingSelectionRef.current.offsetY + dy;
    floatingSelectionRef.current.offsetX = newOffsetX;
    floatingSelectionRef.current.offsetY = newOffsetY;

    compositeFloat(engine, newOffsetX, newOffsetY);

    // Shift selection mask
    const { width: docW, height: docH } = editor.document;
    const origMask = floatingSelectionRef.current.originalMask;
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
    const origBounds = floatingSelectionRef.current.originalBounds;
    const newBounds = {
      x: origBounds.x + newOffsetX,
      y: origBounds.y + newOffsetY,
      width: origBounds.width,
      height: origBounds.height,
    };
    editor.setSelection(newBounds, newMask, docW, docH);
    useUIStore.getState().setTransform(createTransformState(newBounds));
    editor.notifyRender();
  } else {
    editor.updateLayerPosition(activeId, layer.x + dx, layer.y + dy);
  }
}
