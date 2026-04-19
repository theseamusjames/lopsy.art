import type { InteractionContext, InteractionState } from '../../app/interactions/interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from '../../app/interactions/interaction-types';
import type { Point } from '../../types';
import { useUIStore } from '../../app/ui-store';
import { useEditorStore } from '../../app/editor-store';
import { commitCurrentPath } from '../../app/interactions/path-stroke';
import { hitTestAnchor, hitTestHandle, hitTestSegment, splitSegmentAt } from './path';

let lastAnchorClickTime = 0;
let lastAnchorClickIndex = -1;
const DOUBLE_CLICK_MS = 400;

function toggleAnchorSpline(
  anchorIdx: number,
  selectedPathId: string,
): boolean {
  const editorState = useEditorStore.getState();
  const path = editorState.paths.find((p) => p.id === selectedPathId);
  if (!path) return false;

  const anchor = path.anchors[anchorIdx]!;
  if (anchor.handleIn || anchor.handleOut) {
    const updated = [...path.anchors];
    updated[anchorIdx] = { point: anchor.point, handleIn: null, handleOut: null };
    editorState.updatePathAnchors(selectedPathId, updated, path.closed);
    editorState.notifyRender();
    return true;
  }
  return false;
}

export function handlePathDown(ctx: InteractionContext): InteractionState | undefined {
  const { layerPos, canvasPos, activeLayerId, activeLayer, metaKey } = ctx;
  const uiState = useUIStore.getState();
  const anchors = uiState.pathAnchors;
  const editorState = useEditorStore.getState();
  const selectedPathId = editorState.selectedPathId;

  // --- Edit mode: a stored path is selected ---
  if (selectedPathId && anchors.length === 0) {
    const path = editorState.paths.find((p) => p.id === selectedPathId);
    if (!path) return undefined;

    const hitThreshold = 8 / editorState.viewport.zoom;

    // Check handle hit first (handles are smaller targets drawn on top)
    const handleHit = hitTestHandle(path.anchors, canvasPos, hitThreshold);
    if (handleHit) {
      uiState.setDraggingHandle(handleHit);
      uiState.setEditingAnchorIndex(handleHit.anchorIndex);
      return {
        drawing: true,
        lastPoint: canvasPos,
        pixelBuffer: null,
        originalPixelBuffer: null,
        layerId: activeLayerId,
        tool: 'path',
        startPoint: canvasPos,
        layerStartX: activeLayer.x,
        layerStartY: activeLayer.y,
        ...DEFAULT_TRANSFORM_FIELDS,
      };
    }

    const anchorIdx = hitTestAnchor(path.anchors, canvasPos, hitThreshold);
    if (anchorIdx >= 0) {
      const now = Date.now();
      const isDoubleClick = anchorIdx === lastAnchorClickIndex
        && (now - lastAnchorClickTime) < DOUBLE_CLICK_MS;
      lastAnchorClickTime = now;
      lastAnchorClickIndex = anchorIdx;

      const shouldConvert = metaKey || isDoubleClick;

      if (shouldConvert) {
        toggleAnchorSpline(anchorIdx, selectedPathId);
      }
      uiState.setConvertingAnchorToSpline(shouldConvert);
      uiState.setEditingAnchorIndex(anchorIdx);
      return {
        drawing: true,
        lastPoint: canvasPos,
        pixelBuffer: null,
        originalPixelBuffer: null,
        layerId: activeLayerId,
        tool: 'path',
        startPoint: canvasPos,
        layerStartX: activeLayer.x,
        layerStartY: activeLayer.y,
        ...DEFAULT_TRANSFORM_FIELDS,
      };
    }

    const segIdx = hitTestSegment(path.anchors, path.closed, canvasPos, hitThreshold);
    if (segIdx >= 0) {
      const newAnchors = splitSegmentAt(path.anchors, segIdx);
      editorState.updatePathAnchors(selectedPathId, newAnchors, path.closed);
      editorState.notifyRender();
      return undefined;
    }

    // Clicked empty space — deselect path.
    editorState.selectPath(null);
    uiState.setEditingAnchorIndex(null);
    return undefined;
  }

  // --- Creation mode ---
  if (anchors.length >= 2) {
    const first = anchors[0];
    if (first) {
      const dx = layerPos.x - first.point.x;
      const dy = layerPos.y - first.point.y;
      if (Math.sqrt(dx * dx + dy * dy) < 8) {
        uiState.closePath();
        commitCurrentPath();
        return undefined;
      }
    }
  }

  const newAnchor = { point: layerPos, handleIn: null, handleOut: null };
  uiState.addPathAnchor(newAnchor);
  return {
    drawing: true,
    lastPoint: layerPos,
    pixelBuffer: null,
    originalPixelBuffer: null,
    layerId: activeLayerId,
    tool: 'path',
    startPoint: layerPos,
    layerStartX: activeLayer.x,
    layerStartY: activeLayer.y,
    ...DEFAULT_TRANSFORM_FIELDS,
  };
}

export function handlePathMove(state: InteractionState, layerLocalPos: Point): void {
  if (!state.startPoint) return;

  const uiState = useUIStore.getState();
  const editorState = useEditorStore.getState();
  const editIdx = uiState.editingAnchorIndex;

  // --- Edit mode: dragging an anchor or handle ---
  if (editIdx !== null && editorState.selectedPathId) {
    const path = editorState.paths.find((p) => p.id === editorState.selectedPathId);
    if (!path) return;
    const canvasPos = { x: layerLocalPos.x + state.layerStartX, y: layerLocalPos.y + state.layerStartY };
    const anchor = path.anchors[editIdx];
    if (!anchor) return;

    // Dragging a handle independently
    const draggingHandle = uiState.draggingHandle;
    if (draggingHandle && draggingHandle.anchorIndex === editIdx) {
      const updated = [...path.anchors];
      if (draggingHandle.handle === 'in') {
        updated[editIdx] = { ...anchor, handleIn: { x: canvasPos.x, y: canvasPos.y } };
      } else {
        updated[editIdx] = { ...anchor, handleOut: { x: canvasPos.x, y: canvasPos.y } };
      }
      editorState.updatePathAnchors(editorState.selectedPathId, updated, path.closed);
      editorState.notifyRender();
      return;
    }

    // Convert-to-spline mode: pull out symmetric handles from the anchor point.
    if (uiState.convertingAnchorToSpline) {
      const dx = canvasPos.x - anchor.point.x;
      const dy = canvasPos.y - anchor.point.y;
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;

      const updated = [...path.anchors];
      updated[editIdx] = {
        point: anchor.point,
        handleOut: { x: anchor.point.x + dx, y: anchor.point.y + dy },
        handleIn: { x: anchor.point.x - dx, y: anchor.point.y - dy },
      };
      editorState.updatePathAnchors(editorState.selectedPathId, updated, path.closed);
      editorState.notifyRender();
      return;
    }

    const dx = canvasPos.x - anchor.point.x;
    const dy = canvasPos.y - anchor.point.y;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;

    const updated = [...path.anchors];
    updated[editIdx] = {
      point: canvasPos,
      handleIn: anchor.handleIn
        ? { x: anchor.handleIn.x + dx, y: anchor.handleIn.y + dy }
        : null,
      handleOut: anchor.handleOut
        ? { x: anchor.handleOut.x + dx, y: anchor.handleOut.y + dy }
        : null,
    };
    editorState.updatePathAnchors(editorState.selectedPathId, updated, path.closed);
    editorState.notifyRender();
    return;
  }

  // --- Creation mode: dragging to create handles ---
  const dx = layerLocalPos.x - state.startPoint.x;
  const dy = layerLocalPos.y - state.startPoint.y;
  if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
    const handleOut: Point = { x: state.startPoint.x + dx, y: state.startPoint.y + dy };
    const handleIn: Point = { x: state.startPoint.x - dx, y: state.startPoint.y - dy };
    uiState.updateLastPathAnchor({
      point: state.startPoint,
      handleIn,
      handleOut,
    });
    editorState.notifyRender();
  }
}

export function handlePathUp(): void {
  const uiState = useUIStore.getState();
  if (uiState.editingAnchorIndex !== null) {
    uiState.setEditingAnchorIndex(null);
  }
  if (uiState.convertingAnchorToSpline) {
    uiState.setConvertingAnchorToSpline(false);
  }
  if (uiState.draggingHandle !== null) {
    uiState.setDraggingHandle(null);
  }
}
