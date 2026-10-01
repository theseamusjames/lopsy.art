import { PixelBuffer } from '../../engine/pixel-data';
import { useUIStore } from '../ui-store';
import { useEditorStore } from '../editor-store';
import { useToolSettingsStore } from '../tool-settings-store';
import { rasterizePath } from '../../tools/path/path';
import type { PathAnchor } from '../../tools/path/path';
import type { Color } from '../../types';
import { guardPixelWrite } from '../../layers/paint-target';

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
  editorState.pushHistory('Stroke Path');
  const imageData = editorState.getOrCreateLayerPixelData(layerId);
  const buf = PixelBuffer.fromImageData(imageData);
  useToolSettingsStore.getState().addRecentColor(color);

  // #820 — getOrCreateLayerPixelData may have expanded the layer to
  // cover the canvas, rewriting layer.x/y. Read the current bounds so
  // we translate anchors against the buffer we actually got back, not
  // the cropped bounds we started with.
  const layer = useEditorStore.getState().document.layers.find((l) => l.id === layerId);
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

function draftAnchorsInDocSpace(anchors: readonly PathAnchor[]): PathAnchor[] {
  const editorState = useEditorStore.getState();
  const activeLayer = editorState.document.layers.find(
    (l) => l.id === editorState.document.activeLayerId,
  );
  const offsetX = activeLayer?.x ?? 0;
  const offsetY = activeLayer?.y ?? 0;
  return anchors.map((a) => ({
    point: { x: a.point.x + offsetX, y: a.point.y + offsetY },
    handleIn: a.handleIn
      ? { x: a.handleIn.x + offsetX, y: a.handleIn.y + offsetY }
      : null,
    handleOut: a.handleOut
      ? { x: a.handleOut.x + offsetX, y: a.handleOut.y + offsetY }
      : null,
  }));
}

/** Commit the current ephemeral path to the paths store. */
export function commitCurrentPath(): void {
  const uiState = useUIStore.getState();
  const editorState = useEditorStore.getState();
  const draft = uiState.pathDraft;
  if (!draft || draft.anchors.length < 2) {
    uiState.clearPath();
    return;
  }
  const docAnchors = draftAnchorsInDocSpace(draft.anchors);
  editorState.pushHistoryMetadata('Add Path');
  editorState.addPath(docAnchors, draft.closed);
  uiState.clearPath();
}

function strokeOntoLayer(layerId: string, docAnchors: readonly PathAnchor[], closed: boolean): void {
  const ts = useToolSettingsStore.getState();
  rasterizePathToLayer(docAnchors, closed, layerId, ts.settings.path.strokeWidth, ts.foregroundColor);
}

/** The active layer's id when a path stroke may write to it, else null. */
function strokeTargetLayerId(): string | null {
  const doc = useEditorStore.getState().document;
  const activeLayer = doc.layers.find((l) => l.id === doc.activeLayerId);
  if (!doc.activeLayerId || !guardPixelWrite(activeLayer)) return null;
  return doc.activeLayerId;
}

/**
 * Enter with the Pen tool: keep the in-progress path in the Paths panel and
 * stroke it onto the active layer with the options-bar stroke width and the
 * foreground colour (#976).
 */
function strokeCurrentPath(): void {
  const draft = useUIStore.getState().pathDraft;
  const layerId = draft && draft.anchors.length >= 2 ? strokeTargetLayerId() : null;
  const docAnchors = draft && layerId ? draftAnchorsInDocSpace(draft.anchors) : [];
  const isClosed = draft?.closed ?? false;
  commitCurrentPath();
  if (!layerId) return;
  strokeOntoLayer(layerId, docAnchors, isClosed);
}

/**
 * Stroke the selected stored path the same way Enter strokes a draft. A
 * click on the first anchor commits the closed path straight to the Paths
 * panel (and selects it), so this is what lets Enter stroke a closed shape
 * (#1084).
 */
function strokeSelectedPath(): void {
  const { paths, selectedPathId } = useEditorStore.getState();
  const path = paths.find((p) => p.id === selectedPathId);
  if (!path || path.anchors.length < 2) return;
  const layerId = strokeTargetLayerId();
  if (!layerId) return;
  strokeOntoLayer(layerId, path.anchors, path.closed);
}

/** Enter with the Pen tool: stroke the in-progress path, else the selected one. */
export function strokePathOnEnter(): void {
  const anchorCount = useUIStore.getState().pathDraft?.anchors.length ?? 0;
  if (anchorCount >= 2) {
    strokeCurrentPath();
    return;
  }
  if (anchorCount === 0) strokeSelectedPath();
}
