import type { HistorySnapshot } from './types';

/**
 * A history entry captured before an edit but only recorded once the edit
 * proves to be real. A Text-tool click creates its layer straight away, but
 * the "Add Text Layer" row waits here: a session that ends with no text
 * leaves no history and keeps the redo stack (#1783).
 *
 * The entry belongs to `layerId`. It is recorded ahead of the next history
 * change (push, undo or redo) while that layer still exists, and dropped
 * otherwise (a new document, a deleted layer).
 */
interface DeferredEntry {
  readonly snapshot: HistorySnapshot;
  readonly layerId: string;
}

let deferred: DeferredEntry | null = null;

export function deferHistoryEntry(snapshot: HistorySnapshot, layerId: string): void {
  deferred = { snapshot, layerId };
}

/** Drop the pending entry for `layerId`. False when there was none to drop. */
export function discardDeferredHistoryEntry(layerId: string): boolean {
  if (deferred?.layerId !== layerId) return false;
  deferred = null;
  return true;
}

/** Remove and return the pending entry, if its layer is still in the document. */
export function takeDeferredHistoryEntry(
  layers: readonly { readonly id: string }[],
): HistorySnapshot | null {
  const entry = deferred;
  deferred = null;
  if (!entry) return null;
  return layers.some((l) => l.id === entry.layerId) ? entry.snapshot : null;
}
