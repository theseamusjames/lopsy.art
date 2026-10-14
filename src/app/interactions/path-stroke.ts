import { useUIStore } from '../ui-store';
import { useEditorStore } from '../editor-store';
import { useToolSettingsStore } from '../tool-settings-store';
import type { PathAnchor } from '../../tools/path/path';
import type { Color } from '../../types';
import { guardPixelWrite } from '../../layers/paint-target';
import { getEngine } from '../../engine-wasm/engine-state';
import { compositePatchOntoLayer } from '../../engine-wasm/wasm-bridge';
import { syncLayerAfterFullSize } from '../sync-layer-after-full-size';
import { clearJsPixelData } from '../store/clear-js-pixel-data';
import { rasterizePathPatch } from './path-patch';

/**
 * Stroke a path onto a layer. Anchors are in document space. Only the
 * stroke's bounding box is rasterized, and the GPU composites it over the
 * layer texture, so nothing is read back and no full-layer buffer is built
 * or uploaded (#1292). The layer is expanded to cover the canvas first, as a
 * brush stroke expands it, and the stroke is clipped to the canvas.
 * Refuses (with the usual toast) a layer that can't take pixel writes:
 * a text layer's glyphs would be replaced by the stroke, and a group
 * would get an empty history entry (#1067). Returns whether it stroked.
 */
export function rasterizePathToLayer(
  anchors: readonly PathAnchor[],
  closed: boolean,
  layerId: string,
  strokeWidth: number,
  color: Color,
): boolean {
  const editorState = useEditorStore.getState();
  const target = editorState.document.layers.find((l) => l.id === layerId);
  if (!guardPixelWrite(target)) return false;
  const engine = getEngine();
  if (!engine) return false;
  editorState.pushHistory('Stroke Path');
  useToolSettingsStore.getState().addRecentColor(color);

  const { width, height } = editorState.document;
  const patch = rasterizePathPatch(anchors, closed, color, strokeWidth, { x: 0, y: 0, width, height });
  if (!patch) return true;
  const bytes = new Uint8Array(patch.data.buffer, patch.data.byteOffset, patch.data.byteLength);
  compositePatchOntoLayer(engine, layerId, bytes, patch.x, patch.y, patch.width, patch.height);
  syncLayerAfterFullSize(engine, layerId);
  clearJsPixelData(layerId);
  useEditorStore.getState().notifyRender();
  return true;
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

// The path Enter last stroked, so a repeated Enter doesn't stroke it again
// and double up its anti-aliased edges. Any change to the path list (an
// edit, a commit, undo / redo), to the selection, or a new draft anchor
// clears it — after which Enter strokes the selected path once more.
let enterStrokedPathId: string | null = null;
let isWatchingStrokeReset = false;

function watchStrokeReset(): void {
  if (isWatchingStrokeReset) return;
  isWatchingStrokeReset = true;
  useEditorStore.subscribe((state, prev) => {
    if (state.paths !== prev.paths || state.selectedPathId !== prev.selectedPathId) {
      enterStrokedPathId = null;
    }
  });
  useUIStore.subscribe((state, prev) => {
    if (state.pathDraft !== prev.pathDraft && (state.pathDraft?.anchors.length ?? 0) > 0) {
      enterStrokedPathId = null;
    }
  });
}

function rememberEnterStroke(): void {
  watchStrokeReset();
  enterStrokedPathId = useEditorStore.getState().selectedPathId;
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
  rememberEnterStroke();
}

/**
 * Stroke the selected stored path the same way Enter strokes a draft. A
 * click on the first anchor commits the closed path straight to the Paths
 * panel (and selects it), so this is what lets Enter stroke a closed shape
 * (#1084).
 */
function strokeSelectedPath(): void {
  const { paths, selectedPathId } = useEditorStore.getState();
  if (selectedPathId === null || selectedPathId === enterStrokedPathId) return;
  const path = paths.find((p) => p.id === selectedPathId);
  if (!path || path.anchors.length < 2) return;
  const layerId = strokeTargetLayerId();
  if (!layerId) return;
  strokeOntoLayer(layerId, path.anchors, path.closed);
  rememberEnterStroke();
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
