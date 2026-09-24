import { useCallback, useRef, useState } from 'react';
import type { Layer } from '../../types';
import { isGroupLayer, canMoveToGroup, findParentGroup, isAncestorOf } from '../../layers/group-utils';
import styles from './LayerPanel.module.css';

interface DisplayEntry {
  layer: Layer;
  depth: number;
}

/**
 * Translate a display-list drag (top→bottom, respects collapsed
 * groups) into `moveLayer(fromLayerOrderIdx, toLayerOrderIdx)` indices
 * on the full `document.layerOrder` (bottom→top, every layer).
 *
 * #797 — the previous formula `layers.length - 1 - from` treated `from`
 * as if it were an index into the full layers array. That silently
 * picked a HIDDEN child of any collapsed group above the dragged row,
 * so the drop reordered the wrong layer.
 *
 * Returns null when the drag is a no-op (no motion, or the neighbour
 * cannot be resolved).
 */
export function resolveDisplayDropIndices(
  layers: readonly Layer[],
  displayList: readonly DisplayEntry[],
  from: number,
  gap: number,
): { fromIdx: number; toIdx: number } | null {
  const draggedLayer = displayList[from]?.layer;
  if (!draggedLayer) return null;
  const fromIdx = layers.findIndex((l) => l.id === draggedLayer.id);
  if (fromIdx < 0) return null;

  let toIdx: number;
  const neighborAboveEntry = gap < displayList.length ? displayList[gap] : null;
  if (neighborAboveEntry) {
    const neighborIdx = layers.findIndex((l) => l.id === neighborAboveEntry.layer.id);
    if (neighborIdx < 0) return null;
    toIdx = neighborIdx > fromIdx ? neighborIdx : neighborIdx + 1;
  } else {
    toIdx = 0;
  }

  if (toIdx === fromIdx || (fromIdx < toIdx && toIdx === fromIdx + 1)) return null;
  return { fromIdx, toIdx };
}

interface UseLayerDndParams {
  displayList: readonly DisplayEntry[];
  layers: readonly Layer[];
  onReorderLayer: (from: number, to: number) => void;
  moveLayerToGroup: (layerId: string, groupId: string) => void;
}

interface UseLayerDndResult {
  dragIndex: number | null;
  dropGap: number | null;
  dropIntoGroup: string | null;
  editingOpacityId: string | null;
  setEditingOpacityId: (id: string | null) => void;
  listRef: React.RefObject<HTMLDivElement | null>;
  handleGripDown: (e: React.PointerEvent, ri: number) => void;
}

export function useLayerDnd({
  displayList,
  layers,
  onReorderLayer,
  moveLayerToGroup,
}: UseLayerDndParams): UseLayerDndResult {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropGap, setDropGap] = useState<number | null>(null);
  const [dropIntoGroup, setDropIntoGroup] = useState<string | null>(null);
  const [editingOpacityId, setEditingOpacityId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ from: number; gap: number; intoGroup: string | null } | null>(null);

  const handleGripDown = useCallback((e: React.PointerEvent, ri: number) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { from: ri, gap: ri, intoGroup: null };
    setDragIndex(ri);
    setDropGap(ri);
    setDropIntoGroup(null);

    const draggedLayer = displayList[ri]?.layer;

    const onMove = (ev: PointerEvent) => {
      const list = listRef.current;
      if (!list || !dragRef.current) return;
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
          if (entry && isGroupLayer(entry.layer) && relY > h * 0.25 && relY < h * 0.75) {
            if (draggedLayer && canMoveToGroup(layers, draggedLayer.id, entry.layer.id)) {
              intoGroup = entry.layer.id;
              gap = -1;
            }
          } else if (relY < h / 2) {
            gap = i;
          } else {
            gap = i + 1;
          }
          break;
        }
      }

      dragRef.current.gap = gap;
      dragRef.current.intoGroup = intoGroup;
      setDropGap(intoGroup ? null : gap);
      setDropIntoGroup(intoGroup);
    };

    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      const drag = dragRef.current;
      dragRef.current = null;
      setDragIndex(null);
      setDropGap(null);
      setDropIntoGroup(null);
      if (!drag || !draggedLayer) return;

      if (drag.intoGroup) {
        moveLayerToGroup(draggedLayer.id, drag.intoGroup);
        return;
      }

      const { from, gap } = drag;
      if (gap === from || gap === from + 1) return;

      // Use the item BELOW the gap to determine which group the drop
      // position belongs to. This prevents layers from being pulled into
      // a group when dropped at its lower boundary.
      const neighborIdx = gap < displayList.length ? gap : gap - 1;
      const neighbor = displayList[neighborIdx];
      const draggedParent = findParentGroup(layers, draggedLayer.id);

      if (neighbor) {
        let targetParentId: string | null = null;
        const neighborParent = findParentGroup(layers, neighbor.layer.id);
        if (neighborParent) {
          targetParentId = neighborParent.id;
        } else if (isGroupLayer(neighbor.layer)) {
          targetParentId = neighbor.layer.id;
        }

        if (targetParentId && draggedParent && targetParentId !== draggedParent.id) {
          // If the target parent is an ancestor of the dragged layer's
          // current parent, the drop is "escaping outward" past a group
          // boundary (e.g. below the group's last child). The flat
          // reorder honors the drop gap and re-parents based on the
          // neighbor above; jumping straight to moveLayerToGroup would
          // ignore the gap and hoist the layer to the top of the parent
          // stack (#788).
          const isEscapingOutward = isAncestorOf(layers, targetParentId, draggedParent.id);
          if (!isEscapingOutward && canMoveToGroup(layers, draggedLayer.id, targetParentId)) {
            moveLayerToGroup(draggedLayer.id, targetParentId);
            return;
          }
        }
      }

      const resolved = resolveDisplayDropIndices(layers, displayList, from, gap);
      if (!resolved) return;
      onReorderLayer(resolved.fromIdx, resolved.toIdx);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }, [layers, displayList, onReorderLayer, moveLayerToGroup]);

  return {
    dragIndex,
    dropGap,
    dropIntoGroup,
    editingOpacityId,
    setEditingOpacityId,
    listRef,
    handleGripDown,
  };
}
