import type { ImageFormat } from '../library/types';
import { RAF_MAGIC, isPng, isWebp } from './containers';
import { TiffTag, findCfaImageIfd, getString, openTiff, readIfd } from './tiff';
import type { TiffFile, TiffIfd } from './tiff';

export const MIME_TYPES: Readonly<Record<ImageFormat, string>> = {
  raf: 'image/x-fuji-raf',
  dng: 'image/x-adobe-dng',
  arw: 'image/x-sony-arw',
  cr2: 'image/x-canon-cr2',
  nef: 'image/x-nikon-nef',
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

/** The one camera that wrote Sony's older SR2 format, which the engine does not decode. */
const SR2_MODEL = 'DSC-R1';

/**
 * A Sony RAW (ARW): a TIFF that is not a DNG (checked first), whose IFD0
 * Make is SONY, holding a full-resolution CFA image. The file's extension
 * plays no part. A JPEG from a Sony camera starts with a JPEG marker, and a
 * TIFF Sony software writes holds RGB, not CFA, so neither is one. An SR2
 * (IFD0 Model exactly DSC-R1) looks the same but is not one; an SRF holds
 * no CFA image in a TIFF IFD, so it never matches.
 */
function isSonyRaw(tiff: TiffFile, ifd0: TiffIfd): boolean {
  if (getString(tiff, ifd0, TiffTag.Make)?.toUpperCase() !== 'SONY') return false;
  if (getString(tiff, ifd0, TiffTag.Model) === SR2_MODEL) return false;
  return findCfaImageIfd(tiff) !== null;
}

/**
 * A Canon CR2: a little-endian TIFF header followed by "CR" and the major
 * version 2 (bytes 8 to 10). A CR3 is not a TIFF (an ISO media file with
 * the brand "crx "), and its codec is not decoded, so it is not one. A
 * reduced-size sRAW or mRAW is one: the engine says why it cannot open it
 * when it is opened.
 */
function isCanonCr2(bytes: Uint8Array): boolean {
  return bytes.length >= 16 && startsWith(bytes, 'II*\0') && bytes[8] === 0x43 && bytes[9] === 0x52 && bytes[10] === 2;
}

/**
 * A Nikon RAW (NEF): a TIFF that is not a DNG (checked first) whose IFD0
 * Make starts with NIKON, holding a full-resolution CFA image (so a TIFF
 * Nikon software writes, which holds RGB, is not one). The NRW of a
 * COOLPIX compact (IFD0 Model starting COOLPIX) looks the same but is not
 * one: the engine does not decode it. A compressed NEF is one: import
 * cannot tell it from an uncompressed one, and the engine says why it
 * cannot open it when it is opened.
 */
function isNikonRaw(tiff: TiffFile, ifd0: TiffIfd): boolean {
  if (!(getString(tiff, ifd0, TiffTag.Make)?.toUpperCase().startsWith('NIKON') ?? false)) return false;
  if (getString(tiff, ifd0, TiffTag.Model)?.toUpperCase().startsWith('COOLPIX') ?? false) return false;
  return findCfaImageIfd(tiff) !== null;
}

/** Identifies a file from its magic bytes; null for anything import does not support. */
export function detectFormat(bytes: Uint8Array): ImageFormat | null {
  if (startsWith(bytes, RAF_MAGIC)) return 'raf';
  if (startsWith(bytes, 'LOPSY\0')) return 'lopsy';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (isPng(bytes)) return 'png';
  if (isWebp(bytes)) return 'webp';
  if (isCanonCr2(bytes)) return 'cr2';
  const tiff = openTiff(bytes);
  if (tiff) {
    const ifd0 = readIfd(tiff, tiff.firstIfd);
    if (ifd0?.entries.has(TiffTag.DngVersion)) return 'dng';
    if (ifd0 && isNikonRaw(tiff, ifd0)) return 'nef';
    if (ifd0 && isSonyRaw(tiff, ifd0)) return 'arw';
  }
  return null;
}
