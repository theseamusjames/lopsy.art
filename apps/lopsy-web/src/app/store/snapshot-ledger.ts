import type { HistorySnapshot } from './types';

const EMPTY_SNAPSHOT_HANDLE = 0xFFFFFFFF;

/**
 * Add every GPU snapshot handle `entry` references — layer pixels and layer
 * masks share the engine's snapshot store — to `out`.
 */
export function addSnapshotHandles(
  entry: HistorySnapshot | null | undefined,
  out: Set<number>,
): void {
  if (!entry || entry.kind !== 'pixels') return;
  for (const handle of entry.gpuSnapshots.values()) {
    if (handle !== EMPTY_SNAPSHOT_HANDLE) out.add(handle);
  }
  for (const { handle } of entry.maskSnapshots.values()) {
    if (handle !== EMPTY_SNAPSHOT_HANDLE) out.add(handle);
  }
}

export interface SnapshotHandleLedger {
  /**
   * Record `live` as the complete set of handles history now references and
   * release every handle it referenced at the previous reconcile but no longer
   * does. A handle is released exactly once: the moment it leaves the set.
   * Handles for which `isProtected` returns true are dropped from the ledger
   * without being released, because something outside history owns them.
   * Returns the released handles.
   */
  reconcile: (live: ReadonlySet<number>, isProtected?: (handle: number) => boolean) => number[];
  /**
   * Drop every tracked handle without releasing it — for handles that belong
   * to a WebGL context that no longer exists.
   */
  forget: () => void;
  size: () => number;
}

/**
 * Mark-and-sweep ownership of undo snapshot textures (#1005). History entries
 * share handles for layers an edit did not touch, so an entry leaving the
 * stacks cannot simply release its own handles; instead every stack change
 * recomputes the referenced set and frees the difference.
 */
export function createSnapshotHandleLedger(release: (handle: number) => void): SnapshotHandleLedger {
  let owned = new Set<number>();

  return {
    reconcile(live, isProtected) {
      const released: number[] = [];
      for (const handle of owned) {
        if (live.has(handle)) continue;
        if (isProtected?.(handle)) continue;
        release(handle);
        released.push(handle);
      }
      owned = new Set(live);
      return released;
    },
    forget() {
      owned = new Set();
    },
    size() {
      return owned.size;
    },
  };
}
