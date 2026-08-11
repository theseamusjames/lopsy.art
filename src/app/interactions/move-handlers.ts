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
  cropLayerToContent as cropLayerToContentGpu,
} from '../../engine-wasm/wasm-bridge';
import { selectLayerAlpha } from '../../panels/LayerPanel/layer-selection';
import type {
  InteractionState,
  InteractionContext,
  FloatingSelection,
  PersistentTransform,
  SiblingMoveTarget,
} from './interaction-types';
import { DEFAULT_TRANSFORM_FIELDS, withMoveGesture } from './interaction-types';
import { translateSelectionMask, translateQuickMaskContent } from './quick-mask-move';
import { consumePrefloat, cancelPrefloat } from './prefloat';
import { coalesceToAnimationFrame } from '../../utils/raf-coalesce';

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

/**
 * The quick-mask move path (issue #642) rebuilds a full document-sized
 * pixel buffer and uploads it to the GPU on every pointer-move. On a 4K
 * canvas a high-frequency pointer (250Hz pen tablet) can fire ~4 events
 * per frame — but only the last position ends up on screen. Coalesce
 * the CPU translate + GPU upload to rAF so we pay it once per rendered
 * frame instead of once per pointer event.
 *
 * Captured args are the current drag offset plus the snapshotted
 * originals from pointer-down (those are immutable for the drag).
 */
interface QuickMaskDragTarget {
  origPixels: Uint8Array;
  origMask: Uint8ClampedArray;
  docW: number;
  docH: number;
  lastAppliedDx: number;
  lastAppliedDy: number;
}

let quickMaskDragTarget: QuickMaskDragTarget | null = null;

function applyQuickMaskTranslate(dx: number, dy: number): void {
  const t = quickMaskDragTarget;
  if (!t) return;
  if (dx === t.lastAppliedDx && dy === t.lastAppliedDy) return;
  const engine = getEngine();
  if (!engine) return;
  const newPixels = translateQuickMaskContent(
    t.origPixels,
    t.origMask,
    dx,
    dy,
    t.docW,
    t.docH,
  );
  uploadQuickMaskPixels(engine, newPixels, t.docW, t.docH);
  t.lastAppliedDx = dx;
  t.lastAppliedDy = dy;
  useEditorStore.getState().notifyRender();
}

const coalescedQuickMaskTranslate = coalesceToAnimationFrame(applyQuickMaskTranslate);

/**
 * Sibling of `quickMaskDragTarget` for the selection-mask rebuild. Issue
 * #656: the quick-mask marquee move branch also rebuilds + reference-swaps
 * the selection mask on every pointer event, which reroutes `syncSelection`
 * into a full-doc `setSelectionMask` GPU upload every frame. Coalesce the
 * `translateSelectionMask` → `setSelection` → `setTransform` chain to rAF
 * so only the last position per rendered frame allocates + uploads.
 */
interface QuickMaskMaskTarget {
  origMask: Uint8ClampedArray;
  origBounds: { x: number; y: number; width: number; height: number };
  docW: number;
  docH: number;
  lastAppliedDx: number;
  lastAppliedDy: number;
}

let quickMaskMaskTarget: QuickMaskMaskTarget | null = null;

function applyQuickMaskMaskTranslate(dx: number, dy: number): void {
  const t = quickMaskMaskTarget;
  if (!t) return;
  if (dx === t.lastAppliedDx && dy === t.lastAppliedDy) return;
  const { mask: newMask, bounds: newBounds } = translateSelectionMask(
    t.origMask,
    t.origBounds,
    dx,
    dy,
    t.docW,
    t.docH,
  );
  useEditorStore.getState().setSelection(newBounds, newMask, t.docW, t.docH);
  useUIStore.getState().setTransform(createTransformState(newBounds));
  t.lastAppliedDx = dx;
  t.lastAppliedDy = dy;
}

const coalescedQuickMaskMaskTranslate = coalesceToAnimationFrame(applyQuickMaskMaskTranslate);

/** Test seam: flush any pending quick-mask translate + clear the drag target. */
export function flushQuickMaskDrag(): void {
  if (quickMaskDragTarget) {
    coalescedQuickMaskTranslate.flush();
    quickMaskDragTarget = null;
  }
  if (quickMaskMaskTarget) {
    coalescedQuickMaskMaskTranslate.flush();
    quickMaskMaskTarget = null;
  }
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
    const base: InteractionState = {
      drawing: true,
      lastPoint: canvasPos,
      layerId: activeLayerId,
      tool: 'move',
      startPoint: canvasPos,
      layerStartX: 0,
      layerStartY: 0,
      ...DEFAULT_TRANSFORM_FIELDS,
    };
    return withMoveGesture(base, {
      originalMask: new Uint8ClampedArray(sel.mask),
      originalBounds: { ...sel.bounds! },
      quickMaskOriginalPixels: snapshot?.pixels ?? null,
      quickMaskOriginalWidth: snapshot?.width ?? 0,
      quickMaskOriginalHeight: snapshot?.height ?? 0,
    });
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
        originalMask: prebuilt.mask,
        originalBounds: { ...prebuilt.bounds },
        gpuResident: true,
      };
    } else if (engine && selNow.active && selNow.mask) {
      const maskBytes = new Uint8Array(selNow.mask.buffer, selNow.mask.byteOffset, selNow.mask.byteLength);
      setSelectionMask(engine, maskBytes, selNow.maskWidth, selNow.maskHeight);

      const floatBoundsMove = floatSelection(engine, activeLayerId);
      compositeFloat(engine, 0, 0);

      // Sync expanded position only. Width/height are protected
      // engine-side (update_layer preserves them while a float is active).
      if (floatBoundsMove.length >= 2) {
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
    const baseFloat: InteractionState = {
      drawing: true,
      lastPoint: canvasPos,
      layerId: activeLayerId,
      tool: 'move',
      startPoint: canvasPos,
      layerStartX: 0,
      layerStartY: 0,
      ...DEFAULT_TRANSFORM_FIELDS,
    };
    return withMoveGesture(baseFloat, {
      originalMask: floatRef.originalMask,
      originalBounds: floatRef.originalBounds,
    });
  }

  // Crop the layer to content bounds before moving so that only opaque
  // pixels are repositioned — transparent areas should stay behind. Use
  // the GPU-side crop rather than expandLayerForEditing + cropLayerToContent,
  // which used to force a full JS-side GPU→CPU readback + CPU alpha scan +
  // 67 MB ImageData allocation on the pointer-down that begins the drag
  // (issue #701). The WASM path crops the actual GPU texture in place and
  // returns the new bounds so the Zustand layer can be aligned to match.
  // Raster-only: text/shape/group layers have no crop-to-content concept
  // and their GPU textures aren't managed the same way.
  const { x: croppedX, y: croppedY } = cropLayerAndReadPosition(activeLayer, activeLayerId);

  // Multi-layer move (issue #707): when several layers are selected, drag
  // the active one and translate every other selected layer by the same
  // delta. Each sibling captures its starting position (after crop) so we
  // can apply identical deltas without re-reading the document each move.
  const selectedIds = editorState.document.selectedLayerIds ?? [];
  const siblings: SiblingMoveTarget[] = [];
  for (const sid of selectedIds) {
    if (sid === activeLayerId) continue;
    const layer = useEditorStore.getState().document.layers.find((l) => l.id === sid);
    if (!layer || layer.locked) continue;
    const { x, y } = cropLayerAndReadPosition(layer, sid);
    siblings.push({ id: sid, startX: x, startY: y });
  }

  const baseWholeLayer: InteractionState = {
    drawing: true,
    lastPoint: canvasPos,
    layerId: activeLayerId,
    tool: 'move',
    startPoint: canvasPos,
    layerStartX: croppedX,
    layerStartY: croppedY,
    ...DEFAULT_TRANSFORM_FIELDS,
  };
  // Whole-layer move (no marquee): the move gesture still owns its
  // "no snapshot needed" state so consumers can pattern-match on
  // `state.gesture.kind === 'move'` regardless of whether pixels or a
  // marquee are being translated.
  return withMoveGesture(baseWholeLayer, { siblings });
}

function cropLayerAndReadPosition(
  layer: { id: string; type: string; x: number; y: number },
  layerId: string,
): { x: number; y: number } {
  let x = layer.x;
  let y = layer.y;
  const engine = getEngine();
  if (!engine || layer.type !== 'raster') return { x, y };
  const bounds = cropLayerToContentGpu(engine, layerId);
  if (bounds.length !== 4 || (bounds[2] ?? 0) <= 0) return { x, y };
  const newX = bounds[0]!;
  const newY = bounds[1]!;
  const newW = bounds[2]!;
  const newH = bounds[3]!;
  const width = (layer as { width?: number | null }).width ?? 0;
  const height = (layer as { height?: number | null }).height ?? 0;
  const boundsChanged =
    newX !== layer.x || newY !== layer.y ||
    newW !== width || newH !== height;
  if (boundsChanged) {
    useEditorStore.setState((s) => ({
      document: {
        ...s.document,
        layers: s.document.layers.map((l) =>
          l.id === layerId
            ? { ...l, x: newX, y: newY, width: newW, height: newH }
            : l,
        ),
      },
      renderVersion: s.renderVersion + 1,
    }));
    clearJsPixelData(layerId);
  }
  x = newX;
  y = newY;
  return { x, y };
}

export function handleMoveMove(
  state: InteractionState,
  canvasPos: Point,
  floatingSelectionRef: MutableRefObject<FloatingSelection | null>,
): void {
  if (!state.startPoint) return;
  const dragDx = Math.round(canvasPos.x - state.startPoint.x);
  const dragDy = Math.round(canvasPos.y - state.startPoint.y);
  // #444 — move-tool snapshots live on the `move` gesture variant.
  const move = state.gesture.kind === 'move' ? state.gesture : null;

  // Quick-mask + marquee move: translate both the marquee outline AND the
  // painted quick-mask content under it (issue #315). The layer texture is
  // untouched — only the quick-mask texture moves.
  if (
    useUIStore.getState().maskMode === 'quickMask'
    && !floatingSelectionRef.current
    && move
    && move.originalMask
    && move.originalBounds
  ) {
    const edState = useEditorStore.getState();
    const { width: docW, height: docH } = edState.document;

    // Selection-mask rebuild + setSelection + setTransform is the sibling
    // hot path (#656): translateSelectionMask allocates a docW*docH buffer,
    // and swapping the mask reference forces syncSelection to re-upload the
    // full-doc selection mask to the GPU on the next frame. Coalesce to rAF
    // so a burst of pointer events collapses to a single rebuild + upload
    // per rendered frame.
    if (
      !quickMaskMaskTarget
      || quickMaskMaskTarget.origMask !== move.originalMask
      || quickMaskMaskTarget.docW !== docW
      || quickMaskMaskTarget.docH !== docH
    ) {
      quickMaskMaskTarget = {
        origMask: move.originalMask,
        origBounds: { ...move.originalBounds },
        docW,
        docH,
        lastAppliedDx: Number.NaN,
        lastAppliedDy: Number.NaN,
      };
    }
    coalescedQuickMaskMaskTranslate(dragDx, dragDy);

    // Quick-mask pixel translate + GPU upload is the hot path (#642) —
    // coalesce to rAF so a 250Hz pen tablet issues one upload per
    // rendered frame, not one per pointer event.
    if (
      move.quickMaskOriginalPixels
      && move.quickMaskOriginalWidth === docW
      && move.quickMaskOriginalHeight === docH
    ) {
      if (
        !quickMaskDragTarget
        || quickMaskDragTarget.origPixels !== move.quickMaskOriginalPixels
        || quickMaskDragTarget.docW !== docW
        || quickMaskDragTarget.docH !== docH
      ) {
        quickMaskDragTarget = {
          origPixels: move.quickMaskOriginalPixels,
          origMask: move.originalMask,
          docW,
          docH,
          lastAppliedDx: Number.NaN,
          lastAppliedDy: Number.NaN,
        };
      }
      coalescedQuickMaskTranslate(dragDx, dragDy);
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
    if (move?.originalBounds) {
      const newBounds = {
        x: move.originalBounds.x + dx,
        y: move.originalBounds.y + dy,
        width: move.originalBounds.width,
        height: move.originalBounds.height,
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
    const siblingIds = new Set<string>(move?.siblings?.map((s) => s.id) ?? []);
    if (uiState.snapToLayers) {
      const edState = useEditorStore.getState();
      const movingLayer = edState.document.layers.find((l) => l.id === state.layerId);
      const otherLayers = edState.document.layers.filter(
        (l) => l.id !== state.layerId && !siblingIds.has(l.id) && l.visible,
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
    // Compute the actual delta applied to the active layer (may differ
    // from dragDx/Dy after snap) and use it for the siblings so they stay
    // rigidly in-formation with the active one.
    const appliedDx = newX - state.layerStartX;
    const appliedDy = newY - state.layerStartY;
    const editor = useEditorStore.getState();
    editor.updateLayerPosition(state.layerId!, newX, newY);
    if (move?.siblings) {
      for (const sib of move.siblings) {
        editor.updateLayerPosition(sib.id, sib.startX + appliedDx, sib.startY + appliedDy);
      }
    }
  }
}

export function handleMoveUp(
  state: InteractionState,
  canvasPos: Point,
  floatingSelectionRef: MutableRefObject<FloatingSelection | null>,
  _persistentTransformRef: MutableRefObject<PersistentTransform | null>,
): void {
  useUIStore.getState().clearSnapLines();

  // Flush any pending quick-mask translate so the final drop position is
  // materialized on the GPU before we clear the drag target.
  if (quickMaskDragTarget) {
    coalescedQuickMaskTranslate.flush();
    quickMaskDragTarget = null;
  }
  if (quickMaskMaskTarget) {
    coalescedQuickMaskMaskTranslate.flush();
    quickMaskMaskTarget = null;
  }

  if (!floatingSelectionRef.current || !state.startPoint) return;

  const dragDx = Math.round(canvasPos.x - state.startPoint.x);
  const dragDy = Math.round(canvasPos.y - state.startPoint.y);
  floatingSelectionRef.current.offsetX += dragDx;
  floatingSelectionRef.current.offsetY += dragDy;

  // Materialize the translated selection mask now that the drag is done.
  // During the drag we only updated bounds to avoid per-move mask copies.
  const moveGesture = state.gesture.kind === 'move' ? state.gesture : null;
  if (moveGesture?.originalMask && moveGesture.originalBounds) {
    const edState = useEditorStore.getState();
    const { width: docW, height: docH } = edState.document;
    const dx = floatingSelectionRef.current.offsetX;
    const dy = floatingSelectionRef.current.offsetY;
    const origMask = moveGesture.originalMask;
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
      x: moveGesture.originalBounds.x + dx,
      y: moveGesture.originalBounds.y + dy,
      width: moveGesture.originalBounds.width,
      height: moveGesture.originalBounds.height,
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
  // History is pushed once per key-hold by the shortcut-layer nudge
  // coalescer (see src/app/shortcuts/nudge-coalesce.ts). Pushing here would
  // spam the undo stack with one entry per key auto-repeat event (#684).

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

      // Sync expanded position AND dimensions to Zustand.
      if (floatBoundsDup.length >= 4) {
        const newX = floatBoundsDup[0]!;
        const newY = floatBoundsDup[1]!;
        const newW = floatBoundsDup[2]!;
        const newH = floatBoundsDup[3]!;
        const curLayer = useEditorStore.getState().document.layers.find(l => l.id === activeId);
        if (curLayer) {
          const posChanged = curLayer.x !== newX || curLayer.y !== newY;
          const sizeChanged = curLayer.type === 'raster'
            && (curLayer.width !== newW || curLayer.height !== newH);
          if (posChanged || sizeChanged) {
            useEditorStore.setState((s) => ({
              document: {
                ...s.document,
                layers: s.document.layers.map((l) =>
                  l.id === activeId
                    ? {
                      ...l,
                      x: newX,
                      y: newY,
                      ...(l.type === 'raster' ? { width: newW, height: newH } : {}),
                    }
                    : l
                ),
              },
            }));
          }
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
    // Multi-layer nudge (issue #707) — every other selected, unlocked
    // layer shifts by the same delta so keyboard nudging matches the
    // drag semantics.
    const selectedIds = editor.document.selectedLayerIds ?? [];
    for (const sid of selectedIds) {
      if (sid === activeId) continue;
      const l = editor.document.layers.find((x) => x.id === sid);
      if (!l || l.locked) continue;
      editor.updateLayerPosition(sid, l.x + dx, l.y + dy);
    }
  }
}
