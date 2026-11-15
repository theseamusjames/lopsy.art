/**
 * Mouse pointer mode — discriminated so invalid combinations
 * (e.g. panning without a start point) can't be represented.
 *
 * Replaces three orthogonal booleans (isPanning, isSpaceDown, panStartRef)
 * with one tagged value owned by App.tsx.
 */
export type PointerMode =
  | { kind: 'idle' }
  | { kind: 'spaceHeld' }
  | {
      kind: 'panning';
      startScreenX: number;
      startScreenY: number;
      startPanX: number;
      startPanY: number;
    };

export const POINTER_IDLE: PointerMode = { kind: 'idle' };
export const POINTER_SPACE_HELD: PointerMode = { kind: 'spaceHeld' };

export function isPanning(mode: PointerMode): boolean {
  return mode.kind === 'panning';
}

/**
 * True when a pan would start on the next mouse-down — either the user is
 * already panning, or they're holding space and ready to grab the canvas.
 */
export function showsGrabCursor(mode: PointerMode): boolean {
  return mode.kind !== 'idle';
}
