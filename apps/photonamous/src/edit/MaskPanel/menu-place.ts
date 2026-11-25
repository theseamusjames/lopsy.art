/**
 * Where a menu opened from a button in the Mask panel goes (pure). The
 * panel scrolls and its foot is at the bottom of the window, so the menu
 * is placed in the window, not in the panel: under its button when it
 * fits there, over it when there is more room above.
 */

export interface TriggerRect {
  readonly left: number;
  readonly top: number;
  readonly bottom: number;
}

export interface MenuPlace {
  readonly left: number;
  /** From the window's top, when the menu opens under its button. */
  readonly top: number | null;
  /** From the window's bottom, when it opens over it. */
  readonly bottom: number | null;
  /** The tallest it may be before it scrolls. */
  readonly maxHeight: number;
}

/** Between the button and the menu. */
const GAP = 4;
/** Kept clear at the window's edge. */
const MARGIN = 8;

export function placeMenu(trigger: TriggerRect, viewportHeight: number, wantedHeight: number): MenuPlace {
  const below = viewportHeight - trigger.bottom - GAP - MARGIN;
  const above = trigger.top - GAP - MARGIN;
  if (below < wantedHeight && above > below) {
    return { left: trigger.left, top: null, bottom: viewportHeight - trigger.top + GAP, maxHeight: Math.max(0, above) };
  }
  return { left: trigger.left, top: trigger.bottom + GAP, bottom: null, maxHeight: Math.max(0, below) };
}
