import type { ImageFormat } from '../library/types';
import { RAF_MAGIC, isPng, isWebp } from './containers';
import { TiffTag, findCfaImageIfd, getString, openTiff, readIfd } from './tiff';
import type { TiffFile, TiffIfd } from './tiff';

export const MIME_TYPES: Readonly<Record<ImageFormat, string>> = {
  raf: 'image/x-fuji-raf',
  dng: 'image/x-adobe-dng',
  arw: 'image/x-sony-arw',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  lopsy: 'application/x-lopsy',
};

/**
 * The MIME types a file that import reads may carry in someone's storage:
 * each format's own, and `application/octet-stream`, which is what a file
 * has when whatever put it there did not know its type. A file picker is
 * filtered to these; the magic bytes still decide what a picked file is.
 */
export const IMPORTABLE_MIME_TYPES: readonly string[] = [...new Set(Object.values(MIME_TYPES)), 'application/octet-stream'];

function startsWith(bytes: Uint8Array, text: string): boolean {
  if (bytes.length < text.length) return false;
  for (let i = 0; i < text.length; i++) if (bytes[i] !== text.charCodeAt(i)) return false;
  return true;
}

/**
 * A Sony RAW (ARW): a TIFF that is not a DNG (checked first), whose IFD0
 * Make is SONY, holding a full-resolution CFA image. The file's extension
 * plays no part. A JPEG from a Sony camera starts with a JPEG marker, and a
 * TIFF Sony software writes holds RGB, not CFA, so neither is one.
 */
function isSonyRaw(tiff: TiffFile, ifd0: TiffIfd): boolean {
  if (getString(tiff, ifd0, TiffTag.Make)?.toUpperCase() !== 'SONY') return false;
  return findCfaImageIfd(tiff) !== null;
}

/** Identifies a file from its magic bytes; null for anything import does not support. */
export function detectFormat(bytes: Uint8Array): ImageFormat | null {
  if (startsWith(bytes, RAF_MAGIC)) return 'raf';
  if (startsWith(bytes, 'LOPSY\0')) return 'lopsy';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (isPng(bytes)) return 'png';
  if (isWebp(bytes)) return 'webp';
  const tiff = openTiff(bytes);
  if (tiff) {
    const ifd0 = readIfd(tiff, tiff.firstIfd);
    if (ifd0?.entries.has(TiffTag.DngVersion)) return 'dng';
    if (ifd0 && isSonyRaw(tiff, ifd0)) return 'arw';
  }
  return null;
}
