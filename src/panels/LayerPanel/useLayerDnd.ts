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

/**
 * Band at the list's top and bottom edge that scrolls it during a row
 * drag — at most two thirds of a 36px row. The band only reaches into
 * the row the edge cuts through: a row that is fully on screen can be
 * targeted precisely, so scrolling it out from under a resting pointer
 * would drop the layer somewhere the user never aimed (#1190).
 */
export const AUTO_SCROLL_ZONE_PX = 24;

/**
 * Part of the edge band that scrolls whatever row it covers, so a list
 * whose edge falls exactly between two rows can still be scrolled without
 * leaving it.
 */
export const AUTO_SCROLL_EDGE_BAND_PX = 8;

/** Scroll step per animation frame with the pointer at or past an edge. */
export const AUTO_SCROLL_MAX_STEP_PX = 16;

/**
 * Client y range of the rows the list's edges cut through. `topClipEnd`
 * is the bottom of the row cut by the top edge, `bottomClipStart` the top
 * of the row cut by the bottom edge; each equals its edge when no row is
 * cut there.
 */
export interface EdgeClips {
  topClipEnd: number;
  bottomClipStart: number;
}

/** Where the list's edges cut through `rows` (client px). */
export function edgeClips(
  rows: readonly { top: number; bottom: number }[],
  top: number,
  bottom: number,
): EdgeClips {
  let topClipEnd = top;
  let bottomClipStart = bottom;
  for (const row of rows) {
    if (row.top < top && row.bottom > top) topClipEnd = row.bottom;
    if (row.top < bottom && row.bottom > bottom) bottomClipStart = row.top;
  }
  return { topClipEnd, bottomClipStart };
}

/**
 * Per-frame scroll step for a row drag with the pointer at `pointerY`
 * over a list spanning `top`..`bottom` (client px). Negative scrolls up.
 * The step grows linearly from 1px at the inner edge of a zone to the
 * maximum at the list edge, and stays at the maximum past it so dragging
 * over the toolbar or a neighbouring panel keeps scrolling. The zone
 * shrinks on short lists so the two never overlap, and covers only the
 * edge band plus the visible part of a row the edge cuts through.
 */
export function autoScrollStep(pointerY: number, top: number, bottom: number, clips: EdgeClips): number {
  const zone = Math.min(AUTO_SCROLL_ZONE_PX, (bottom - top) / 4);
  if (zone <= 0) return 0;
  const band = Math.min(AUTO_SCROLL_EDGE_BAND_PX, zone);
  const topZone = Math.min(zone, Math.max(band, clips.topClipEnd - top));
  const bottomZone = Math.min(zone, Math.max(band, bottom - clips.bottomClipStart));
  if (pointerY - top < topZone) {
    const depth = zone - (pointerY - top);
    return -Math.ceil(AUTO_SCROLL_MAX_STEP_PX * Math.min(1, depth / zone));
  }
  if (bottom - pointerY < bottomZone) {
    const depth = zone - (bottom - pointerY);
    return Math.ceil(AUTO_SCROLL_MAX_STEP_PX * Math.min(1, depth / zone));
  }
  return 0;
}

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

interface RowHit {
  /** Gap above display row `gap` (rows.length = below the last row). */
  gap: number;
  /** Row whose middle half the pointer is over, when it accepts a drop into it. */
  intoRow: number | null;
}

/**
 * Hit-test client `y` against the rendered rows: the top half of a row
 * picks the gap above it, the bottom half the gap below, and the middle
 * half of a row `canDropInto` accepts targets the row itself.
 */
function pickRowAt(
  rows: readonly Element[],
  y: number,
  canDropInto: (index: number) => boolean,
): RowHit {
  for (const [i, row] of rows.entries()) {
    const rect = row.getBoundingClientRect();
    const relY = y - rect.top;
    const h = rect.height;
    if (relY < 0) return { gap: i, intoRow: null };
    if (relY >= h) continue;
    if (relY > h * 0.25 && relY < h * 0.75 && canDropInto(i)) return { gap: i, intoRow: i };
    return { gap: relY < h / 2 ? i : i + 1, intoRow: null };
  }
  return { gap: rows.length, intoRow: null };
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

    const pointer = { x: e.clientX, y: e.clientY };
    let scrollFrame: number | null = null;

    const updateTarget = () => {
      const list = listRef.current;
      const drag = dragRef.current;
      if (!list || !drag) return;
      // Rows scrolled out of view still have client rects above or below
      // the list; clamping keeps a pointer outside the list from
      // targeting a row the user cannot see.
      const listRect = list.getBoundingClientRect();
      const y = Math.min(Math.max(pointer.y, listRect.top), listRect.bottom - 1);
      const rows = Array.from(list.querySelectorAll(`.${styles.itemWrapper}`));
      const rowHit = pickRowAt(rows, y, (i) => {
        const entry = displayList[i];
        return !!entry && isGroupLayer(entry.layer) && canMoveToGroup(layers, draggedLayer.id, entry.layer.id);
      });
      const intoGroup = rowHit.intoRow !== null ? displayList[rowHit.intoRow]?.layer.id ?? null : null;

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
      const gap = Math.max(1, rowHit.gap);
      const desiredDepth = draggedEntry.depth + Math.round((pointer.x - startX) / DROP_DEPTH_STEP_PX);
      const slot = resolveGapDrop(layers, displayList, draggedLayer.id, gap, desiredDepth);
      const isNoop = !slot || isSameTarget(current, slot.target);
      drag.slot = isNoop ? null : slot;
      drag.gap = isNoop ? null : gap;
      drag.intoGroup = null;
      setDropGap(drag.gap);
      setDropDepth(drag.slot ? drag.slot.depth : null);
      setDropIntoGroup(null);
    };

    // Runs once per frame while the pointer sits in an edge zone. The
    // list's scroll listener re-targets, since the rows move under a
    // pointer that may not.
    const autoScroll = () => {
      scrollFrame = null;
      const list = listRef.current;
      if (!list || !dragRef.current) return;
      const rect = list.getBoundingClientRect();
      const rowRects = Array.from(list.querySelectorAll(`.${styles.itemWrapper}`), (row) => row.getBoundingClientRect());
      const clips = edgeClips(rowRects, rect.top, rect.bottom);
      const step = autoScrollStep(pointer.y, rect.top, rect.bottom, clips);
      if (step === 0) return;
      const before = list.scrollTop;
      list.scrollTop = before + step;
      if (list.scrollTop === before) return;
      scrollFrame = requestAnimationFrame(autoScroll);
    };

    const onMove = (ev: PointerEvent) => {
      pointer.x = ev.clientX;
      pointer.y = ev.clientY;
      updateTarget();
      if (scrollFrame === null) scrollFrame = requestAnimationFrame(autoScroll);
    };

    const scrollTarget = listRef.current;

    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      scrollTarget?.removeEventListener('scroll', updateTarget);
      if (scrollFrame !== null) cancelAnimationFrame(scrollFrame);
      scrollFrame = null;
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
    scrollTarget?.addEventListener('scroll', updateTarget);
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
