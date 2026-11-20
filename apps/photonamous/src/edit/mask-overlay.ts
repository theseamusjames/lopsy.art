/**
 * When the selected mask shows in red on the photo (pure). The red hides
 * the adjustment being made, so it shows only when asked for (Show mask,
 * O), while the mask's shape changes, and for a moment after that or after
 * the mask is added or chosen, which tells what part of the photo it
 * covers. It never shows while one of the mask's own sliders (Amount and
 * the adjustments) is dragged, Show mask or not. Masks are areas in the
 * recipe, so their paths start `areas.<id>.`.
 */

/** How long the mask stays shown after its shape last changed, or after it was added or chosen. */
export const MASK_FLASH_MS = 1000;

/** What a drag in progress does to a mask: changes its shape, adjusts it, or neither. */
export type MaskActivity = 'shape' | 'adjust' | null;

/** What `draft` (the recipe values of a drag in progress, by path) does to the mask `id`. */
export function maskActivity(draft: Readonly<Record<string, unknown>> | null, id: string): MaskActivity {
  if (!draft) return null;
  const prefix = `areas.${id}.`;
  let activity: MaskActivity = null;
  for (const path of Object.keys(draft)) {
    if (!path.startsWith(prefix)) continue;
    const field = path.slice(prefix.length);
    if (field === 'amount' || field.startsWith('adjustments.')) return 'adjust';
    if (field === 'geometry' || field.startsWith('geometry.')) activity = 'shape';
  }
  return activity;
}

export interface MaskOverlayState {
  /** The selected mask while the Masks panel is open; null for none. */
  readonly selectedId: string | null;
  /** Show mask (O). */
  readonly isShown: boolean;
  /** Within MASK_FLASH_MS of the last change to the mask's shape, or of its adding or choosing. */
  readonly isFlashing: boolean;
  /** The recipe values of a drag in progress, by path; null when nothing is dragged. */
  readonly draft: Readonly<Record<string, unknown>> | null;
}

/** The mask whose red overlay shows, or null for none. */
export function maskOverlayId({ selectedId, isShown, isFlashing, draft }: MaskOverlayState): string | null {
  if (selectedId === null) return null;
  const activity = maskActivity(draft, selectedId);
  if (activity === 'adjust') return null;
  return isShown || isFlashing || activity === 'shape' ? selectedId : null;
}
