/**
 * The browser PreviewRenderer: decode and downscale with createImageBitmap,
 * turn with an OffscreenCanvas transform, encode with convertToBlob. The
 * browser does the pixel work; this code only reads container headers.
 *
 * Orientation. createImageBitmap's default `imageOrientation: 'from-image'`
 * applies the source's own EXIF orientation, as `<img>` does; the older
 * 'none' value, which skipped it, is deprecated and not handled the same
 * way everywhere. So the source is decoded with its own orientation
 * applied, and the `orientation` argument is what is still left to apply
 * after that (`EmbeddedPreview.orientation` is defined the same way, see
 * preview.ts). A RAF's JPEG carries the camera's tag, so for it the
 * argument is 1 and the turn is never applied twice.
 */

import { scanJpeg, scanPng, scanWebp } from './containers';
import type { ContainerInfo } from './containers';
import { readExifAt, swapsAxes } from './exif';
import { normalizeOrientation } from './orientation';
import type { PreviewRenderer } from './types';

/** Enough for the APP segments before a JPEG's SOF, or a PNG/WebP header. */
const HEAD_BYTES = 1024 * 1024;

export interface BrowserPreviewRendererOptions {
  /** JPEG quality, 0 to 1. */
  readonly quality?: number;
}

interface Size {
  readonly width: number;
  readonly height: number;
}

/** The size the browser will decode `source` to, its own orientation applied; null when unknown. */
async function decodedSize(source: Blob): Promise<Size | null> {
  const head = new Uint8Array(await source.slice(0, HEAD_BYTES).arrayBuffer());
  let info: ContainerInfo;
  if (head[0] === 0xff && head[1] === 0xd8) info = scanJpeg(head);
  else if (head[0] === 0x89) info = scanPng(head);
  else info = scanWebp(head);
  if (info.width === null || info.height === null) return null;
  const own = normalizeOrientation(readExifAt(head, info.exifBase).orientation);
  return swapsAxes(own) ? { width: info.height, height: info.width } : { width: info.width, height: info.height };
}

function fit(size: Size, maxSize: number): Size {
  const scale = Math.min(1, maxSize / Math.max(size.width, size.height));
  return { width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) };
}

async function decode(source: Blob, maxSize: number): Promise<{ bitmap: ImageBitmap; size: Size }> {
  const known = await decodedSize(source);
  if (known === null) {
    const bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' });
    return { bitmap, size: fit({ width: bitmap.width, height: bitmap.height }, maxSize) };
  }
  const target = fit(known, maxSize);
  if (target.width === known.width && target.height === known.height) {
    return { bitmap: await createImageBitmap(source, { imageOrientation: 'from-image' }), size: target };
  }
  const options = (width: number, height: number): ImageBitmapOptions => ({
    imageOrientation: 'from-image',
    resizeWidth: width,
    resizeHeight: height,
    resizeQuality: 'high',
  });
  const bitmap = await createImageBitmap(source, options(target.width, target.height));
  if (bitmap.width === target.width && bitmap.height === target.height) return { bitmap, size: target };
  // Some engines resize before applying the EXIF turn, which swaps the axes: ask again the other way round.
  bitmap.close();
  const retry = await createImageBitmap(source, options(target.height, target.width));
  return { bitmap: retry, size: target };
}

/** The canvas transform drawing a w x h image so it shows turned by `orientation`. */
function orientationTransform(orientation: number, w: number, h: number): [number, number, number, number, number, number] {
  switch (orientation) {
    case 2:
      return [-1, 0, 0, 1, w, 0];
    case 3:
      return [-1, 0, 0, -1, w, h];
    case 4:
      return [1, 0, 0, -1, 0, h];
    case 5:
      return [0, 1, 1, 0, 0, 0];
    case 6:
      return [0, 1, -1, 0, h, 0];
    case 7:
      return [0, -1, -1, 0, h, w];
    case 8:
      return [0, -1, 1, 0, 0, w];
    default:
      return [1, 0, 0, 1, 0, 0];
  }
}

export function createBrowserPreviewRenderer(options: BrowserPreviewRendererOptions = {}): PreviewRenderer {
  const quality = options.quality ?? 0.85;
  return {
    async render(source, maxSize, orientation) {
      const { bitmap, size } = await decode(source, maxSize);
      try {
        const turn = normalizeOrientation(orientation);
        const swap = swapsAxes(turn);
        const width = swap ? size.height : size.width;
        const height = swap ? size.width : size.height;
        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('No 2D canvas context');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.setTransform(...orientationTransform(turn, size.width, size.height));
        ctx.drawImage(bitmap, 0, 0, size.width, size.height);
        const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
        return { blob, width, height };
      } finally {
        bitmap.close();
      }
    },
  };
}
