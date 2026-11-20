import { useEditorStore } from './editor-store';
import { booleanOp } from '../tools/path/boolean-ops';
import type { BooleanOp } from '../tools/path/boolean-ops';
import type { Refusal } from '../commands/refusal';
import type { StoredPath } from '../types/paths';

export type { BooleanOp };

export const BOOLEAN_OP_LABELS: Record<BooleanOp, string> = {
  union: 'Unite Paths',
  subtract: 'Subtract Paths',
  intersect: 'Intersect Paths',
  exclude: 'Exclude Paths',
};

/**
 * Why applyBooleanOp would return before computing anything, or null when it
 * has two paths to combine. The Path menu is silent in both cases.
 */
export function booleanOpRefusal(paths: readonly StoredPath[], selectedPathId: string | null): Refusal | null {
  if (paths.length < 2) {
    return { reason: `A boolean path operation needs two paths; the document has ${paths.length}.`, notice: null };
  }
  if (selectedPathId === null || !paths.some((p) => p.id === selectedPathId)) {
    return { reason: 'No path is selected: a boolean path operation combines the selected path with the most recently added other one.', notice: null };
  }
  return null;
}

/**
 * Apply a boolean path operation between the selected path and the most
 * recently created other path. The two source paths are removed and replaced
 * by the result path. Returns whether it changed the paths.
 *
 * Requires: at least 2 paths exist and one is selected.
 */
export function applyBooleanOp(op: BooleanOp): boolean {
  const state = useEditorStore.getState();
  const { paths, selectedPathId } = state;

  if (paths.length < 2 || selectedPathId === null) return false;

  const pathA = paths.find((p) => p.id === selectedPathId);
  if (!pathA) return false;

  // Use the most recently added path that isn't pathA as pathB
  const otherPaths = paths.filter((p) => p.id !== selectedPathId);
  const pathB = otherPaths[otherPaths.length - 1];
  if (!pathB) return false;

  const result = booleanOp(
    { anchors: pathA.anchors, closed: true },
    { anchors: pathB.anchors, closed: true },
    op,
  );

  if (!result.hasArea || result.paths.length === 0) return false;

  state.pushHistoryMetadata(BOOLEAN_OP_LABELS[op]);
  state.removePath(pathA.id, true);
  state.removePath(pathB.id, true);

  // Paths hold a single contour, so a hole or a second island becomes its
  // own path, as Selection → Path does. addPath selects each new path.
  for (const anchors of result.paths) {
    state.addPath(anchors, true);
  }
  return true;
}
