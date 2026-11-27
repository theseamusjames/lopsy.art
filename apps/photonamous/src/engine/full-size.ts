/**
 * The full size of a photo on this device: the largest size its GPU can
 * hold, and what loading it taught. A develop engine loads a photo's full
 * size into one layer texture, and the document, its crop and every
 * texture of the develop chain are that size or smaller: the document is
 * the crop of the framed image, and straighten keeps its turned layer
 * within the framed image when the turned bounds would not fit
 * (develop-engine.ts `applyAngle`). The one texture larger than the image
 * is the copy straighten turns, which the engine's layer transform lifts
 * with a transparent pixel on each side (`begin_layer_transform`): so the
 * full size fits when its long edge is at most the GPU's largest texture
 * side less `TRANSFORM_BORDER`.
 *
 * A load can still fail for memory, which no limit tells. A failed full
 * size is tried again smaller, at `STEP_DOWN` of the largest held size, and
 * what happened is remembered for the photo: once a size loaded, or every
 * size failed, nothing is asked for again until another photo loads.
 *
 * The same limit decides whether a photo needs tiles (`isTooLarge`): only a
 * photo whose own long edge is larger than the GPU can edit is exported at
 * its own size a tile at a time (tile-plan.ts), each tile no larger than
 * the image that loaded. A photo that fits but failed to load for memory
 * steps down and is never tiled.
 */

import { limitSize, type Size } from './viewport';

/**
 * The retries after the first full-size load fails, as fractions of its
 * long edge: three quarters (about half the memory) and then half (a
 * quarter of it). Each try decodes the whole file again, so two retries
 * keep a failing photo to about three decodes; a size no larger than what
 * is already shown is never tried.
 */
export const STEP_DOWN: readonly number[] = [0.75, 0.5];

/** The pixels straighten's layer transform adds to each side of the image it turns: one on each edge. */
export const TRANSFORM_BORDER = 2;

/** The longest side of an image a GPU whose largest texture side is `textureLimit` can edit, straighten included. */
export function editableLimit(textureLimit: number): number {
  return Math.max(1, textureLimit - TRANSFORM_BORDER);
}

/** The largest size within `limit` on each side with `own`'s aspect: `own` itself when it fits. */
export function heldSize(own: Size, limit: number): Size {
  return limitSize(own, limit);
}

function longEdge(size: Size): number {
  return Math.max(size.width, size.height);
}

/**
 * Why a photo is shown below its own size for the device's sake:
 * 'too-large', its own size is larger than the GPU's textures and it is at
 * the largest they hold; 'stepped-down', a larger load failed and a smaller
 * one loaded; 'failed', no full size loaded and the working image stays.
 */
export type FullSizeOutcome = 'too-large' | 'stepped-down' | 'failed';

/** What the person is told when a photo is shown below its own size for the device's sake. */
export interface FullSizeNote {
  readonly kind: FullSizeOutcome;
  /** The photo's own size, framed. */
  readonly own: Size;
  /** The size it is shown and exported at, framed. */
  readonly shown: Size;
  /** The longest side this device can edit (`editableLimit`). */
  readonly limit: number;
  /**
   * 'own': exports larger than `shown` are made at the photo's own size, in
   * tiles; 'shown': they are made at `shown` (a source tiles cannot read, a
   * GPU without float targets, or a full size that failed for memory);
   * 'settings': tiles could be made, but not with the edit's settings.
   */
  readonly exports: 'own' | 'shown' | 'settings';
  /** With 'own': the view shows the part on screen at the photo's own size once zoomed in (detail-view.ts). */
  readonly detail?: boolean;
}

const times = (size: Size) => `${size.width} × ${size.height}`;

/** The sentence for `note`, shown in the Edit view and announced once. */
export function fullSizeNoteText(note: FullSizeNote): string {
  if (note.kind === 'failed') {
    return `This device could not load this photo at its full size of ${times(note.own)} pixels, so it is shown and exported at ${times(note.shown)}.`;
  }
  if (note.kind === 'stepped-down') {
    return `This device ran short of graphics memory for this ${times(note.own)} photo, so it is shown and exported at ${times(note.shown)}.`;
  }
  const larger = `This photo is ${times(note.own)} pixels, larger than this device’s graphics can edit (${note.limit} on a side), `;
  if (note.exports === 'own' && note.detail) {
    return (
      `${larger}so it is shown at ${times(note.shown)}; zoomed in, the part on screen is shown at its full size. ` +
      'It is exported at its full size, a part at a time.'
    );
  }
  if (note.exports === 'own') return `${larger}so it is shown at ${times(note.shown)}. It is exported at its full size, a part at a time.`;
  if (note.exports === 'settings') {
    return `${larger}so it is shown at ${times(note.shown)}. With these settings it cannot be exported a part at a time, so it is exported at ${times(note.shown)} too.`;
  }
  return `${larger}so it is shown and exported at ${times(note.shown)}.`;
}

/** The full size of one photo on one engine: what to try, and what happened. */
export class FullSizeLoads {
  /** The longest side the photo may be loaded at (`editableLimit`). */
  readonly limit: number;
  private own: Size | null = null;
  /** Every long edge at or above this failed. */
  private failedAt = Infinity;
  private loaded: Size | null = null;
  private hasGivenUp = false;

  /** `textureLimit`: the GPU's largest texture side (`maxTextureSize`). */
  constructor(textureLimit: number) {
    this.limit = editableLimit(textureLimit);
  }

  /** A new photo, of oriented size `own` (null until it is known): nothing about the last one is kept. */
  reset(own: Size | null): void {
    this.own = own;
    this.failedAt = Infinity;
    this.loaded = null;
    this.hasGivenUp = false;
  }

  /** The photo's own size, once known; the attempts so far are kept. */
  setOwn(own: Size): void {
    this.own = own;
  }

  /** The largest size the device holds for the photo; null before its size is known. */
  best(): Size | null {
    return this.own ? heldSize(this.own, this.limit) : null;
  }

  /**
   * The sizes still worth loading, largest first: the best held size, then
   * the steps down, each smaller than every size that failed and larger
   * than `shownLongEdge`, what is already shown. None once one loaded or
   * the load gave up.
   */
  attempts(shownLongEdge: number): Size[] {
    const best = this.best();
    if (!best || !this.own || this.isSettled()) return [];
    const bestEdge = longEdge(best);
    const edges = [bestEdge, ...STEP_DOWN.map((f) => Math.round(bestEdge * f))];
    const sizes: Size[] = [];
    for (const edge of edges) {
      if (edge >= this.failedAt || edge <= shownLongEdge) continue;
      const size = heldSize(this.own, edge);
      if (!sizes.some((s) => s.width === size.width && s.height === size.height)) sizes.push(size);
    }
    return sizes;
  }

  noteLoaded(size: Size): void {
    this.loaded = size;
  }

  noteFailed(size: Size): void {
    this.failedAt = Math.min(this.failedAt, longEdge(size));
  }

  /** No size could be loaded: the working image stays. */
  noteGaveUp(): void {
    this.hasGivenUp = true;
  }

  /** A full size loaded, or every one failed: nothing more is asked for for this photo. */
  isSettled(): boolean {
    return this.loaded !== null || this.hasGivenUp;
  }

  /** The size loaded, when one did. */
  loadedSize(): Size | null {
    return this.loaded;
  }

  /** Whether the photo's own long edge is larger than this device can edit: the one threshold for tiles. */
  isTooLarge(): boolean {
    return this.own !== null && longEdge(this.own) > this.limit;
  }

  /**
   * The most pixels a tile of the photo may have: the image that loaded,
   * which the device has shown it can hold. Null unless the photo is too
   * large and a size loaded (a photo whose every load failed is not tiled).
   */
  tileBudget(): number | null {
    if (!this.isTooLarge() || !this.loaded) return null;
    return this.loaded.width * this.loaded.height;
  }

  /** Why the photo is below its own size once settled; null when it is not (or nothing is settled yet). */
  outcome(): FullSizeOutcome | null {
    if (this.hasGivenUp) return 'failed';
    const best = this.best();
    if (!this.loaded || !this.own || !best) return null;
    if (longEdge(this.loaded) < longEdge(best)) return 'stepped-down';
    return longEdge(best) < longEdge(this.own) ? 'too-large' : null;
  }
}
