import { PixelBuffer } from '../../engine/pixel-data';
import { useUIStore } from '../ui-store';
import { useEditorStore } from '../editor-store';
import { rasterizePath } from '../../tools/path/path';
import type { PathAnchor } from '../../tools/path/path';
import type { Color } from '../../types';

/**
 * Stroke a path onto a layer. Anchors are in document space —
 * they are translated to layer-local coordinates before rasterizing.
 */
export function rasterizePathToLayer(
  anchors: readonly PathAnchor[],
  closed: boolean,
  layerId: string,
  strokeWidth: number,
  color: Color,
): void {
  const editorState = useEditorStore.getState();
  editorState.pushHistory();
  const imageData = editorState.getOrCreateLayerPixelData(layerId);
  const buf = PixelBuffer.fromImageData(imageData);
  useUIStore.getState().addRecentColor(color);

  // Translate from document space to layer-local space
  const layer = editorState.document.layers.find((l) => l.id === layerId);
  const offsetX = layer?.x ?? 0;
  const offsetY = layer?.y ?? 0;
  const localAnchors: PathAnchor[] = anchors.map((a) => ({
    point: { x: a.point.x - offsetX, y: a.point.y - offsetY },
    handleIn: a.handleIn
      ? { x: a.handleIn.x - offsetX, y: a.handleIn.y - offsetY }
      : null,
    handleOut: a.handleOut
      ? { x: a.handleOut.x - offsetX, y: a.handleOut.y - offsetY }
      : null,
  }));

  rasterizePath(buf, localAnchors, closed, color, strokeWidth);

  editorState.updateLayerPixelData(layerId, buf.toImageData());
}

/** Commit the current ephemeral path to the paths store. */
export function commitCurrentPath(): void {
  const uiState = useUIStore.getState();
  const editorState = useEditorStore.getState();
  const anchors = uiState.pathAnchors;
  if (anchors.length < 2) {
    uiState.clearPath();
    return;
  }

  // Convert from layer-local to document space
  const activeLayer = editorState.document.layers.find(
    (l) => l.id === editorState.document.activeLayerId,
  );
  const offsetX = activeLayer?.x ?? 0;
  const offsetY = activeLayer?.y ?? 0;
  const docAnchors = anchors.map((a) => ({
    point: { x: a.point.x + offsetX, y: a.point.y + offsetY },
    handleIn: a.handleIn
      ? { x: a.handleIn.x + offsetX, y: a.handleIn.y + offsetY }
      : null,
    handleOut: a.handleOut
      ? { x: a.handleOut.x + offsetX, y: a.handleOut.y + offsetY }
      : null,
  }));

  editorState.addPath(docAnchors, uiState.pathClosed);
  uiState.clearPath();
}

/** Legacy alias kept for re-export. */
export function strokeCurrentPath(): void {
  commitCurrentPath();
}
