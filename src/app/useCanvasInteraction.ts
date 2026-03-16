import { useCallback, useRef } from 'react';
import { useUIStore } from './ui-store';
import { useEditorStore } from './editor-store';
import { PixelBuffer } from '../engine/pixel-data';
import { invalidateBitmapCache, createPaintingCanvas, destroyPaintingCanvas } from '../engine/bitmap-cache';
import { extractMaskFromSurface } from '../engine/mask-utils';

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
      // Expand cropped layer back to full canvas size for editing
      const imageData = editorState.expandLayerForEditing(activeLayerId);
      // Re-read activeLayer after expand (position may have changed)
      const expandedLayer = useEditorStore.getState().document.layers.find((l) => l.id === activeLayerId)!;
      const layerPos: Point = { x: canvasPos.x - expandedLayer.x, y: canvasPos.y - expandedLayer.y };
      const pixelBuffer = PixelBuffer.wrapImageData(imageData);
      // Invalidate bitmap and create a painting canvas with full initial content.
      // During the stroke, only dirty regions get updated on the painting canvas
      // instead of full putImageData each frame.
      invalidateBitmapCache(activeLayerId);
      createPaintingCanvas(activeLayerId, imageData);
      const paintSurface = wrapWithSelectionMask(pixelBuffer, expandedLayer.x, expandedLayer.y);
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

    // Finalize paint stroke: destroy painting canvas, update pixel data
    // (updateLayerPixelData auto-crops to content bounds)
    if (PAINT_TOOLS.has(state.tool) && state.layerId && !state.maskMode) {
      destroyPaintingCanvas(state.layerId);
      const editorState = useEditorStore.getState();
      const layerData = editorState.layerPixelData.get(state.layerId);
      if (layerData) {
        editorState.updateLayerPixelData(state.layerId, layerData);
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
