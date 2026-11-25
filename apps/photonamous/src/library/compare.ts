/** Which photos the side-by-side views show. Pure. */

/** How many photos a side-by-side view holds: two up, or four up. */
export type CompareSize = 2 | 4;

/**
 * The photos a view of `size` shows, in the grid's order: the selected
 * ones; then, when fewer than `size` are selected, the photos that come
 * after the first of them in the grid, and failing those the ones before
 * it. With nothing selected it starts from the focused photo, or the
 * first. So
 * the view always has something to show: selecting is a way to say which
 * photos, not a condition for opening it.
 */
export function comparePhotos(selected: readonly string[], focus: string | null, ordered: readonly string[], size: CompareSize): string[] {
  const place = new Map(ordered.map((id, index) => [id, index]));
  const shown = new Set(selected.filter((id) => place.has(id)).slice(0, size));
  if (shown.size === 0) {
    const start = focus !== null && place.has(focus) ? focus : ordered[0];
    if (start === undefined) return [];
    shown.add(start);
  }
  const first = Math.min(...[...shown].map((id) => place.get(id) ?? 0));
  for (let at = first + 1; at < ordered.length && shown.size < size; at++) shown.add(ordered[at]!);
  for (let at = first - 1; at >= 0 && shown.size < size; at--) shown.add(ordered[at]!);
  return ordered.filter((id) => shown.has(id));
}
