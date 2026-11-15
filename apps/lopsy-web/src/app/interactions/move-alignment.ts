import type { Layer, Rect } from '../../types';
import { getEngine } from '../../engine-wasm/engine-state';
import { getLayerEngineBounds } from '../../engine-wasm/wasm-bridge';
import { buildLayerIndex, isEffectivelyVisible } from '../../layers/layer-index';
import { getDescendantIds } from '../../layers/group-utils';
import { buildAlignmentTargets, unionRects } from '../../tools/move/smart-guides';
import type { AlignmentTargets } from '../../tools/move/smart-guides';
import { useEditorStore } from '../editor-store';

/** What a whole-layer Move drag lines up against, captured at pointer-down. */
export interface MoveAlignmentContext {
  /** Bounding box of everything being moved, at the drag's start position. */
  readonly movingBox: Rect;
  readonly targets: AlignmentTargets;
}

/**
 * A layer's box from what is already known, with no GPU readback: raster
 * layers are cropped to their content (the dragged ones at the grab, the
 * rest when they are left), shapes carry their box, and a text layer's
 * texture is sized to its rendered text.
 */
function knownLayerBounds(layer: Layer): Rect | null {
  if (layer.type === 'group') return null;
  if (layer.type === 'text') {
    const engine = getEngine();
    if (!engine) return null;
    const [x = 0, y = 0, width = 0, height = 0] = getLayerEngineBounds(engine, layer.id);
    return width > 0 && height > 0 ? { x, y, width, height } : null;
  }
  if (layer.width <= 0 || layer.height <= 0) return null;
  return { x: layer.x, y: layer.y, width: layer.width, height: layer.height };
}

/**
 * Bounds of the layers being moved and alignment targets for every other
 * visible layer and the canvas. Null when the moving layers have no content.
 */
export function buildMoveAlignmentContext(movingIds: readonly string[]): MoveAlignmentContext | null {
  const { layers, width, height } = useEditorStore.getState().document;
  const moving = new Set<string>();
  for (const id of movingIds) {
    moving.add(id);
    for (const d of getDescendantIds(layers, id)) moving.add(d);
  }

  const movingRects: Rect[] = [];
  const targetRects: Rect[] = [];
  const index = buildLayerIndex(layers);
  for (const layer of layers) {
    const isMoving = moving.has(layer.id);
    if (!isMoving && !isEffectivelyVisible(index, layer.id)) continue;
    const bounds = knownLayerBounds(layer);
    if (!bounds) continue;
    (isMoving ? movingRects : targetRects).push(bounds);
  }

  const movingBox = unionRects(movingRects);
  if (!movingBox) return null;
  return { movingBox, targets: buildAlignmentTargets(targetRects, width, height) };
}
