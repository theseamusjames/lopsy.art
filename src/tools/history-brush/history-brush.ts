import type { HistorySnapshot } from '../../app/store/types';

export type HistoryBrushResolution =
  | { kind: 'ok'; snapshotId: string; blob: Uint8Array | null; label: string }
  | { kind: 'no-source' }
  | { kind: 'snapshot-gone' }
  | { kind: 'layer-missing' };

/**
 * Resolve the source snapshot for the History Brush tool. The source is a
 * stable `snapshotId`, not an index into the undo stack — so it survives
 * new history pushes and partial undo/redo.
 *
 * If the chosen snapshot is `metadataOnly` for the active layer (empty
 * pixel blob), walk backwards through earlier snapshots to find the most
 * recent one that has pixel data for that layer. This mirrors the
 * semantics that "pixels at state X" equals "pixels at the last full
 * snapshot ≤ X", since metadata-only snapshots by definition changed no
 * pixels.
 *
 * The "Original" row has no layer blobs — it resolves to a valid source
 * with `blob: null`, which the caller treats as all-transparent.
 */
export function resolveHistorySource(
  sourceId: string | null,
  activeLayerId: string,
  undoStack: readonly HistorySnapshot[],
  originSnapshotId: string,
): HistoryBrushResolution {
  if (sourceId === null) return { kind: 'no-source' };

  if (sourceId === originSnapshotId) {
    return { kind: 'ok', snapshotId: originSnapshotId, blob: null, label: 'Original' };
  }

  const index = undoStack.findIndex((s) => s.id === sourceId);
  if (index === -1) return { kind: 'snapshot-gone' };

  const target = undoStack[index]!;
  if (!target.document.layerOrder.includes(activeLayerId)) {
    return { kind: 'layer-missing' };
  }

  for (let i = index; i >= 0; i--) {
    const snap = undoStack[i]!;
    if (!snap.document.layerOrder.includes(activeLayerId)) continue;
    const blob = snap.gpuSnapshots.get(activeLayerId);
    if (blob && blob.length > 0) {
      return { kind: 'ok', snapshotId: target.id, blob, label: target.label };
    }
  }

  // No pixel data anywhere back to origin — treat as transparent.
  return { kind: 'ok', snapshotId: target.id, blob: null, label: target.label };
}
