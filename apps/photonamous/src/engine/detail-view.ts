/**
 * The Edit view's detail at 100 % (plan section 10): a photo larger than
 * the GPU can edit is shown from the held image, its largest size the GPU
 * holds, and once the view magnifies that image the part on screen is
 * shown from the photo's own pixels, as one tile on the screen engine
 * (`setScreenRegion`). Pure: where the view puts the photo at its own size,
 * what part of it shows, the tile that covers it, and the whole picture's
 * viewport the engine is sent.
 *
 * The view (viewport.ts) is in CSS pixels and held-image pixels: the
 * held document's centre sits at the canvas's centre plus `pan`, `zoom`
 * screen pixels to each held pixel. The same view shows the photo at its
 * own size with the same centre and pan, and `zoom · pixelScale` screen
 * pixels to each of its own (pixelScale = held over own, what the zoom
 * readout shows as the percentage), so 100 % is one device pixel to each
 * of the photo's own.
 */

import type { PixelRect } from './tile-plan';
import type { Size, View } from './viewport';

/** The viewport for the engine at the photo's own size, in device pixels: its zoom, and the pan of the whole crop's centre. */
export interface OwnViewport {
  readonly zoom: number;
  readonly panX: number;
  readonly panY: number;
}

/** A zoom this close to a whole number is that number: 100 % is exactly 1 however the readout's scale rounded. */
const WHOLE_ZOOM = 1e-6;

/** The view at the photo's own size, in device pixels. */
export function ownViewport(view: View, pixelRatio: number, pixelScale: number): OwnViewport {
  let zoom = view.zoom * pixelRatio * pixelScale;
  const whole = Math.round(zoom);
  if (whole >= 1 && Math.abs(zoom - whole) < WHOLE_ZOOM * whole) zoom = whole;
  return { zoom, panX: view.panX * pixelRatio, panY: view.panY * pixelRatio };
}

/** Whether the view magnifies the held image: more than one device pixel to each of its pixels. */
export function magnifiesHeld(view: View, pixelRatio: number): boolean {
  return view.zoom * pixelRatio > 1;
}

/**
 * The part of the document (`document`, the crop at the photo's own size)
 * that a `canvas` (device pixels) shows through `viewport`, in whole
 * pixels, rounded out; null when none of it shows. As final_blit.wgsl maps
 * a screen point `s`: `(s − canvas / 2 − pan) / zoom + document / 2`.
 */
export function visibleRect(viewport: OwnViewport, canvas: Size, document: Size): PixelRect | null {
  const toDoc = (s: number, canvasSide: number, pan: number, docSide: number) => (s - canvasSide / 2 - pan) / viewport.zoom + docSide / 2;
  const x0 = Math.max(0, Math.floor(toDoc(0, canvas.width, viewport.panX, document.width)));
  const y0 = Math.max(0, Math.floor(toDoc(0, canvas.height, viewport.panY, document.height)));
  const x1 = Math.min(document.width, Math.ceil(toDoc(canvas.width, canvas.width, viewport.panX, document.width)));
  const y1 = Math.min(document.height, Math.ceil(toDoc(canvas.height, canvas.height, viewport.panY, document.height)));
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Whether `inner` lies within `outer`. */
export function contains(outer: PixelRect, inner: PixelRect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}

/** The share of the visible size added on each side of it, so small pans stay inside what is loaded. */
export const KEPT_MARGIN = 0.25;

export interface DetailTile {
  /** What a view may show without a new tile: the visible part and a margin, on even pixels. */
  readonly kept: PixelRect;
  /** What is rendered: the kept part and the apron, within the document. */
  readonly rect: PixelRect;
}

/**
 * The tile for `visible`: the kept part a quarter of the visible size wider
 * on each side (so at most 2.25 times its area), on even pixels within the
 * document, shrunk as far as needed for the rectangle it renders (`apron`
 * more on each side, within the document) to fit (`fits`: the side limit,
 * the tile budget, a turned tile's window); null when even the visible
 * part with its apron does not.
 */
export function detailTile(
  visible: PixelRect,
  document: Size,
  apron: number,
  fits: (width: number, height: number) => boolean,
): DetailTile | null {
  const steps = 8;
  for (let step = steps; step >= 0; step--) {
    const share = (KEPT_MARGIN * step) / steps;
    const mx = Math.ceil(visible.width * share);
    const my = Math.ceil(visible.height * share);
    const kx0 = Math.max(0, Math.floor((visible.x - mx) / 2) * 2);
    const ky0 = Math.max(0, Math.floor((visible.y - my) / 2) * 2);
    const kx1 = Math.min(document.width, Math.ceil((visible.x + visible.width + mx) / 2) * 2);
    const ky1 = Math.min(document.height, Math.ceil((visible.y + visible.height + my) / 2) * 2);
    const x0 = Math.max(0, kx0 - apron);
    const y0 = Math.max(0, ky0 - apron);
    const x1 = Math.min(document.width, kx1 + apron);
    const y1 = Math.min(document.height, ky1 + apron);
    if (fits(x1 - x0, y1 - y0)) {
      return { kept: { x: kx0, y: ky0, width: kx1 - kx0, height: ky1 - ky0 }, rect: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } };
    }
  }
  return null;
}
