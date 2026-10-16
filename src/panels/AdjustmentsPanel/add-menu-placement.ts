/** Tallest the Add Adjustment menu grows before it scrolls. */
export const ADD_MENU_MAX_HEIGHT = 260;
const GAP = 4;
const VIEWPORT_MARGIN = 8;

export interface AnchorRect {
  top: number;
  bottom: number;
  left: number;
}

export interface AddMenuPlacement {
  /** Viewport y of the menu's top edge (opening down) or bottom edge (opening up). */
  y: number;
  left: number;
  isAbove: boolean;
  maxHeight: number;
}

/**
 * Place the Add Adjustment menu in the viewport next to its button. The menu
 * is fixed-position, outside the effects drawer, because the drawer clips its
 * overflow: on a group with no adjustments it is too short to hold the menu,
 * which hid the first types behind its top edge (#1239). The menu opens upward
 * unless there is more room below, and is capped to the room it gets.
 */
export function placeAddMenu(anchor: AnchorRect, viewportHeight: number): AddMenuPlacement {
  const spaceAbove = anchor.top - GAP - VIEWPORT_MARGIN;
  const spaceBelow = viewportHeight - anchor.bottom - GAP - VIEWPORT_MARGIN;
  const isAbove = spaceAbove >= ADD_MENU_MAX_HEIGHT || spaceAbove >= spaceBelow;
  const room = Math.max(0, isAbove ? spaceAbove : spaceBelow);
  return {
    y: isAbove ? anchor.top - GAP : anchor.bottom + GAP,
    left: anchor.left,
    isAbove,
    maxHeight: Math.min(ADD_MENU_MAX_HEIGHT, room),
  };
}
