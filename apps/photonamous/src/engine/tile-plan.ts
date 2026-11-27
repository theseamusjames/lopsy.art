/**
 * Tiles: how a photo larger than the GPU's textures is exported at its own
 * size one rectangle at a time (the engine's `setDocumentRegion`, plan
 * section 10). Pure.
 *
 * The document is the crop at the photo's own size. It is cut into kept
 * parts, on even coordinates (the HDR gain map is made of 2 × 2 blocks),
 * that partition it. Each tile renders its kept part with the apron around
 * it (`developApron`: the pixels within which a neighbourhood stage reads
 * across a tile's edge), clipped to the document, so the kept parts are
 * what one render of the whole would give there.
 *
 * Each tile's rectangle must fit the GPU: no larger than the editable
 * limit on either side, and no larger in area than the size the device
 * has already loaded the photo at (the held image), so a tile asks no
 * more memory of each texture than the held image did. A straightened
 * photo's tile is made from the part of the framed image it is turned
 * from, a larger rectangle, which must fit the limit too.
 *
 * Every tile but the last in a row (or column) is the same size, so the
 * engine's texture pool, which keeps two free textures of each size it has
 * seen, keeps few sizes.
 */

import type { Framing } from './recipe-to-adjustments';
import type { Size } from './viewport';

/** A rectangle in whole pixels. */
export interface PixelRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** One tile: the part kept, and the document rendered for it (the kept part and the apron, within the document). */
export interface Tile {
  readonly kept: PixelRect;
  readonly rect: PixelRect;
}

export interface TilePlan {
  readonly tiles: readonly Tile[];
  readonly columns: number;
  readonly rows: number;
  /** The apron used: the engine's, rounded up to even. */
  readonly apron: number;
  /** Pixels rendered over the document's pixels. */
  readonly overdraw: number;
}

export interface TilePlanInput {
  /** The document: the crop at the photo's own size. */
  readonly document: Size;
  /** The longest side a tile, or the window a turned tile is made from, may have (`editableLimit`). */
  readonly limit: number;
  /** The most pixels a tile may have: the held image's. */
  readonly maxTilePixels: number;
  /** `developApron` for the export's settings at the photo's own size. */
  readonly apron: number;
  /** The straighten angle in degrees; 0 when the photo is not turned. */
  readonly angle: number;
}

/**
 * The most pixels a plan may render for each pixel of the document. Past
 * it the apron is most of each tile, and the export would take several
 * times as long as a whole render: four keeps the work within what an
 * export of a photo four times the size of the held image would take, and
 * is met by every apron up to a quarter of the limit. A plan needing more
 * is no plan: the export is made at the held size.
 */
export const MAX_OVERDRAW = 4;

/** The most tiles a plan may have, whatever their size. */
export const MAX_TILES = 256;

/**
 * The pixels added to each side of the window a turned tile is made from:
 * the engine's affine transform treats the window's edge as the picture's,
 * so a bilinear read near it must still find real pixels (one), and the
 * bounds are rounded out (one more).
 */
export const WINDOW_MARGIN = 2;

function even(n: number): number {
  return Math.ceil(n / 2) * 2;
}

/** The size of the window a `width`×`height` tile turned by `angle` is made from, before it is clipped to the framed image. */
export function turnedWindowSize(width: number, height: number, angle: number): Size {
  if (angle === 0) return { width, height };
  const t = (Math.abs(angle) * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  // The bounding box of the turned rectangle, rounded out on both ends, and the margin on each side.
  return {
    width: Math.ceil(width * c + height * s) + 2 + 2 * WINDOW_MARGIN,
    height: Math.ceil(width * s + height * c) + 2 + 2 * WINDOW_MARGIN,
  };
}

/**
 * The kept parts' edges on one axis of `length` pixels in `count` parts,
 * with every tile `side` long but the last: tile i renders
 * `[edges[i] − apron, edges[i + 1] + apron)` within the axis. Null when the
 * last part would be empty.
 */
function axisEdges(length: number, count: number, side: number, apron: number): number[] | null {
  if (count === 1) return [0, length];
  const step = side - 2 * apron;
  const edges = [0];
  for (let i = 1; i < count; i++) edges.push(side - apron + (i - 1) * step);
  edges.push(length);
  for (let i = 1; i < edges.length; i++) if ((edges[i] ?? 0) <= (edges[i - 1] ?? 0)) return null;
  return edges;
}

/** The tile side on an axis of `length` in `count` parts, and its kept parts' edges; null when no such split exists. */
function splitAxis(length: number, count: number, apron: number): { side: number; edges: number[] } | null {
  if (count === 1) return { side: length, edges: [0, length] };
  // Every tile `side` long but the last, which is no longer: count · side − 2 · apron · (count − 1) ≥ length.
  const side = even((length + 2 * apron * (count - 1)) / count);
  if (side - 2 * apron < 2 || side >= length) return null;
  const edges = axisEdges(length, count, side, apron);
  return edges ? { side, edges } : null;
}

/** The tiles of one split, with every rectangle clipped to the document. */
function tilesOf(document: Size, xs: readonly number[], ys: readonly number[], apron: number): Tile[] {
  const tiles: Tile[] = [];
  for (let row = 0; row + 1 < ys.length; row++) {
    for (let col = 0; col + 1 < xs.length; col++) {
      const kx0 = xs[col] ?? 0;
      const kx1 = xs[col + 1] ?? 0;
      const ky0 = ys[row] ?? 0;
      const ky1 = ys[row + 1] ?? 0;
      const x0 = Math.max(0, kx0 - apron);
      const y0 = Math.max(0, ky0 - apron);
      const x1 = Math.min(document.width, kx1 + apron);
      const y1 = Math.min(document.height, ky1 + apron);
      tiles.push({
        kept: { x: kx0, y: ky0, width: kx1 - kx0, height: ky1 - ky0 },
        rect: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
      });
    }
  }
  return tiles;
}

/**
 * Whether a tile `width`×`height` fits: no side over `limit`, no more than
 * `maxTilePixels`, and turned by `angle` the window it is made from within
 * the limit too.
 */
export function tileFits(width: number, height: number, limit: number, maxTilePixels: number, angle: number): boolean {
  if (width > limit || height > limit || width * height > maxTilePixels) return false;
  const window = turnedWindowSize(width, height, angle);
  return window.width <= limit && window.height <= limit;
}

/**
 * The fewest tiles that make the document within the limits, and of those
 * the plan that renders the fewest pixels: one, the document itself, when
 * it fits as it is. Null when no plan is workable (`MAX_OVERDRAW`,
 * `MAX_TILES`).
 */
export function planTiles(input: TilePlanInput): TilePlan | null {
  const { document, limit, maxTilePixels, angle } = input;
  if (document.width <= 0 || document.height <= 0 || limit <= 0) return null;
  const apron = even(Math.max(0, input.apron));
  const fits = (w: number, h: number) => tileFits(w, h, limit, maxTilePixels, angle);
  const docPixels = document.width * document.height;
  // One tile, the document itself: a crop that fits though the photo does not (a straightened one, a small crop).
  if (fits(document.width, document.height)) {
    const whole = { x: 0, y: 0, width: document.width, height: document.height };
    return { tiles: [{ kept: whole, rect: whole }], columns: 1, rows: 1, apron, overdraw: 1 };
  }
  let best: TilePlan | null = null;
  const maxPerAxis = Math.min(MAX_TILES, Math.ceil(Math.max(document.width, document.height) / 2));
  for (let count = 2; count <= MAX_TILES; count++) {
    for (let columns = 1; columns <= Math.min(count, maxPerAxis); columns++) {
      if (count % columns !== 0) continue;
      const rows = count / columns;
      const x = splitAxis(document.width, columns, apron);
      const y = splitAxis(document.height, rows, apron);
      if (!x || !y || !fits(x.side, y.side)) continue;
      const tiles = tilesOf(document, x.edges, y.edges, apron);
      const rendered = tiles.reduce((sum, t) => sum + t.rect.width * t.rect.height, 0);
      const overdraw = rendered / docPixels;
      if (overdraw > MAX_OVERDRAW) continue;
      if (!best || overdraw < best.overdraw) best = { tiles, columns, rows, apron, overdraw };
    }
    if (best) return best;
  }
  return null;
}

/** The number of different tile sizes a plan has. */
export function tileSizeCount(plan: TilePlan): number {
  return new Set(plan.tiles.map((t) => `${t.rect.width}x${t.rect.height}`)).size;
}

// ---- where a tile's pixels come from ---------------------------------------

/**
 * A rectangle of the framed image (after Rotate and Flip) back in the
 * oriented image it is framed from, `source` its size: the inverse of
 * turning clockwise by `framing.rotate` and then mirroring.
 */
export function unframeRect(rect: PixelRect, framing: Framing, source: Size): PixelRect {
  const framed = framing.rotate === 90 || framing.rotate === 270 ? { width: source.height, height: source.width } : source;
  let r = framing.flipH ? { ...rect, x: framed.width - rect.x - rect.width } : rect;
  let size: Size = framed;
  // Each quarter turn back (anticlockwise) of a rectangle in an image of `size`.
  for (let turns = framing.rotate / 90; turns > 0; turns--) {
    r = { x: r.y, y: size.width - r.x - r.width, width: r.height, height: r.width };
    size = { width: size.height, height: size.width };
  }
  return r;
}

/** `rect` of the oriented image framed: turned clockwise by `framing.rotate`, then mirrored. The inverse of `unframeRect`. */
export function frameRect(rect: PixelRect, framing: Framing, source: Size): PixelRect {
  let r = rect;
  let size: Size = source;
  for (let turns = framing.rotate / 90; turns > 0; turns--) {
    r = { x: size.height - r.y - r.height, y: r.x, width: r.height, height: r.width };
    size = { width: size.height, height: size.width };
  }
  return framing.flipH ? { ...r, x: size.width - r.x - r.width } : r;
}

/**
 * The window of the framed image (`framed` its size) that `rect`, in
 * framed pixels, is turned from by straighten's `angle` about the framed
 * image's centre (develop-engine.ts `applyAngle`): the bounding box of its
 * corners mapped back, rounded out, `WINDOW_MARGIN` more on each side, and
 * clipped to the framed image. The engine maps a destination point `d` to
 * `M · (d − c) + c` with `M` the inverse rotation (crop.ts
 * `inverseRotation`, which this repeats).
 */
export function turnedWindow(rect: PixelRect, angle: number, framed: Size): PixelRect {
  if (angle === 0) return rect;
  const t = (angle * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const cx = framed.width / 2;
  const cy = framed.height / 2;
  const corners = [
    [rect.x, rect.y],
    [rect.x + rect.width, rect.y],
    [rect.x, rect.y + rect.height],
    [rect.x + rect.width, rect.y + rect.height],
  ].map(([x = 0, y = 0]) => [c * (x - cx) + s * (y - cy) + cx, -s * (x - cx) + c * (y - cy) + cy] as const);
  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)) - WINDOW_MARGIN);
  const y0 = Math.max(0, Math.floor(Math.min(...ys)) - WINDOW_MARGIN);
  const x1 = Math.min(framed.width, Math.ceil(Math.max(...xs)) + WINDOW_MARGIN);
  const y1 = Math.min(framed.height, Math.ceil(Math.max(...ys)) + WINDOW_MARGIN);
  return { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) };
}
