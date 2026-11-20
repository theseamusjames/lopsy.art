/**
 * The Edit view's zoom and pan, in CSS pixels. The engine's viewport puts
 * the image's centre at the view's centre plus `pan` (final_blit.wgsl), so
 * pan 0 is a centred image.
 */

export interface View {
  /** Screen pixels per image pixel. */
  readonly zoom: number;
  readonly panX: number;
  readonly panY: number;
  /** Whether the view follows the window: refit on resize. */
  readonly isFit: boolean;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export const MIN_ZOOM = 0.01;
export const MAX_ZOOM = 32;
/** Space kept around a fitted image, in CSS pixels. */
export const FIT_PADDING = 24;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** Room a fitted image leaves clear at the view's edges, in CSS pixels, besides FIT_PADDING: Crop's options take the bottom. */
export interface Insets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/** Insets that leave the image less than half the view either way are not kept: a short window keeps its photo. */
function usableInsets(view: Size, insets: Insets): Insets {
  const width = view.width - insets.left - insets.right;
  const height = view.height - insets.top - insets.bottom;
  return width >= view.width / 2 && height >= view.height / 2 ? insets : NO_INSETS;
}

/** The zoom that shows the whole image in the view less `insets`, never enlarging it. */
export function fitZoom(image: Size, view: Size, padding = FIT_PADDING, insets: Insets = NO_INSETS): number {
  const room = usableInsets(view, insets);
  const width = view.width - room.left - room.right;
  const height = view.height - room.top - room.bottom;
  if (image.width <= 0 || image.height <= 0 || width <= 0 || height <= 0) return 1;
  const pad = Math.min(padding, width / 4, height / 4);
  const zoom = Math.min((width - pad * 2) / image.width, (height - pad * 2) / image.height, 1);
  return clampZoom(zoom);
}

/** The whole image, centred in the room `insets` leave. */
export function fitView(image: Size, view: Size, insets: Insets = NO_INSETS): View {
  const room = usableInsets(view, insets);
  return { zoom: fitZoom(image, view, FIT_PADDING, room), panX: (room.left - room.right) / 2, panY: (room.top - room.bottom) / 2, isFit: true };
}

/**
 * Zoom to `zoom`, keeping the image point under `anchor` (CSS pixels from
 * the view's top-left; the view's centre when omitted) where it is.
 */
export function zoomAround(current: View, zoom: number, view: Size, anchor?: { x: number; y: number }): View {
  const next = clampZoom(zoom);
  const ax = (anchor?.x ?? view.width / 2) - view.width / 2;
  const ay = (anchor?.y ?? view.height / 2) - view.height / 2;
  const scale = next / current.zoom;
  return {
    zoom: next,
    panX: ax - (ax - current.panX) * scale,
    panY: ay - (ay - current.panY) * scale,
    isFit: false,
  };
}

/** Keeps at least part of the image on screen. */
export function clampPan(current: View, image: Size, view: Size): View {
  const limitX = (image.width * current.zoom + view.width) / 2 - 32;
  const limitY = (image.height * current.zoom + view.height) / 2 - 32;
  const clamp = (v: number, limit: number) => Math.min(Math.max(v, -Math.max(0, limit)), Math.max(0, limit));
  return { ...current, panX: clamp(current.panX, limitX), panY: clamp(current.panY, limitY) };
}

export function panBy(current: View, dx: number, dy: number, image: Size, view: Size): View {
  return clampPan({ ...current, panX: current.panX + dx, panY: current.panY + dy, isFit: false }, image, view);
}

/** Size of an image scaled so its long edge is at most `maxSize`, never enlarged. */
export function limitSize(image: Size, maxSize: number | undefined): Size {
  if (!maxSize || maxSize <= 0) return image;
  const long = Math.max(image.width, image.height);
  if (long <= maxSize) return image;
  const scale = maxSize / long;
  return {
    width: Math.max(1, Math.round(image.width * scale)),
    height: Math.max(1, Math.round(image.height * scale)),
  };
}
