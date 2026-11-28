/**
 * The preview a file carries: RAF's embedded JPEG, a DNG's, ARW's, CR2's
 * or NEF's largest JPEG preview, or the file itself for JPEG, PNG and WebP.
 *
 * `EmbeddedPreview.orientation` is relative to a browser decode, which
 * applies the preview's own EXIF orientation (`<img>` and
 * `createImageBitmap`'s default 'from-image' both do). A RAF's JPEG carries
 * the camera's orientation tag, so nothing is left to apply; a DNG's or an
 * ARW's preview usually has no EXIF, so IFD0's orientation is left to
 * apply.
 */

import type { ImageFormat } from '../library/types';
import { readRafHeader, scanJpeg, scanPng, scanWebp } from './containers';
import { readExifAt, swapsAxes } from './exif';
import { normalizeOrientation, remainingOrientation } from './orientation';
import { findTiffPreview, jpegSliceIsDecodable, withinFile, type Slice } from './tiff-preview';
import type { EmbeddedPreview } from './types';

function sliceBlob(bytes: Uint8Array, slice: Slice, type: string): Blob {
  return new Blob([bytes.slice(slice.start, slice.end)], { type });
}

/** A JPEG preview held in `bytes[slice]`, with its own orientation accounted for. */
function jpegPreview(bytes: Uint8Array, slice: Slice, wanted: number, blob: Blob): EmbeddedPreview {
  const info = scanJpeg(bytes, slice.start, slice.end);
  const own = normalizeOrientation(readExifAt(bytes, info.exifBase).orientation);
  const swap = swapsAxes(own);
  return {
    blob,
    width: swap ? info.height : info.width,
    height: swap ? info.width : info.height,
    orientation: remainingOrientation(wanted, own),
  };
}

/**
 * The preview for a file of `format`. `orientation` is the photo's
 * orientation (from `readMetadata`). `source` is the file itself, used
 * instead of copying `bytes` when the preview is the whole file.
 */
export function extractPreview(
  bytes: Uint8Array,
  format: ImageFormat,
  orientation: number,
  source?: Blob,
): EmbeddedPreview | null {
  const wanted = normalizeOrientation(orientation);
  const whole = (type: string) => source ?? new Blob([bytes.slice()], { type });
  switch (format) {
    case 'jpeg':
      return jpegPreview(bytes, { start: 0, end: bytes.length }, wanted, whole('image/jpeg'));
    case 'png':
    case 'webp': {
      const info = format === 'png' ? scanPng(bytes) : scanWebp(bytes);
      const own = normalizeOrientation(readExifAt(bytes, info.exifBase).orientation);
      const swap = swapsAxes(own);
      return {
        blob: whole(format === 'png' ? 'image/png' : 'image/webp'),
        width: swap ? info.height : info.width,
        height: swap ? info.width : info.height,
        orientation: remainingOrientation(wanted, own),
      };
    }
    case 'raf': {
      const header = readRafHeader(bytes);
      if (!header) return null;
      const slice = withinFile(bytes, header.jpegOffset, header.jpegLength);
      if (!slice || !jpegSliceIsDecodable(bytes, slice)) return null;
      return jpegPreview(bytes, slice, wanted, sliceBlob(bytes, slice, 'image/jpeg'));
    }
    case 'dng':
    case 'arw':
    case 'cr2':
    case 'nef': {
      const slice = findTiffPreview(bytes);
      return slice ? jpegPreview(bytes, slice, wanted, sliceBlob(bytes, slice, 'image/jpeg')) : null;
    }
    case 'lopsy':
      return null;
  }
}
