/**
 * A sidebar list that could run long (albums, keywords, imports) shows its
 * first few rows until it is opened out (pure).
 */

/** The rows a list shows before "Show all". */
export const SHORT_LIST = 8;

/**
 * The rows to show: every one when the list is opened out or short enough,
 * else the first `limit`, and after them the selected row when it is
 * further down, so what the grid is showing is always marked in the list.
 */
export function shortList<T>(items: readonly T[], isAll: boolean, isSelected: (item: T) => boolean, limit = SHORT_LIST): readonly T[] {
  if (isAll || items.length <= limit) return items;
  const head = items.slice(0, limit);
  const selected = items.slice(limit).find(isSelected);
  return selected === undefined ? head : [...head, selected];
}

/** Whether the list has more rows than it shows short, so it gets the button that opens it out. */
export function isLongList(count: number, limit = SHORT_LIST): boolean {
  return count > limit;
}
