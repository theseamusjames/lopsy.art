import type { Rect } from '../../types';

/**
 * Live marquee drag preview. While a marquee is being drawn or moved we do
 * NOT build a full-resolution selection mask or upload it to the GPU on every
 * pointer move — on a large canvas that floods the WASM bridge (a multi-MB
 * RGBA texture per event) and collapses to <1fps. Instead the strategy stores
 * a tiny analytic description here and the overlay renderer draws the marching
 * ants from geometry. The real mask is materialised once, on pointer up.
 *
 * Kept outside the Zustand stores on purpose: mutating it must not trip the
 * render loop's dirty flag (which would force a full GPU recomposite). The
 * overlay-only animation path in the rAF loop picks it up each frame.
 */
export type MarqueePreview =
  | { readonly kind: 'rect' | 'ellipse'; readonly rect: Rect }
  | { readonly kind: 'move'; readonly dx: number; readonly dy: number };

let preview: MarqueePreview | null = null;

export function setMarqueePreview(next: MarqueePreview | null): void {
  preview = next;
}

export function getMarqueePreview(): MarqueePreview | null {
  return preview;
}
