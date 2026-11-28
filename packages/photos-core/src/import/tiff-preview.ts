/**
 * The JPEGs a TIFF-based RAW file embeds (DNG, ARW, CR2, NEF): where the
 * largest one a browser decodes is, for the preview and for the size of
 * the camera's own picture.
 */

import { scanJpeg } from './containers';
import { TiffTag, collectImageIfds, getNumber, getNumbers, openTiff } from './tiff';

/** Frame types a browser decodes: baseline, extended, progressive. DNG raw data is lossless (0xc3). */
const DECODABLE_FRAMES: ReadonlySet<number> = new Set([0xc0, 0xc1, 0xc2]);

export interface Slice {
  readonly start: number;
  readonly end: number;
}

export function jpegSliceIsDecodable(bytes: Uint8Array, slice: Slice): { width: number; height: number } | null {
  const info = scanJpeg(bytes, slice.start, slice.end);
  if (info.width === null || info.height === null || info.frameMarker === null) return null;
  if (!DECODABLE_FRAMES.has(info.frameMarker)) return null;
  return { width: info.width, height: info.height };
}

export function withinFile(bytes: Uint8Array, start: number | null, length: number | null): Slice | null {
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
