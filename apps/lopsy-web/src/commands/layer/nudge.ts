import { CommandError } from '../command';
import { defineCommand } from '../registry';
import { refusalError } from '../refusal';
import { activateIfOther, layerRefSpec, offsetSpec as boundedOffsetSpec, requireDocument, requireEngine, resolveLayer } from '../context';
import { useEditorStore } from '../../app/editor-store';
import { useUIStore } from '../../app/ui-store';
import { nudgeMove, nudgeSelection } from '../../app/interactions/gesture-session';
import { isNudgeHeld, releaseNudgeKey, scheduleNudge } from '../../app/shortcuts/nudge-coalesce';
import { nudgeRefusal, nudgeTargetOf, type NudgeTarget } from '../../app/shortcuts/tool-shortcuts';
import type { Rect } from '../../types';

/** The held-key name the coalescer tracks for a command's burst; no arrow key shares it. */
const COMMAND_NUDGE_KEY = 'command-nudge';

const APPLY: Record<NudgeTarget, (dx: number, dy: number) => void> = {
  move: nudgeMove,
  selection: nudgeSelection,
};

const offsetSpec = (axis: 'Horizontal' | 'Vertical', positive: string) =>
  ({
    ...boundedOffsetSpec(`${axis} offset in document pixels; positive moves ${positive}. The arrow keys move 1 px (10 with Shift) per press.`, { integer: true }),
    default: 0,
  }) as const;

export interface LayerNudgeResult {
  layer: string;
  /** The layer's position afterwards, in document pixels. */
  x: number;
  y: number;
  /** The selection's bounds afterwards (the floated pixels' outline), or null with no selection. */
  selection: Rect | null;
}

export interface SelectNudgeResult {
  /** The selection's bounds afterwards, in document pixels. */
  bounds: Rect | null;
}

function checkOffset(id: string, dx: number, dy: number): void {
  if (dx === 0 && dy === 0) throw new CommandError('invalid', `${id}: dx and dy are both 0; nothing would move.`);
}

function checkNoHeldKey(): void {
  if (isNudgeHeld()) {
    throw new CommandError('refused', 'An arrow key is being held: its nudge has not ended yet, so this one would join its history step. Release it first.');
  }
}

function checkNudgeable(target: NudgeTarget): void {
  const refusal = nudgeRefusal(target);
  if (refusal) throw refusalError(refusal);
}

/**
 * One held arrow-key burst ending in its release, as the keyboard handler
 * and its keyup run it: one "Nudge" history entry, the offset applied, the
 * held mask flushed.
 */
function nudgeBurst(target: NudgeTarget, dx: number, dy: number): void {
  scheduleNudge(COMMAND_NUDGE_KEY, false, dx, dy, APPLY[target]);
  releaseNudgeKey(COMMAND_NUDGE_KEY);
}

function selectionBounds(): Rect | null {
  const { selection } = useEditorStore.getState();
  return selection.active && selection.bounds ? { ...selection.bounds } : null;
}

export const layerNudge = defineCommand({
  id: 'layer.nudge',
  summary:
    'Nudges the active layer by (dx, dy) document pixels as the arrow keys do with the Move tool: one burst of presses held and released, so one history step ("Nudge"). With a selection active the selected pixels are floated and moved instead, as the keys do (the float stays live until something commits it, for example select.none with commit: true). The Move tool is selected first, as tool.select does, since the keys only nudge with it; a named layer is made active first, as a click on its row does. The offsets are exact: the grid snapping the keys apply (one grid step per press) is not. Refused on a locked layer, while Mesh Warp is open, and where the keys only hint (a selection over part of a live text layer, a selection move in mask edit mode). Returns the layer id, its position and the selection bounds afterwards.',
  surface: 'document',
  params: {
    layer: layerRefSpec,
    dx: offsetSpec('Horizontal', 'right'),
    dy: offsetSpec('Vertical', 'down'),
  },
  run({ layer: ref, dx, dy }): LayerNudgeResult {
    requireDocument();
    requireEngine();
    const layer = resolveLayer(ref);
    checkOffset('layer.nudge', dx, dy);
    if (layer.locked) throw new CommandError('refused', `"${layer.name}" is locked: the arrow keys do not move it.`);
    checkNoHeldKey();
    activateIfOther(layer.id);
    if (useUIStore.getState().activeTool !== 'move') useUIStore.getState().setActiveTool('move');
    checkNudgeable('move');
    nudgeBurst('move', dx, dy);
    const after = useEditorStore.getState().document.layers.find((l) => l.id === layer.id);
    return { layer: layer.id, x: after?.x ?? layer.x, y: after?.y ?? layer.y, selection: selectionBounds() };
  },
});

export const selectNudge = defineCommand({
  id: 'select.nudge',
  summary:
    'Moves the selection outline (not the pixels) by (dx, dy) document pixels as the arrow keys do with a selection tool: one burst of presses held and released, one history step ("Nudge"). When no selection tool is active the Rectangular Marquee is selected first, as tool.select does, since the keys only move the outline with one. The offsets are exact: the grid snapping the keys apply is not. Refused with nothing selected and while Mesh Warp is open. Returns the selection bounds afterwards.',
  surface: 'document',
  params: {
    dx: offsetSpec('Horizontal', 'right'),
    dy: offsetSpec('Vertical', 'down'),
  },
  run({ dx, dy }): SelectNudgeResult {
    requireDocument();
    checkOffset('select.nudge', dx, dy);
    const { selection } = useEditorStore.getState();
    if (!selection.active || !selection.mask) throw new CommandError('refused', 'Nothing is selected: there is no outline to nudge.');
    checkNoHeldKey();
    if (nudgeTargetOf(useUIStore.getState().activeTool) !== 'selection') useUIStore.getState().setActiveTool('marquee-rect');
    checkNudgeable('selection');
    nudgeBurst('selection', dx, dy);
    return { bounds: selectionBounds() };
  },
});
