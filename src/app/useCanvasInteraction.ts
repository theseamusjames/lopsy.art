import { useCallback, useRef } from 'react';
import { useUIStore } from './ui-store';
import { useEditorStore } from './editor-store';
import { PixelBuffer } from '../engine/pixel-data';
import { invalidateBitmapCache, createPaintingCanvas, destroyPaintingCanvas } from '../engine/bitmap-cache';
import { extractMaskFromSurface } from '../engine/mask-utils';
import { getEngine } from '../engine-wasm/engine-state';
import { beginStroke, endStroke, uploadLayerPixels } from '../engine-wasm/wasm-bridge';

import { clearActiveMaskEditBuffer } from './interactions/mask-buffer';
import { wrapWithSelectionMask } from './interactions/selection-mask-wrap';
import type {
  InteractionState, InteractionContext,
  FloatingSelection, PersistentTransform, LastPaintPoint,
} from './interactions/interaction-types';
import { handleTransformDown } from './interactions/transform-handlers';
import { handleNudgeMove } from './interactions/move-handlers';
import { toolHandlers, handleTransformMove } from './interactions/tool-router';

export { getActiveMaskEditBuffer } from './interactions/mask-buffer';
export { strokeCurrentPath } from './interactions/path-stroke';

import type { Point, ToolId, Layer } from '../types';
import type { MaskedPixelBuffer } from '../engine/pixel-data';

const INITIAL_STATE: InteractionState = {
  drawing: false,
  lastPoint: null,
  pixelBuffer: null,
  originalPixelBuffer: null,
  layerId: null,
  tool: null,
  startPoint: null,
  layerStartX: 0,
  layerStartY: 0,
  maskMode: false,
  transformHandle: null,
  transformStartState: null,
  transformStartAngle: 0,
  originalSelectionMask: null,
  originalSelectionMaskWidth: 0,
  originalSelectionMaskHeight: 0,
  transformCanvas: null,
  baseCanvas: null,
  moveOriginalMask: null,
  moveOriginalBounds: null,
};

const PAINT_TOOLS: ReadonlySet<ToolId> = new Set(['brush', 'pencil', 'eraser', 'dodge', 'stamp']);

export function useCanvasInteraction(
  screenToCanvas: (screenX: number, screenY: number) => Point,
  containerRef: React.RefObject<HTMLDivElement | null>,
) {
  const stateRef = useRef<InteractionState>({ ...INITIAL_STATE });
  const persistentTransformRef = useRef<PersistentTransform | null>(null);
  const floatingSelectionRef = useRef<FloatingSelection | null>(null);
  const stampSourceRef = useRef<Point | null>(null);
  const stampOffsetRef = useRef<Point | null>(null);
  const lastPaintPointRef = useRef<LastPaintPoint | null>(null);

  const buildContext = useCallback(
    (e: React.MouseEvent, canvasPos: Point, layerPos: Point, activeLayerId: string, activeLayer: Layer, pixelBuffer: PixelBuffer, paintSurface: PixelBuffer | MaskedPixelBuffer): InteractionContext => ({
      canvasPos, layerPos,
      shiftKey: e.shiftKey, altKey: e.altKey,
      clientX: e.clientX, clientY: e.clientY,
      activeLayerId, activeLayer, pixelBuffer, paintSurface,
      screenToCanvas, containerRef,
      stateRef, floatingSelectionRef, persistentTransformRef,
      stampSourceRef, stampOffsetRef, lastPaintPointRef,
    }),
    [screenToCanvas, containerRef],
  );

  const handleToolDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;

      const activeTool = useUIStore.getState().activeTool;
      const editorState = useEditorStore.getState();
      const activeLayerId = editorState.document.activeLayerId;
      if (!activeLayerId) return;

      const activeLayer = editorState.document.layers.find((l) => l.id === activeLayerId);
      if (!activeLayer || activeLayer.locked) return;

      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const canvasPos = screenToCanvas(e.clientX - rect.left, e.clientY - rect.top);

      const engine = getEngine();
      const isPaintTool = PAINT_TOOLS.has(activeTool);
      const maskEditMode = useUIStore.getState().maskEditMode;

      // Fall back to CPU when:
      // - mask edit mode (paints on mask surface)
      // - active selection (GPU brush doesn't clip to selection mask yet)
      const hasSelection = useEditorStore.getState().selection.active;
      const useGpuStroke = engine && isPaintTool && !maskEditMode && !hasSelection;

      let pixelBuffer: PixelBuffer;
      let paintSurface: PixelBuffer;
      let expandedLayer = activeLayer;
      let layerPos: Point = { x: canvasPos.x - activeLayer.x, y: canvasPos.y - activeLayer.y };

      if (useGpuStroke) {
        // GPU path: no JS pixel data needed. The engine handles the
        // layer texture directly — no expand, no upload, no round-trip.
        beginStroke(engine, activeLayerId);
        // Create a minimal dummy buffer for the context (paint handlers
        // ignore it when the GPU engine is available).
        const dummyData = new ImageData(1, 1);
        pixelBuffer = PixelBuffer.wrapImageData(dummyData);
        paintSurface = pixelBuffer;
      } else {
        // CPU fallback: expand layer to full canvas for pixel manipulation
        const imageData = editorState.expandLayerForEditing(activeLayerId);
        expandedLayer = useEditorStore.getState().document.layers.find((l) => l.id === activeLayerId)!;
        layerPos = { x: canvasPos.x - expandedLayer.x, y: canvasPos.y - expandedLayer.y };
        pixelBuffer = PixelBuffer.wrapImageData(imageData);
        invalidateBitmapCache(activeLayerId);
        createPaintingCanvas(activeLayerId, imageData);
        paintSurface = wrapWithSelectionMask(pixelBuffer, expandedLayer.x, expandedLayer.y);
      }
      const ctx = buildContext(e, canvasPos, layerPos, activeLayerId, expandedLayer, pixelBuffer, paintSurface);

      // Transform handle interaction (pre-tool dispatch)
      const transformResult = handleTransformDown(ctx);
      if (transformResult) {
        stateRef.current = transformResult;
        return;
      }

      const handler = toolHandlers[activeTool];
      const newState = handler?.down?.(ctx);
      if (newState) {
        newState._usedGpuStroke = !!useGpuStroke;
        stateRef.current = newState;
      }
    },
    [screenToCanvas, containerRef, buildContext],
  );

  const handleToolMove = useCallback(
    (e: React.MouseEvent) => {
      const state = stateRef.current;
      if (!state.drawing || !state.layerId) return;

      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const canvasPos = screenToCanvas(e.clientX - rect.left, e.clientY - rect.top);
      const layerLocalPos: Point = {
        x: canvasPos.x - state.layerStartX,
        y: canvasPos.y - state.layerStartY,
      };

      // Transform handle drag (not tool-routed)
      if (state.transformHandle && state.transformStartState && state.startPoint) {
        handleTransformMove(state, canvasPos, e.shiftKey);
        return;
      }

      if (!state.tool) return;

      const ctx: InteractionContext = {
        canvasPos, layerPos: layerLocalPos,
        shiftKey: e.shiftKey, altKey: e.altKey,
        clientX: e.clientX, clientY: e.clientY,
        activeLayerId: state.layerId,
        activeLayer: useEditorStore.getState().document.layers.find((l) => l.id === state.layerId)!,
        pixelBuffer: state.pixelBuffer!,
        paintSurface: state.pixelBuffer!,
        screenToCanvas, containerRef,
        stateRef, floatingSelectionRef, persistentTransformRef,
        stampSourceRef, stampOffsetRef, lastPaintPointRef,
      };

      toolHandlers[state.tool]?.move?.(ctx, state);
    },
    [screenToCanvas, containerRef],
  );

  const handleToolUp = useCallback((e: React.MouseEvent) => {
    const state = stateRef.current;
    if (!state.tool) {
      stateRef.current = { ...INITIAL_STATE };
      return;
    }

    const rect = containerRef.current?.getBoundingClientRect();
    const canvasPos = rect
      ? screenToCanvas(e.clientX - rect.left, e.clientY - rect.top)
      : { x: 0, y: 0 };

    const ctx: InteractionContext = {
      canvasPos, layerPos: canvasPos,
      shiftKey: e.shiftKey, altKey: e.altKey,
      clientX: e.clientX, clientY: e.clientY,
      activeLayerId: state.layerId ?? '',
      activeLayer: useEditorStore.getState().document.layers.find((l) => l.id === state.layerId)!,
      pixelBuffer: state.pixelBuffer!,
      paintSurface: state.pixelBuffer!,
      screenToCanvas, containerRef,
      stateRef, floatingSelectionRef, persistentTransformRef,
      stampSourceRef, stampOffsetRef, lastPaintPointRef,
    };

    toolHandlers[state.tool]?.up?.(ctx, state);

    // Finalize paint stroke
    if (PAINT_TOOLS.has(state.tool) && state.layerId && !state.maskMode) {
      const engine = getEngine();
      if (engine && state._usedGpuStroke) {
        // GPU path: composite stroke onto layer. GPU texture is source of truth —
        // no readback to JS needed. Undo uses GPU compressed snapshots.
        endStroke(engine, state.layerId);
        // Clear stale JS pixel data so resolvePixelData reads from GPU
        const editorState = useEditorStore.getState();
        const pixelData = new Map(editorState.layerPixelData);
        pixelData.delete(state.layerId);
        const sparseMap = new Map(editorState.sparseLayerData);
        sparseMap.delete(state.layerId);
        const dirtyIds = new Set(editorState.dirtyLayerIds);
        dirtyIds.add(state.layerId);
        editorState.notifyRender();
        useEditorStore.setState({ layerPixelData: pixelData, sparseLayerData: sparseMap, dirtyLayerIds: dirtyIds });
      } else {
        // CPU fallback
        destroyPaintingCanvas(state.layerId);
        const editorState = useEditorStore.getState();
        const layerData = editorState.layerPixelData.get(state.layerId);
        if (layerData) {
          editorState.updateLayerPixelData(state.layerId, layerData);
        }
      }
    }

    // Save last paint point for shift+click line drawing
    if (PAINT_TOOLS.has(state.tool) && state.lastPoint && state.layerId) {
      lastPaintPointRef.current = { point: state.lastPoint, layerId: state.layerId };
    }

    // Clear active transform handle
    if (state.transformHandle) {
      useUIStore.getState().setActiveTransformHandle(null);
    }

    // Clear gradient preview
    if (state.tool === 'gradient') {
      useUIStore.getState().setGradientPreview(null);
    }

    // Sync mask drawing buffer back to mask data
    if (state.maskMode && state.pixelBuffer && state.layerId) {
      const layer = useEditorStore.getState().document.layers.find((l) => l.id === state.layerId);
      if (layer?.mask) {
        const newMaskData = extractMaskFromSurface(state.pixelBuffer, layer.mask.width, layer.mask.height);
        useEditorStore.getState().updateLayerMaskData(state.layerId, newMaskData);
      }
      clearActiveMaskEditBuffer();
    }

    stateRef.current = { ...INITIAL_STATE };
  }, [screenToCanvas, containerRef]);

  const clearPersistentTransform = useCallback(() => {
    persistentTransformRef.current = null;
    floatingSelectionRef.current = null;
  }, []);

  const nudgeMove = useCallback((dx: number, dy: number) => {
    handleNudgeMove(dx, dy, floatingSelectionRef, persistentTransformRef);
  }, []);

  return { handleToolDown, handleToolMove, handleToolUp, clearPersistentTransform, nudgeMove };
}
