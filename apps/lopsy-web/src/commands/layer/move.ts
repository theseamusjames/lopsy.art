import { CommandError } from '../command';
import { defineCommand } from '../registry';
import { activateIfOther, layerRefSpec, offsetSpec, requireDocument, requireEngine, resolveLayer } from '../context';
import { checkGesturePress, checkNoOpenSession, gestureNote, runGesture } from '../gesture/run-gesture';
import { useEditorStore } from '../../app/editor-store';
import { useUIStore } from '../../app/ui-store';
import { getLayerTransformBox } from '../../app/interactions/layer-transform';
import { getTextTransformTarget } from '../../app/interactions/text-transform-handlers';
import { hitTestTransformHandle } from '../../app/interactions/transform-handlers';
import { peekLayerContentRectLocal, readLayerContentRectLocal } from '../../app/layer-content-rect';
import type { Engine } from '../../engine-wasm/wasm-bridge';
import type { TransformState } from '../../tools/transform/transform';
import { getHandlePositions, HANDLE_HIT_RADIUS_PX, ROTATE_HANDLE_OFFSET } from '../../tools/transform/transform-handles';
import type { Point } from '../../types';

export interface LayerMoveResult {
  layer: string;
  /** The layer's position after the move, in document pixels. */
  x: number;
  y: number;
}

/** The box whose handles a Move press would grab instead of dragging: the text frame, or the layers' content box. */
function handleBox(): TransformState | null {
  return getTextTransformTarget()?.state ?? getLayerTransformBox();
}

const CORNERS = ['top-left', 'top-right', 'bottom-right', 'bottom-left'] as const;

/** The box's centre and the distance from it to its farthest corner. */
function boxExtent(box: TransformState): { center: Point; reach: number } {
  const positions = getHandlePositions(box);
  const corners = CORNERS.map((handle) => positions[handle]);
  const center = {
    x: corners.reduce((sum, p) => sum + p.x, 0) / corners.length,
    y: corners.reduce((sum, p) => sum + p.y, 0) / corners.length,
  };
  return { center, reach: Math.max(...corners.map((p) => Math.hypot(p.x - center.x, p.y - center.y))) };
}

/** A press point the Move tool takes as a drag of the whole layer: on no transform handle. */
function pressPoint(): Point {
  const box = handleBox();
  const doc = useEditorStore.getState().document;
  if (!box) return { x: Math.round(doc.width / 2), y: Math.round(doc.height / 2) };
  const zoom = useEditorStore.getState().viewport.zoom;
  const { center, reach } = boxExtent(box);
  const clear = reach + (ROTATE_HANDLE_OFFSET + 2 * HANDLE_HIT_RADIUS_PX) / zoom;
  const candidates: Point[] = [
    { x: Math.round(center.x), y: Math.round(center.y) },
    { x: Math.round(center.x), y: Math.round(center.y - clear) },
    { x: Math.round(center.x), y: Math.round(center.y + clear) },
  ];
  const free = candidates.find((p) => hitTestTransformHandle(p, box, zoom) === null);
  if (!free) throw new CommandError('refused', 'No press point clear of the transform handles was found for this layer.');
  return free;
}

function checkMovable(dx: number, dy: number): void {
  if (dx === 0 && dy === 0) throw new CommandError('invalid', 'layer.move: dx and dy are both 0; a Move click without a drag moves nothing.');
  if (useEditorStore.getState().selection.active) {
    throw new CommandError(
      'refused',
      'A selection is active, and a Move drag would lift the selected pixels instead of moving the layer: deselect first (select.none), or drag the selection with tool.gesture and the move tool.',
    );
  }
}

/** Raster layers whose content bounds the press is still waiting on (move-handlers' held press). */
function unmeasured(engine: Engine): string[] {
  const doc = useEditorStore.getState().document;
  const ids = [doc.activeLayerId, ...(doc.selectedLayerIds ?? [])].filter((id): id is string => !!id);
  return [...new Set(ids)].filter((id) => {
    const layer = doc.layers.find((l) => l.id === id);
    return layer?.type === 'raster' && peekLayerContentRectLocal(engine, id) === undefined;
  });
}

/** After the reads the held press waits on: its continuation runs in their microtasks, so one macrotask later it is done. */
async function heldPressDone(engine: Engine): Promise<void> {
  const ids = unmeasured(engine);
  if (ids.length === 0) return;
  await Promise.all(ids.map((id) => readLayerContentRectLocal(engine, id)));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function position(id: string): LayerMoveResult {
  const layer = useEditorStore.getState().document.layers.find((l) => l.id === id);
  if (!layer) throw new CommandError('not-found', `The layer ${id} is gone after the move.`);
  return { layer: id, x: layer.x, y: layer.y };
}

export const layerMove = defineCommand({
  id: 'layer.move',
  summary:
    'Moves a layer by (dx, dy) document pixels with the Move tool, as dragging it on the canvas does: the layer becomes active (a layer that is not active is first selected alone, as a click on its row does, so only it moves; when the active layer is moved, the other selected layers move with it, as in the UI), a raster layer is first cropped to its content, and its mask follows it. View > Snap to Grid (with the grid shown) and View > Snap to Layers can change where it lands, as they do for a drag; both are off by default. One history step ("Move"). Refused on a locked layer and while a selection is active (a drag would move the selected pixels: deselect first). Returns the layer id and its position afterwards (the top-left of its content for a raster layer).' + gestureNote('the Move tool'),
  surface: 'document',
  params: {
    layer: layerRefSpec,
    dx: offsetSpec('Horizontal offset in document pixels; positive moves right.', { integer: true }),
    dy: offsetSpec('Vertical offset in document pixels; positive moves down.', { integer: true }),
  },
  async run({ layer: ref, dx, dy }): Promise<LayerMoveResult> {
    requireDocument();
    const engine = requireEngine();
    const layer = resolveLayer(ref);
    checkMovable(dx, dy);
    checkNoOpenSession();
    checkGesturePress('move', layer);
    activateIfOther(layer.id);
    if (useUIStore.getState().activeTool !== 'move') useUIStore.getState().setActiveTool('move');
    const from = pressPoint();
    runGesture({ tool: 'move', points: [from, { x: from.x + dx, y: from.y + dy }] });
    await heldPressDone(engine);
    return position(layer.id);
  },
});
