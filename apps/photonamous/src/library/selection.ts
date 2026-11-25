/**
 * Grid selection: which photos are selected, the anchor for shift-click
 * ranges and the focused photo the keyboard moves. Pure; the store keeps
 * one of these.
 */

export interface Selection {
  readonly ids: ReadonlySet<string>;
  /** Where a shift-click range starts. */
  readonly anchor: string | null;
  /** The photo the keyboard acts on and Single view shows. */
  readonly focus: string | null;
}

export const EMPTY_SELECTION: Selection = { ids: new Set(), anchor: null, focus: null };

/** A plain click: only this photo. */
export function selectOne(id: string): Selection {
  return { ids: new Set([id]), anchor: id, focus: id };
}

/** Cmd/Ctrl-click: add or remove one photo. */
export function toggleOne(selection: Selection, id: string): Selection {
  const ids = new Set(selection.ids);
  if (ids.has(id)) ids.delete(id);
  else ids.add(id);
  return { ids, anchor: id, focus: id };
}

/** Shift-click: everything between the anchor and this photo, in display order. */
export function selectRange(
  selection: Selection,
  orderedIds: readonly string[],
  id: string,
  additive = false,
): Selection {
  const anchor = selection.anchor ?? selection.focus;
  const from = anchor === null ? -1 : orderedIds.indexOf(anchor);
  const to = orderedIds.indexOf(id);
  if (to < 0) return selection;
  if (from < 0 || anchor === null) return selectOne(id);
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const ids = additive ? new Set(selection.ids) : new Set<string>();
  for (let i = lo; i <= hi; i++) {
    const item = orderedIds[i];
    if (item !== undefined) ids.add(item);
  }
  return { ids, anchor, focus: id };
}

export function selectAll(orderedIds: readonly string[], focus: string | null): Selection {
  const first = focus ?? orderedIds[0] ?? null;
  return { ids: new Set(orderedIds), anchor: first, focus: first };
}

/** Moves focus by `delta` positions and selects only the new photo; with `extend`, grows the range instead. */
export function moveFocus(
  selection: Selection,
  orderedIds: readonly string[],
  delta: number,
  extend = false,
): Selection {
  if (orderedIds.length === 0) return EMPTY_SELECTION;
  const current = selection.focus === null ? -1 : orderedIds.indexOf(selection.focus);
  const start = current < 0 ? (delta > 0 ? -1 : orderedIds.length) : current;
  const next = Math.max(0, Math.min(orderedIds.length - 1, start + delta));
  const id = orderedIds[next];
  if (id === undefined) return selection;
  if (!extend) return selectOne(id);
  const base = selection.anchor === null ? { ...selection, anchor: selection.focus ?? id } : selection;
  return selectRange(base, orderedIds, id);
}

/**
 * Moves focus to the photo at `index`: `select` selects only it, `extend`
 * grows the range from the anchor, `keep` leaves the selection as it is.
 */
export function focusAt(
  selection: Selection,
  orderedIds: readonly string[],
  index: number,
  how: 'select' | 'extend' | 'keep',
): Selection {
  const id = orderedIds[index];
  if (id === undefined) return selection;
  if (how === 'select') return selectOne(id);
  if (how === 'keep') return { ...selection, focus: id };
  const base = selection.anchor === null ? { ...selection, anchor: selection.focus ?? id } : selection;
  return selectRange(base, orderedIds, id);
}

/** Drops ids that are no longer shown (after a filter change or a delete). */
export function pruneSelection(selection: Selection, visible: ReadonlySet<string>): Selection {
  let changed = false;
  const ids = new Set<string>();
  for (const id of selection.ids) {
    if (visible.has(id)) ids.add(id);
    else changed = true;
  }
  const focus = selection.focus !== null && visible.has(selection.focus) ? selection.focus : null;
  const anchor = selection.anchor !== null && visible.has(selection.anchor) ? selection.anchor : null;
  if (!changed && focus === selection.focus && anchor === selection.anchor) return selection;
  return { ids, anchor, focus };
}

/** Selected ids in display order. */
export function orderedSelection(selection: Selection, orderedIds: readonly string[]): string[] {
  if (selection.ids.size === 0) return [];
  return orderedIds.filter((id) => selection.ids.has(id));
}

/** What a command acts on: the selection, or the focused photo when nothing is selected. */
export function targetIds(selection: Selection): string[] {
  if (selection.ids.size > 0) return [...selection.ids];
  return selection.focus === null ? [] : [selection.focus];
}

/**
 * Where the selection goes when photos leave the grid (set aside,
 * deleted): the first tile after the last one leaving that stays, else the
 * last one before them that stays; null when nothing is left. So the
 * next photo is up.
 */
export function nextAfterRemoval(orderedIds: readonly string[], leaving: ReadonlySet<string>, assetOf: (id: string) => string): string | null {
  const gone = (id: string) => leaving.has(assetOf(id));
  let last = -1;
  let first = -1;
  orderedIds.forEach((id, i) => {
    if (!gone(id)) return;
    if (first < 0) first = i;
    last = i;
  });
  if (last < 0) return null;
  for (let i = last + 1; i < orderedIds.length; i++) {
    const id = orderedIds[i];
    if (id !== undefined && !gone(id)) return id;
  }
  for (let i = first - 1; i >= 0; i--) {
    const id = orderedIds[i];
    if (id !== undefined && !gone(id)) return id;
  }
  return null;
}
