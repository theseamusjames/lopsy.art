/** The words of the status bar's left group. Pure. */

import type { EditSizes } from '../../app/store';

/** A count with its noun, grouped by thousands: "1,234 photos". */
export function countWords(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

/** "6240 × 4160 px". */
export function sizeWords(size: { readonly width: number; readonly height: number }): string {
  return `${size.width} × ${size.height} px`;
}

/** Whether the photo is edited at a smaller size than it is (spec 6.10's working image). */
export function isReduced(sizes: EditSizes): boolean {
  return sizes.working.width !== sizes.photo.width || sizes.working.height !== sizes.photo.height;
}
