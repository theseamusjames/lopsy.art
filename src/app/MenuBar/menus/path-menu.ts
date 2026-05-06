import { useEditorStore } from '../../editor-store';
import { booleanOp } from '../../../tools/path/boolean-ops';
import type { BooleanOp } from '../../../tools/path/boolean-ops';
import type { MenuDef } from './types';

export type { BooleanOp };

/**
 * Apply a boolean path operation between the selected path and the most
 * recently created other path. The two source paths are removed and replaced
 * by the result path.
 *
 * Requires: at least 2 paths exist and one is selected.
 */
export function applyBooleanOp(op: BooleanOp): void {
  const state = useEditorStore.getState();
  const { paths, selectedPathId } = state;

  if (paths.length < 2 || selectedPathId === null) return;

  const pathA = paths.find((p) => p.id === selectedPathId);
  if (!pathA) return;

  // Use the most recently added path that isn't pathA as pathB
  const otherPaths = paths.filter((p) => p.id !== selectedPathId);
  const pathB = otherPaths[otherPaths.length - 1];
  if (!pathB) return;

  const result = booleanOp(
    { anchors: pathA.anchors, closed: true },
    { anchors: pathB.anchors, closed: true },
    op,
  );

  if (!result.hasArea || result.anchors.length === 0) return;

  // Remove both source paths
  state.removePath(pathA.id);
  state.removePath(pathB.id);

  // Add the result path (addPath also selects the new path)
  state.addPath(result.anchors, true);
}

export function createPathMenu(): MenuDef {
  return {
    label: 'Path',
    items: [
      {
        label: 'Unite Paths',
        action: () => applyBooleanOp('union'),
      },
      {
        label: 'Subtract Paths',
        action: () => applyBooleanOp('subtract'),
      },
      {
        label: 'Intersect Paths',
        action: () => applyBooleanOp('intersect'),
      },
      {
        label: 'Exclude Paths',
        action: () => applyBooleanOp('exclude'),
      },
    ],
  };
}
