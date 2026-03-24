import type { MutableRefObject } from 'react';
import type { Point } from '../../types';
import { snapPositionToGrid } from '../../tools/move/move';
import { createTransformState } from '../../tools/transform/transform';
import { useUIStore } from '../ui-store';
import { useEditorStore } from '../editor-store';
import { getEngine } from '../../engine-wasm/engine-state';
import {
  floatSelection,
  compositeFloat,
  hasFloat,
} from '../../engine-wasm/wasm-bridge';
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
    floatingSelectionRef,
    persistentTransformRef,
  } = ctx;

  if (sel.active && sel.mask) {
    const engine = getEngine();

    if (floatingSelectionRef.current) {
      // Reuse existing float — GPU already has the textures
    } else if (engine) {
      // First move: float the selection on the GPU
      floatSelection(engine, activeLayerId);

      // Clear stale JS pixel data
      const state = useEditorStore.getState();
      const pixelDataMap = new Map(state.layerPixelData);
      pixelDataMap.delete(activeLayerId);
      const sparseMap = new Map(state.sparseLayerData);
      sparseMap.delete(activeLayerId);
      const dirtyIds = new Set(state.dirtyLayerIds);
      dirtyIds.add(activeLayerId);
      useEditorStore.setState({
        layerPixelData: pixelDataMap,
        sparseLayerData: sparseMap,
        dirtyLayerIds: dirtyIds,
      });

      floatingSelectionRef.current = {
        offsetX: 0,
        offsetY: 0,
        originalMask: new Uint8ClampedArray(sel.mask),
        originalBounds: { ...sel.bounds! },
        gpuResident: true,
      };
    }

    // Clear transform canvases — they'll be rebuilt at move mouseup
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
      floatSelection(engine, activeId);

      // Clear stale JS pixel data
      const state = useEditorStore.getState();
      const pixelDataMap = new Map(state.layerPixelData);
      pixelDataMap.delete(activeId);
      const sparseMap = new Map(state.sparseLayerData);
      sparseMap.delete(activeId);
      const dirtyIds = new Set(state.dirtyLayerIds);
      dirtyIds.add(activeId);
      useEditorStore.setState({
        layerPixelData: pixelDataMap,
        sparseLayerData: sparseMap,
        dirtyLayerIds: dirtyIds,
      });

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
