import type { MutableRefObject } from 'react';
import type { Point } from '../../types';
import { snapPositionToGrid, snapPositionToLayers } from '../../tools/move/move';
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
  readQuickMaskPixels,
  uploadQuickMaskPixels,
} from '../../engine-wasm/wasm-bridge';
import { selectLayerAlpha } from '../../panels/LayerPanel/layer-selection';
import type {
  InteractionState,
  InteractionContext,
  FloatingSelection,
  PersistentTransform,
} from './interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from './interaction-types';
import { translateSelectionMask, translateQuickMaskContent } from './quick-mask-move';
import { consumePrefloat, cancelPrefloat } from './prefloat';

interface QuickMaskSnapshot {
  pixels: Uint8Array;
  width: number;
  height: number;
}

function snapshotQuickMaskPixels(): QuickMaskSnapshot | null {
  const engine = getEngine();
  if (!engine) return null;
  const buf = readQuickMaskPixels(engine);
  if (buf.length <= 8) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const width = dv.getInt32(0, true);
  const height = dv.getInt32(4, true);
  if (width <= 0 || height <= 0) return null;
  return { pixels: buf.subarray(8), width, height };
}

export function handleMoveDown(ctx: InteractionContext): InteractionState {
  const editorState = useEditorStore.getState();
  const sel = editorState.selection;
  const isQuickMaskMode = useUIStore.getState().maskMode === 'quickMask';
  const {
    canvasPos,
    altKey,
    activeLayer,
    floatingSelectionRef,
    persistentTransformRef,
  } = ctx;
  let { activeLayerId } = ctx;

  // Check for pre-built snapshot from prefloat before falling back to pushHistory.
  const prebuilt = !altKey && sel.active && sel.mask
    ? consumePrefloat(activeLayerId, sel.mask)
    : null;
  if (prebuilt) {
    editorState.pushPrebuiltSnapshot(prebuilt.snapshot);
  } else {
    cancelPrefloat();
    editorState.pushHistory(altKey && !(sel.active && sel.mask) ? 'Duplicate Layer' : 'Move');
  }

  // Quick-mask mode + active marquee: snapshot the painted quick-mask
  // pixels so subsequent move events can translate the content with the
  // marquee (issue #315). The layer texture stays untouched.
  if (isQuickMaskMode && sel.active && sel.mask) {
    const snapshot = snapshotQuickMaskPixels();
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
      moveOriginalMask: new Uint8ClampedArray(sel.mask),
      moveOriginalBounds: { ...sel.bounds! },
      quickMaskOriginalPixels: snapshot?.pixels ?? null,
      quickMaskOriginalWidth: snapshot?.width ?? 0,
      quickMaskOriginalHeight: snapshot?.height ?? 0,
    };
  }

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
    } else if (prebuilt) {
      // Prefloat already set up the GPU float
      floatingSelectionRef.current = {
        offsetX: 0,
        offsetY: 0,
        originalMask: new Uint8ClampedArray(prebuilt.mask),
        originalBounds: { ...prebuilt.bounds },
        gpuResident: true,
      };
    } else if (engine && selNow.active && selNow.mask) {
      const maskBytes = new Uint8Array(selNow.mask.buffer, selNow.mask.byteOffset, selNow.mask.byteLength);
      setSelectionMask(engine, maskBytes, selNow.maskWidth, selNow.maskHeight);

      const floatBoundsMove = floatSelection(engine, activeLayerId);
      compositeFloat(engine, 0, 0);

      if (floatBoundsMove.length >= 4) {
        const newX = floatBoundsMove[0]!;
        const newY = floatBoundsMove[1]!;
        const curLayer = useEditorStore.getState().document.layers.find(l => l.id === activeLayerId);
        if (curLayer && (curLayer.x !== newX || curLayer.y !== newY)) {
          useEditorStore.getState().updateLayerPosition(activeLayerId, newX, newY);
        }
      }

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

  // Quick-mask + marquee move: translate both the marquee outline AND the
  // painted quick-mask content under it (issue #315). The layer texture is
  // untouched — only the quick-mask texture moves.
  if (
    useUIStore.getState().maskMode === 'quickMask'
    && !floatingSelectionRef.current
    && state.moveOriginalMask
    && state.moveOriginalBounds
  ) {
    const edState = useEditorStore.getState();
    const { width: docW, height: docH } = edState.document;
    const { mask: newMask, bounds: newBounds } = translateSelectionMask(
      state.moveOriginalMask,
      state.moveOriginalBounds,
      dragDx,
      dragDy,
      docW,
      docH,
    );
    edState.setSelection(newBounds, newMask, docW, docH);
    useUIStore.getState().setTransform(createTransformState(newBounds));

    const engine = getEngine();
    if (
      engine
      && state.quickMaskOriginalPixels
      && state.quickMaskOriginalWidth === docW
      && state.quickMaskOriginalHeight === docH
    ) {
      const newPixels = translateQuickMaskContent(
        state.quickMaskOriginalPixels,
        state.moveOriginalMask,
        dragDx,
        dragDy,
        docW,
        docH,
      );
      uploadQuickMaskPixels(engine, newPixels, docW, docH);
    }
    edState.notifyRender();
    return;
  }

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

    // Update bounds and transform only — skip expensive mask translation
    // during the drag. The marching ants renderer already applies the
    // transform offset via ctx.translate(). The mask is materialized
    // once in handleMoveUp.
    if (state.moveOriginalBounds) {
      const newBounds = {
        x: state.moveOriginalBounds.x + dx,
        y: state.moveOriginalBounds.y + dy,
        width: state.moveOriginalBounds.width,
        height: state.moveOriginalBounds.height,
      };
      useEditorStore.getState().setSelectionBounds(newBounds);
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
    if (uiState.snapToLayers) {
      const edState = useEditorStore.getState();
      const movingLayer = edState.document.layers.find((l) => l.id === state.layerId);
      const otherLayers = edState.document.layers.filter(
        (l) => l.id !== state.layerId && l.visible,
      );
      const movingWidth = movingLayer && movingLayer.type !== 'group' ? (movingLayer.width ?? 0) : 0;
      const movingHeight = movingLayer && movingLayer.type !== 'group' ? ((movingLayer as { height?: number }).height ?? 0) : 0;
      const snapResult = snapPositionToLayers(
        newX,
        newY,
        movingWidth,
        movingHeight,
        otherLayers,
        5,
      );
      newX = snapResult.x;
      newY = snapResult.y;
      const lines = [
        ...snapResult.snapLinesX.map((pos) => ({ orientation: 'vertical' as const, position: pos })),
        ...snapResult.snapLinesY.map((pos) => ({ orientation: 'horizontal' as const, position: pos })),
      ];
      uiState.setSnapLines(lines);
    } else {
      uiState.clearSnapLines();
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
  useUIStore.getState().clearSnapLines();
  if (!floatingSelectionRef.current || !state.startPoint) return;

  const dragDx = Math.round(canvasPos.x - state.startPoint.x);
  const dragDy = Math.round(canvasPos.y - state.startPoint.y);
  floatingSelectionRef.current.offsetX += dragDx;
  floatingSelectionRef.current.offsetY += dragDy;

  // Materialize the translated selection mask now that the drag is done.
  // During the drag we only updated bounds to avoid per-move mask copies.
  if (state.moveOriginalMask && state.moveOriginalBounds) {
    const edState = useEditorStore.getState();
    const { width: docW, height: docH } = edState.document;
    const dx = floatingSelectionRef.current.offsetX;
    const dy = floatingSelectionRef.current.offsetY;
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
  }

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
  const isQuickMaskMode = useUIStore.getState().maskMode === 'quickMask';
  editor.pushHistory('Nudge');

  // Quick-mask + marquee nudge: translate both the marquee outline AND the
  // painted quick-mask content under it (issue #315). The layer texture is
  // untouched — only the quick-mask texture moves.
  if (isQuickMaskMode && sel.active && sel.mask && sel.bounds) {
    const { width: docW, height: docH } = editor.document;
    const { mask: newMask, bounds: newBounds } = translateSelectionMask(
      sel.mask,
      sel.bounds,
      dx,
      dy,
      docW,
      docH,
    );

    const engine = getEngine();
    if (engine) {
      const snapshot = snapshotQuickMaskPixels();
      if (snapshot && snapshot.width === docW && snapshot.height === docH) {
        const newPixels = translateQuickMaskContent(
          snapshot.pixels,
          sel.mask,
          dx,
          dy,
          docW,
          docH,
        );
        uploadQuickMaskPixels(engine, newPixels, docW, docH);
      }
    }

    editor.setSelection(newBounds, newMask, docW, docH);
    useUIStore.getState().setTransform(createTransformState(newBounds));
    editor.notifyRender();
    return;
  }

  if (sel.active && sel.mask) {
    const engine = getEngine();
    if (!engine) return;

    // Float selection on GPU if not already floating
    if (!floatingSelectionRef.current) {
      // Ensure selection mask is on the GPU before floating
      const maskBytes = new Uint8Array(sel.mask.buffer, sel.mask.byteOffset, sel.mask.byteLength);
      setSelectionMask(engine, maskBytes, sel.maskWidth, sel.maskHeight);

      const floatBoundsDup = floatSelection(engine, activeId);
      compositeFloat(engine, 0, 0);

      // Sync expanded position to Zustand (text layers expand to diagonal size).
      if (floatBoundsDup.length >= 4) {
        const newX = floatBoundsDup[0]!;
        const newY = floatBoundsDup[1]!;
        const curLayer = useEditorStore.getState().document.layers.find(l => l.id === activeId);
        if (curLayer && (curLayer.x !== newX || curLayer.y !== newY)) {
          useEditorStore.getState().updateLayerPosition(activeId, newX, newY);
        }
      }

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
