/**
 * Container structure of the formats import reads: where the EXIF TIFF
 * block is and what size the image is. Bounds-checked; malformed input
 * gives nulls, never an exception.
 */

export interface ContainerInfo {
  /** Absolute offset of the EXIF TIFF header, when the container has one. */
  readonly exifBase: number | null;
  /** Stored (unoriented) pixel size, when the container says. */
  readonly width: number | null;
  readonly height: number | null;
  /** JPEG only: the SOF marker (0xc0 baseline, 0xc2 progressive, 0xc3 lossless...). */
  readonly frameMarker: number | null;
}

const EMPTY: ContainerInfo = { exifBase: null, width: null, height: null, frameMarker: null };

function u16be(b: Uint8Array, at: number): number {
  return ((b[at] ?? 0) << 8) | (b[at + 1] ?? 0);
}

function u16le(b: Uint8Array, at: number): number {
  return (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8);
}

export function u32be(b: Uint8Array, at: number): number {
  return (((b[at] ?? 0) << 24) | ((b[at + 1] ?? 0) << 16) | ((b[at + 2] ?? 0) << 8) | (b[at + 3] ?? 0)) >>> 0;
}

function u32le(b: Uint8Array, at: number): number {
  return ((b[at] ?? 0) | ((b[at + 1] ?? 0) << 8) | ((b[at + 2] ?? 0) << 16) | ((b[at + 3] ?? 0) << 24)) >>> 0;
}

function ascii(b: Uint8Array, at: number, length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) s += String.fromCharCode(b[at + i] ?? 0);
  return s;
}

function startsWithTiff(b: Uint8Array, at: number): boolean {
  const s = ascii(b, at, 4);
  return s === 'II*\0' || s === 'MM\0*';
}

function isSof(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

/**
 * Walks a JPEG's marker segments in `[start, end)` up to the first scan:
 * the APP1 EXIF block and the SOF frame size.
 */
export function scanJpeg(bytes: Uint8Array, start = 0, end = bytes.length): ContainerInfo {
  const limit = Math.min(end, bytes.length);
  if (start + 4 > limit || bytes[start] !== 0xff || bytes[start + 1] !== 0xd8) return EMPTY;
  let exifBase: number | null = null;
  let width: number | null = null;
  let height: number | null = null;
  let frameMarker: number | null = null;
  let p = start + 2;
  while (p + 4 <= limit) {
    if (bytes[p] !== 0xff) break;
    const marker = bytes[p + 1] ?? 0;
    if (marker === 0xff) {
      p += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      p += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break;
    const length = u16be(bytes, p + 2);
    if (length < 2 || p + 2 + length > limit) break;
    const data = p + 4;
    if (marker === 0xe1 && exifBase === null && length >= 14 && ascii(bytes, data, 6) === 'Exif\0\0') {
      if (startsWithTiff(bytes, data + 6)) exifBase = data + 6;
    } else if (isSof(marker) && width === null && length >= 7) {
      const h = u16be(bytes, data + 1);
      const w = u16be(bytes, data + 3);
      if (w > 0 && h > 0) {
        width = w;
        height = h;
        frameMarker = marker;
      }
    }
    p += 2 + length;
  }
  return { exifBase, width, height, frameMarker };
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function isPng(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((v, i) => bytes[i] === v);
}

/** PNG: IHDR size and the eXIf chunk. */
export function scanPng(bytes: Uint8Array): ContainerInfo {
  if (!isPng(bytes)) return EMPTY;
  let exifBase: number | null = null;
  let width: number | null = null;
  let height: number | null = null;
  let p = 8;
  while (p + 8 <= bytes.length) {
    const length = u32be(bytes, p);
    const type = ascii(bytes, p + 4, 4);
    const data = p + 8;
    if (data + length > bytes.length) break;
    if (type === 'IHDR' && length >= 8) {
      width = u32be(bytes, data) || null;
      height = u32be(bytes, data + 4) || null;
    } else if (type === 'eXIf' && exifBase === null) {
      if (startsWithTiff(bytes, data)) exifBase = data;
      else if (ascii(bytes, data, 6) === 'Exif\0\0' && startsWithTiff(bytes, data + 6)) exifBase = data + 6;
    } else if (type === 'IEND') {
      break;
    }
    p = data + length + 4;
  }
  return { exifBase, width, height, frameMarker: null };
}

export function isWebp(bytes: Uint8Array): boolean {
  return ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP';
}

/** WebP: VP8/VP8L/VP8X size and the EXIF chunk. */
export function scanWebp(bytes: Uint8Array): ContainerInfo {
  if (!isWebp(bytes)) return EMPTY;
  let exifBase: number | null = null;
  let width: number | null = null;
  let height: number | null = null;
  const riffEnd = Math.min(bytes.length, 8 + u32le(bytes, 4));
  let p = 12;
  while (p + 8 <= riffEnd) {
    const type = ascii(bytes, p, 4);
    const length = u32le(bytes, p + 4);
    const data = p + 8;
    if (data + length > riffEnd) break;
    if (type === 'VP8X' && length >= 10) {
      width = 1 + ((bytes[data + 4] ?? 0) | ((bytes[data + 5] ?? 0) << 8) | ((bytes[data + 6] ?? 0) << 16));
      height = 1 + ((bytes[data + 7] ?? 0) | ((bytes[data + 8] ?? 0) << 8) | ((bytes[data + 9] ?? 0) << 16));
    } else if (type === 'VP8 ' && width === null && length >= 10) {
      if (bytes[data + 3] === 0x9d && bytes[data + 4] === 0x01 && bytes[data + 5] === 0x2a) {
        width = u16le(bytes, data + 6) & 0x3fff;
        height = u16le(bytes, data + 8) & 0x3fff;
      }
    } else if (type === 'VP8L' && width === null && length >= 5) {
      if (bytes[data] === 0x2f) {
        const bits = u32le(bytes, data + 1);
        width = (bits & 0x3fff) + 1;
        height = ((bits >>> 14) & 0x3fff) + 1;
      }
    } else if (type === 'EXIF' && exifBase === null) {
      if (startsWithTiff(bytes, data)) exifBase = data;
      else if (ascii(bytes, data, 6) === 'Exif\0\0' && startsWithTiff(bytes, data + 6)) exifBase = data + 6;
    }
    p = data + length + (length & 1);
  }
  return { exifBase, width: width || null, height: height || null, frameMarker: null };
}

export const RAF_MAGIC = 'FUJIFILMCCD-RAW ';

export interface RafHeader {
  /** Camera model from the header, e.g. 'X100VI'. */
  readonly model: string;
  readonly jpegOffset: number;
  readonly jpegLength: number;
  /** Raw output size from the CFA header (tag 0x111, else 0x121), unoriented. */
  readonly width: number | null;
  readonly height: number | null;
}

/** RAF header: big-endian; JPEG offset/length at 84/88, CFA header offset/length at 92/96. */
export function readRafHeader(bytes: Uint8Array): RafHeader | null {
  if (bytes.length < 108 || ascii(bytes, 0, 16) !== RAF_MAGIC) return null;
  let model = '';
  for (let i = 28; i < 60; i++) {
    const c = bytes[i] ?? 0;
    if (c === 0) break;
    model += String.fromCharCode(c);
  }
  const jpegOffset = u32be(bytes, 84);
  const jpegLength = u32be(bytes, 88);
  const cfaOffset = u32be(bytes, 92);
  const cfaLength = u32be(bytes, 96);
  let width: number | null = null;
  let height: number | null = null;
  const cfaEnd = Math.min(bytes.length, cfaOffset + cfaLength);
  if (cfaOffset > 0 && cfaOffset + 4 <= cfaEnd) {
    const count = Math.min(u32be(bytes, cfaOffset), 1024);
    let p = cfaOffset + 4;
    let fallback: { w: number; h: number } | null = null;
    for (let i = 0; i < count && p + 4 <= cfaEnd; i++) {
      const tag = u16be(bytes, p);
      const size = u16be(bytes, p + 2);
      if (p + 4 + size > cfaEnd) break;
      if (size >= 4 && (tag === 0x111 || tag === 0x121)) {
        const h = u16be(bytes, p + 4);
        const w = u16be(bytes, p + 6);
        if (w > 0 && h > 0) {
          if (tag === 0x111) {
            width = w;
            height = h;
          } else {
            fallback = { w, h };
          }
        }
      }
      p += 4 + size;
    }
    if (width === null && fallback) {
      width = fallback.w;
      height = fallback.h;
    }
  }
  return { model: model.trim(), jpegOffset, jpegLength, width, height };
}
