/**
 * The preview a file carries: RAF's embedded JPEG, a DNG's or an ARW's
 * largest JPEG preview, or the file itself for JPEG, PNG and WebP.
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
import { TiffTag, collectImageIfds, getNumber, getNumbers, openTiff } from './tiff';
import type { EmbeddedPreview } from './types';

/** Frame types a browser decodes: baseline, extended, progressive. DNG raw data is lossless (0xc3). */
const DECODABLE_FRAMES: ReadonlySet<number> = new Set([0xc0, 0xc1, 0xc2]);

interface Slice {
  readonly start: number;
  readonly end: number;
}

function jpegSliceIsDecodable(bytes: Uint8Array, slice: Slice): { width: number; height: number } | null {
  const info = scanJpeg(bytes, slice.start, slice.end);
  if (info.width === null || info.height === null || info.frameMarker === null) return null;
  if (!DECODABLE_FRAMES.has(info.frameMarker)) return null;
  return { width: info.width, height: info.height };
}

function withinFile(bytes: Uint8Array, start: number | null, length: number | null): Slice | null {
  if (start === null || length === null || start <= 0 || length < 4) return null;
  const end = start + length;
  return end <= bytes.length ? { start, end } : null;
}

/**
 * The largest browser-decodable JPEG among IFD0, its chain and its SubIFDs,
 * by JPEGInterchangeFormat or a single JPEG strip: a DNG's previews, and an
 * ARW's (IFD0 holds a 1616-wide one, IFD1 the thumbnail, IFD2 the
 * full-size one).
 */
export function findTiffPreview(bytes: Uint8Array): Slice | null {
  const tiff = openTiff(bytes);
  if (!tiff) return null;
  let best: { slice: Slice; pixels: number } | null = null;
  const consider = (slice: Slice | null) => {
    if (!slice) return;
    const size = jpegSliceIsDecodable(bytes, slice);
    if (!size) return;
    const pixels = size.width * size.height;
    if (!best || pixels > best.pixels) best = { slice, pixels };
  };
  for (const ifd of collectImageIfds(tiff)) {
    const jif = getNumber(tiff, ifd, TiffTag.JpegInterchangeFormat);
    const jifLength = getNumber(tiff, ifd, TiffTag.JpegInterchangeFormatLength);
    consider(withinFile(bytes, jif === null ? null : tiff.base + jif, jifLength));

    const compression = getNumber(tiff, ifd, TiffTag.Compression);
    if (compression !== 6 && compression !== 7) continue;
    const offsets = getNumbers(tiff, ifd, TiffTag.StripOffsets);
    const counts = getNumbers(tiff, ifd, TiffTag.StripByteCounts);
    if (offsets?.length !== 1 || counts?.length !== 1) continue;
    const [offset] = offsets;
    const [count] = counts;
    if (offset === undefined || count === undefined) continue;
    consider(withinFile(bytes, tiff.base + offset, count));
  }
  return best === null ? null : (best as { slice: Slice }).slice;
}

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
    case 'arw': {
      const slice = findTiffPreview(bytes);
      return slice ? jpegPreview(bytes, slice, wanted, sliceBlob(bytes, slice, 'image/jpeg')) : null;
    }
    case 'lopsy':
      return null;
  }
}
