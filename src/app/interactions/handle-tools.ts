import type { ToolId } from '../../types';

/**
 * Tools whose press on a scale handle resizes the selection outline.
 * They all drag out a selection, so a press on a handle is plausibly a
 * resize. The Magic Wand is a click tool: a press near a corner is a wand
 * click (often Shift/Alt on a neighbouring region), never a resize.
 */
const SELECTION_OUTLINE_HANDLE_TOOLS: ReadonlySet<ToolId> = new Set<ToolId>([
  'marquee-rect',
  'marquee-ellipse',
  'lasso',
  'lasso-magnetic',
]);

export function scalesSelectionOutlineFromHandles(tool: ToolId): boolean {
  return SELECTION_OUTLINE_HANDLE_TOOLS.has(tool);
}

/** Whether a press on a transform handle is the handle's, not the tool's. */
export function usesTransformHandles(tool: ToolId): boolean {
  return tool === 'move' || SELECTION_OUTLINE_HANDLE_TOOLS.has(tool);
}
