import { useCallback, useRef, useState } from 'react';
import type { Layer } from '../../types';
import type { LayerDropTarget } from '../../app/store/actions/drop-layer';
import { isGroupLayer, canMoveToGroup, findParentGroup, getDescendantIds } from '../../layers/group-utils';
import styles from './LayerPanel.module.css';

interface DisplayEntry {
  layer: Layer;
  depth: number;
}

/**
 * Horizontal pointer travel that shifts the drop depth by one level.
 * Twice the 8px row indent so small sideways jitter during a vertical
 * drag doesn't flip the drop in or out of a group.
 */
export const DROP_DEPTH_STEP_PX = 16;

export interface GapDropSlot {
  target: LayerDropTarget;
  /** Display depth of the dropped row — drives the indicator's indent. */
  depth: number;
}

/**
 * Resolve a drop in the gap above display row `gap` into a tree position.
 *
 * A gap below the last child of a group is ambiguous: it can mean "bottom
 * of that group" or "below the group, one level up". The panel resolves
 * it by depth — `desiredDepth` (the dragged row's depth plus horizontal
 * pointer travel) is clamped to the depths that gap can hold, and the
 * indicator is indented to the same depth. The same slot feeds both the
 * indicator and the drop, so the result always matches what was shown
 * (#814, #824).
 *
 * The dragged row and its subtree are removed from the list first so a
 * group can never be dropped inside itself and its own rows never serve
 * as the neighbour.
 */
export function resolveGapDrop(
  layers: readonly Layer[],
  displayList: readonly DisplayEntry[],
  draggedId: string,
  gap: number,
  desiredDepth: number,
): GapDropSlot | null {
  const excluded = new Set([draggedId, ...getDescendantIds(layers, draggedId)]);
  const rows: DisplayEntry[] = [];
  let effectiveGap = 0;
  for (const [i, entry] of displayList.entries()) {
    if (excluded.has(entry.layer.id)) continue;
    if (i < gap) effectiveGap++;
    rows.push(entry);
  }
  // Nothing may be dropped above the root row.
  effectiveGap = Math.max(1, effectiveGap);

  const above = rows[effectiveGap - 1];
  if (!above) return null;
  const below = rows[effectiveGap];

  const canNest = isGroupLayer(above.layer) && !above.layer.collapsed;
  const maxDepth = canNest ? above.depth + 1 : above.depth;
  const minDepth = Math.max(1, below ? below.depth : 1);
  if (minDepth > maxDepth) return null;
  const depth = Math.min(maxDepth, Math.max(minDepth, desiredDepth));

  if (canNest && depth === above.depth + 1) {
    return { target: { parentId: above.layer.id, belowId: null }, depth };
  }

  let sibling: Layer = above.layer;
  for (let d = above.depth; d > depth; d--) {
    const parent = findParentGroup(layers, sibling.id);
    if (!parent) return null;
    sibling = parent;
  }
  const parent = findParentGroup(layers, sibling.id);
  if (!parent) return null;
  return { target: { parentId: parent.id, belowId: sibling.id }, depth };
}

/**
 * The slot the layer already occupies: its parent, and the sibling
 * directly above it in the panel (by layerOrder, not `children` order).
 */
export function currentDropTarget(
  layers: readonly Layer[],
  layerOrder: readonly string[],
  layerId: string,
): LayerDropTarget | null {
  const parent = findParentGroup(layers, layerId);
  if (!parent) return null;
  const rank = new Map(layerOrder.map((id, i) => [id, i]));
  const ownRank = rank.get(layerId) ?? -1;
  let belowId: string | null = null;
  let belowRank = Infinity;
  for (const childId of parent.children) {
    const r = rank.get(childId);
    if (r === undefined || r <= ownRank || r >= belowRank) continue;
    belowId = childId;
    belowRank = r;
  }
  return { parentId: parent.id, belowId };
}

function isSameTarget(a: LayerDropTarget | null, b: LayerDropTarget): boolean {
  return a !== null && a.parentId === b.parentId && a.belowId === b.belowId;
}

interface UseLayerDndParams {
  displayList: readonly DisplayEntry[];
  layers: readonly Layer[];
  layerOrder: readonly string[];
  onDropLayer: (layerId: string, target: LayerDropTarget) => void;
}

interface UseLayerDndResult {
  dragIndex: number | null;
  dropGap: number | null;
  dropDepth: number | null;
  dropIntoGroup: string | null;
  editingOpacityId: string | null;
  setEditingOpacityId: (id: string | null) => void;
  listRef: React.RefObject<HTMLDivElement | null>;
  handleGripDown: (e: React.PointerEvent, ri: number) => void;
}

interface DragState {
  slot: GapDropSlot | null;
  gap: number | null;
  intoGroup: string | null;
}

export function useLayerDnd({
  displayList,
  layers,
  layerOrder,
  onDropLayer,
}: UseLayerDndParams): UseLayerDndResult {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropGap, setDropGap] = useState<number | null>(null);
  const [dropDepth, setDropDepth] = useState<number | null>(null);
  const [dropIntoGroup, setDropIntoGroup] = useState<string | null>(null);
  const [editingOpacityId, setEditingOpacityId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const handleGripDown = useCallback((e: React.PointerEvent, ri: number) => {
    e.preventDefault();
    e.stopPropagation();
    const draggedEntry = displayList[ri];
    if (!draggedEntry) return;
    const draggedLayer = draggedEntry.layer;
    const startX = e.clientX;
    const current = currentDropTarget(layers, layerOrder, draggedLayer.id);

    dragRef.current = { slot: null, gap: null, intoGroup: null };
    setDragIndex(ri);
    setDropGap(null);
    setDropDepth(null);
    setDropIntoGroup(null);

    const onMove = (ev: PointerEvent) => {
      const list = listRef.current;
      const drag = dragRef.current;
      if (!list || !drag) return;
      const items = list.querySelectorAll(`.${styles.itemWrapper}`);
      let gap = items.length;
      let intoGroup: string | null = null;

      for (let i = 0; i < items.length; i++) {
        const rect = items[i]!.getBoundingClientRect();
        const relY = ev.clientY - rect.top;
        const h = rect.height;

        if (relY < 0) {
          gap = i;
          break;
        }

        if (relY < h) {
          const entry = displayList[i];
          if (entry && isGroupLayer(entry.layer) && relY > h * 0.25 && relY < h * 0.75
            && canMoveToGroup(layers, draggedLayer.id, entry.layer.id)) {
            intoGroup = entry.layer.id;
          } else if (relY < h / 2) {
            gap = i;
          } else {
            gap = i + 1;
          }
          break;
        }
      }

      if (intoGroup) {
        const target: LayerDropTarget = { parentId: intoGroup, belowId: null };
        const isNoop = isSameTarget(current, target);
        drag.slot = isNoop ? null : { target, depth: draggedEntry.depth };
        drag.gap = null;
        drag.intoGroup = isNoop ? null : intoGroup;
        setDropGap(null);
        setDropDepth(null);
        setDropIntoGroup(drag.intoGroup);
        return;
      }

      // The root row is always first; nothing can be dropped above it.
      gap = Math.max(1, gap);
      const desiredDepth = draggedEntry.depth + Math.round((ev.clientX - startX) / DROP_DEPTH_STEP_PX);
      const slot = resolveGapDrop(layers, displayList, draggedLayer.id, gap, desiredDepth);
      const isNoop = !slot || isSameTarget(current, slot.target);
      drag.slot = isNoop ? null : slot;
      drag.gap = isNoop ? null : gap;
      drag.intoGroup = null;
      setDropGap(drag.gap);
      setDropDepth(drag.slot ? drag.slot.depth : null);
      setDropIntoGroup(null);
    };

    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      const drag = dragRef.current;
      dragRef.current = null;
      setDragIndex(null);
      setDropGap(null);
      setDropDepth(null);
      setDropIntoGroup(null);
      if (!drag?.slot) return;
      onDropLayer(draggedLayer.id, drag.slot.target);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }, [layers, layerOrder, displayList, onDropLayer]);

  return {
    dragIndex,
    dropGap,
    dropDepth,
    dropIntoGroup,
    editingOpacityId,
    setEditingOpacityId,
    listRef,
    handleGripDown,
  };
}
