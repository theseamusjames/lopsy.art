/**
 * Quick Mask buffer — stores the in-progress quick mask as a grayscale
 * Uint8ClampedArray matching document dimensions.
 *
 * 255 = selected (no red overlay), 0 = unselected (red overlay shown).
 *
 * This is separate from layer masks. It represents a temporary editable
 * version of the selection mask that the brush/eraser tools paint on.
 */

export interface QuickMaskBuffer {
  /** Grayscale mask: 255 = selected, 0 = unselected. Length = docWidth * docHeight. */
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

let activeQuickMaskBuffer: QuickMaskBuffer | null = null;

export function getQuickMaskBuffer(): QuickMaskBuffer | null {
  return activeQuickMaskBuffer;
}

export function setQuickMaskBuffer(buf: QuickMaskBuffer): void {
  activeQuickMaskBuffer = buf;
}

export function clearQuickMaskBuffer(): void {
  activeQuickMaskBuffer = null;
}

/**
 * Create a new quick mask buffer from an existing selection mask, or
 * all-zeroes (fully unselected) if no selection exists.
 */
export function createQuickMaskFromSelection(
  selectionMask: Uint8ClampedArray | null,
  docWidth: number,
  docHeight: number,
): QuickMaskBuffer {
  const data = new Uint8ClampedArray(docWidth * docHeight);
  if (selectionMask) {
    const len = Math.min(selectionMask.length, data.length);
    for (let i = 0; i < len; i++) {
      data[i] = selectionMask[i]!;
    }
  }
  return { data, width: docWidth, height: docHeight };
}

/**
 * Convert the quick mask buffer back to a selection mask suitable for
 * `setSelection`. Values >= 128 are considered selected.
 */
export function quickMaskToSelectionMask(buf: QuickMaskBuffer): Uint8ClampedArray {
  const out = new Uint8ClampedArray(buf.data.length);
  for (let i = 0; i < buf.data.length; i++) {
    out[i] = buf.data[i]!;
  }
  return out;
}
