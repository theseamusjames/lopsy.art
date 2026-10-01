import type { Rect } from '../../types';
import type { TransformState } from '../../tools/transform/transform';
import {
  createTransformState,
  computeInverseAffineMatrix,
  getCornerPositions,
} from '../../tools/transform/transform';
import {
  pixelRectCovering,
  resolveLayerTransformTargets,
  selectionWantsLayerTransform,
  transformedSubRectBounds,
  unionRects,
} from '../../tools/transform/multi-layer-transform';
import { getEngine } from '../../engine-wasm/engine-state';
import type { Engine } from '../../engine-wasm/wasm-bridge';
import {
  beginLayerTransform,
  compositeLayerTransformAffine,
  compositeLayerTransformPerspective,
  getLayerContentBounds,
  getLayerEngineBounds,
  hasLayerTransform,
  prepareLayerTransformTarget,
} from '../../engine-wasm/wasm-bridge';
import { pixelDataManager } from '../../engine/pixel-data-manager';
import { useEditorStore } from '../editor-store';
import { useUIStore } from '../ui-store';
import { clearJsPixelData } from '../store/clear-js-pixel-data';
import { reconcileLayerBoundsWithEngine } from '../reconcile-layer-bounds';

/**
 * Transforming several selected layers at once with the Move tool's handles.
 *
 * With no marquee and two or more layers (or a group) selected in the Layers
 * panel, the Move tool frames the union of their content with the same
 * handles a selection gets. A handle drag lifts each layer's content into the
 * engine's multi-layer transform session and re-renders all of them through
 * one TransformState every pointer-move, so they scale, rotate, skew or
 * distort about the shared centre as one picture. The session stays live
 * after the release, like the Move tool's float, so a second drag resamples
 * the original pixels; the engine counts it as a float, so every place that
 * bakes the float before an edit (a history push, another tool's press, ⌘D,
 * undo) ends it too.
 */

interface LiveSession {
  layerIds: readonly string[];
  /** Each layer's content rect when it was lifted (document space). */
  contentRects: ReadonlyMap<string, Rect>;
}

let live: LiveSession | null = null;

interface CachedBounds {
  key: string;
  /** Texture-local. */
  rect: Rect | null;
}

const contentBoundsCache = new Map<string, CachedBounds>();

/** The layers a multi-layer transform would move right now, or [] when the Move tool would not show one. */
export function currentLayerTransformTargets(): string[] {
  const ui = useUIStore.getState();
  if (ui.activeTool !== 'move' || ui.maskMode !== 'off') return [];
  const editor = useEditorStore.getState();
  if (editor.selection.active) return [];
  const { layers, selectedLayerIds } = editor.document;
  const selected = selectedLayerIds ?? [];
  if (!selectionWantsLayerTransform(layers, selected)) return [];
  return resolveLayerTransformTargets(layers, selected);
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/** Whether a multi-layer transform for exactly `targets` is live in the engine. */
function isSessionFor(engine: Engine, targets: readonly string[]): boolean {
  return live !== null && hasLayerTransform(engine) && sameIds(live.layerIds, targets);
}

/** Whether any multi-layer transform is live (its layers hold a pending transform). */
export function isLayerTransformLive(): boolean {
  const engine = getEngine();
  return live !== null && engine !== null && hasLayerTransform(engine);
}

/**
 * Document-space content rect of a layer, or null when it is empty. Read on
 * the GPU (`width + height` texels) and cached, texture-local, until the
 * layer's pixels, texture size or history change — so neither drawing the
 * box nor dragging the layers around reads anything back.
 */
function layerContentRect(engine: Engine, layerId: string): Rect | null {
  const [x = 0, y = 0, w = 0, h = 0] = getLayerEngineBounds(engine, layerId);
  const editor = useEditorStore.getState();
  const key = [
    pixelDataManager.versionOf(layerId), w, h,
    editor.undoStack.length, editor.redoStack.length,
  ].join('|');
  let cached = contentBoundsCache.get(layerId);
  if (!cached || cached.key !== key) {
    const local = getLayerContentBounds(engine, layerId);
    const lw = local[2] ?? 0;
    const lh = local[3] ?? 0;
    const rect = lw > 0 && lh > 0 ? { x: local[0] ?? 0, y: local[1] ?? 0, width: lw, height: lh } : null;
    cached = { key, rect };
    contentBoundsCache.set(layerId, cached);
  }
  return cached.rect ? { ...cached.rect, x: cached.rect.x + x, y: cached.rect.y + y } : null;
}

/**
 * The transform box to draw and hit-test for the selected layers: the live
 * transform while one is pending, otherwise an identity box over the union
 * of their content. Null when the Move tool shows no multi-layer box.
 */
export function getLayerTransformBox(): TransformState | null {
  const targets = currentLayerTransformTargets();
  if (targets.length === 0) return null;
  const engine = getEngine();
  if (!engine) return null;
  const ui = useUIStore.getState();
  if (isSessionFor(engine, targets) && ui.layerTransform) return ui.layerTransform;
  const rects = targets
    .map((id) => layerContentRect(engine, id))
    .filter((r): r is Rect => r !== null);
  const union = unionRects(rects);
  return union ? createTransformState(union, ui.layerTransformMode) : null;
}

/** Whether the engine holds a session for exactly the layers a transform would move now. */
export function isLayerTransformCurrent(): boolean {
  const engine = getEngine();
  return engine !== null && isSessionFor(engine, currentLayerTransformTargets());
}

/**
 * Lift each target layer's content into a new engine session. The caller
 * bakes any other float first (`commitLiveFloat`). Returns false when there is
 * nothing to transform.
 */
export function beginLayerTransformSession(box: TransformState): boolean {
  const engine = getEngine();
  if (!engine) return false;
  const targets = currentLayerTransformTargets();
  const contentRects = new Map<string, Rect>();
  for (const id of targets) {
    const [x, y, width = 0, height = 0] = beginLayerTransform(engine, id);
    if (x !== undefined && y !== undefined && width > 0 && height > 0) contentRects.set(id, { x, y, width, height });
  }
  if (contentRects.size === 0) return false;
  live = { layerIds: targets, contentRects };
  useUIStore.getState().setLayerTransform(box);
  return true;
}

/**
 * Re-render every layer of the live session through `transform` and make it
 * the pending transform. Grows a layer's texture first when the transform
 * carries its pixels past it; no readback.
 */
export function renderLayerTransform(transform: TransformState): void {
  const engine = getEngine();
  if (!engine || !live || !hasLayerTransform(engine)) return;
  for (const [id, content] of live.contentRects) {
    const target = pixelRectCovering(transformedSubRectBounds(transform, content));
    const grown = prepareLayerTransformTarget(engine, id, target.x, target.y, target.width, target.height);
    // Growth mid-drag leaves the thumbnail alone (#1018); the release refreshes it.
    if (grown.length === 4) reconcileLayerBoundsWithEngine(engine, id, { shouldBumpVersion: false });
  }
  const ob = transform.originalBounds;
  if (transform.mode === 'distort' || transform.mode === 'perspective') {
    const [tl, tr, br, bl] = getCornerPositions(transform);
    const corners = Float32Array.from([tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y]);
    compositeLayerTransformPerspective(engine, corners, ob.x, ob.y, ob.width, ob.height);
  } else {
    const srcCx = ob.x + ob.width / 2;
    const srcCy = ob.y + ob.height / 2;
    compositeLayerTransformAffine(
      engine,
      computeInverseAffineMatrix(transform),
      srcCx,
      srcCy,
      srcCx + transform.translateX,
      srcCy + transform.translateY,
    );
  }
  useUIStore.getState().setLayerTransform(transform);
  useEditorStore.getState().notifyRender();
}

/** The session's layers changed on the GPU: mark them for the next history snapshot and refresh thumbnails. */
export function markLayerTransformDirty(): void {
  if (!live) return;
  for (const id of live.layerIds) clearJsPixelData(id);
}

/** Forget the JS side of a session the engine no longer holds. */
export function forgetLayerTransform(): void {
  live = null;
  if (useUIStore.getState().layerTransform) useUIStore.getState().setLayerTransform(null);
}

/** Test seam: drop cached content bounds. */
export function resetLayerTransformCache(): void {
  contentBoundsCache.clear();
}
