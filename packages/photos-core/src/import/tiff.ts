/**
 * A small TIFF/IFD reader for metadata (EXIF in JPEG/PNG/WebP/RAF, DNG
 * and ARW structure). Every read is bounds-checked; malformed input yields
 * null or a partial result, never an exception.
 */

export const TiffTag = {
  NewSubfileType: 0x00fe,
  ImageWidth: 0x0100,
  ImageLength: 0x0101,
  Compression: 0x0103,
  PhotometricInterpretation: 0x0106,
  Make: 0x010f,
  Model: 0x0110,
  StripOffsets: 0x0111,
  Orientation: 0x0112,
  StripByteCounts: 0x0117,
  SubIFDs: 0x014a,
  JpegInterchangeFormat: 0x0201,
  JpegInterchangeFormatLength: 0x0202,
  ExposureTime: 0x829a,
  FNumber: 0x829d,
  ExifIfd: 0x8769,
  GpsIfd: 0x8825,
  Iso: 0x8827,
  RecommendedExposureIndex: 0x8832,
  DateTimeOriginal: 0x9003,
  OffsetTimeOriginal: 0x9011,
  FocalLength: 0x920a,
  PixelXDimension: 0xa002,
  PixelYDimension: 0xa003,
  LensModel: 0xa434,
  DngVersion: 0xc612,
  DefaultCropSize: 0xc620,
} as const;

export const GpsTag = {
  LatitudeRef: 0x0001,
  Latitude: 0x0002,
  LongitudeRef: 0x0003,
  Longitude: 0x0004,
  AltitudeRef: 0x0005,
  Altitude: 0x0006,
} as const;

/** Bytes per value of each TIFF field type (index = type). */
const TYPE_SIZES: readonly number[] = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8, 4];

/** Guards against hostile counts: no real metadata field needs more. */
const MAX_VALUES = 65536;
const MAX_IFD_ENTRIES = 4096;
const MAX_CHAIN = 32;

export interface TiffEntry {
  readonly tag: number;
  readonly type: number;
  readonly count: number;
  /** Absolute offset of the value bytes in `TiffFile.bytes`. */
  readonly valueOffset: number;
}

export interface TiffIfd {
  /** Absolute offset of the IFD in `TiffFile.bytes`. */
  readonly offset: number;
  readonly entries: ReadonlyMap<number, TiffEntry>;
  /** Offset (relative to the TIFF header) of the next IFD; 0 when none. */
  readonly next: number;
}

export interface TiffFile {
  readonly bytes: Uint8Array;
  readonly view: DataView;
  /** Absolute offset of the TIFF header ('II*\0' or 'MM\0*'). */
  readonly base: number;
  readonly littleEndian: boolean;
  readonly firstIfd: number;
}

export interface Rational {
  readonly num: number;
  readonly den: number;
}

/** Opens a TIFF structure whose header starts at `base`; null when it is not one. */
export function openTiff(bytes: Uint8Array, base = 0): TiffFile | null {
  if (base < 0 || base + 8 > bytes.length) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const b0 = bytes[base];
  const b1 = bytes[base + 1];
  let littleEndian: boolean;
  if (b0 === 0x49 && b1 === 0x49) littleEndian = true;
  else if (b0 === 0x4d && b1 === 0x4d) littleEndian = false;
  else return null;
  if (view.getUint16(base + 2, littleEndian) !== 42) return null;
  const firstIfd = view.getUint32(base + 4, littleEndian);
  return { bytes, view, base, littleEndian, firstIfd };
}

/** Reads one IFD at `relOffset` (relative to the TIFF header). */
export function readIfd(tiff: TiffFile, relOffset: number): TiffIfd | null {
  const { view, base, littleEndian, bytes } = tiff;
  const offset = base + relOffset;
  if (relOffset <= 0 || offset + 2 > bytes.length) return null;
  const count = view.getUint16(offset, littleEndian);
  if (count === 0 || count > MAX_IFD_ENTRIES) return null;
  const entries = new Map<number, TiffEntry>();
  const end = offset + 2 + count * 12;
  for (let i = 0; i < count; i++) {
    const p = offset + 2 + i * 12;
    if (p + 12 > bytes.length) break;
    const tag = view.getUint16(p, littleEndian);
    const type = view.getUint16(p + 2, littleEndian);
    const valueCount = view.getUint32(p + 4, littleEndian);
    const size = TYPE_SIZES[type];
    if (size === undefined || size === 0) continue;
    const total = size * valueCount;
    const valueOffset = total <= 4 ? p + 8 : base + view.getUint32(p + 8, littleEndian);
    if (valueOffset < 0 || valueOffset + total > bytes.length) continue;
    if (!entries.has(tag)) entries.set(tag, { tag, type, count: valueCount, valueOffset });
  }
  const next = end + 4 <= bytes.length ? view.getUint32(end, littleEndian) : 0;
  return { offset, entries, next };
}

/** IFD0, IFD1, ... following the next-IFD links, stopping at loops. */
export function readIfdChain(tiff: TiffFile): TiffIfd[] {
  const out: TiffIfd[] = [];
  const seen = new Set<number>();
  let rel = tiff.firstIfd;
  while (rel !== 0 && !seen.has(rel) && out.length < MAX_CHAIN) {
    seen.add(rel);
    const ifd = readIfd(tiff, rel);
    if (!ifd) break;
    out.push(ifd);
    rel = ifd.next;
  }
  return out;
}

/** The IFDs a pointer tag (SubIFDs, ExifIFD, GPS IFD) points at. */
export function readPointedIfds(tiff: TiffFile, ifd: TiffIfd, tag: number): TiffIfd[] {
  const offsets = getNumbers(tiff, ifd, tag) ?? [];
  const out: TiffIfd[] = [];
  for (const rel of offsets.slice(0, MAX_CHAIN)) {
    if (rel === ifd.offset - tiff.base) continue;
    const sub = readIfd(tiff, rel);
    if (sub) out.push(sub);
  }
  return out;
}

/** IFD0's chain plus every SubIFD under it (DNG keeps the raw and previews there). */
export function collectImageIfds(tiff: TiffFile): TiffIfd[] {
  const out: TiffIfd[] = [];
  const seen = new Set<number>();
  const visit = (ifd: TiffIfd, depth: number) => {
    if (seen.has(ifd.offset) || out.length >= MAX_CHAIN * 2) return;
    seen.add(ifd.offset);
    out.push(ifd);
    if (depth < 3) for (const sub of readPointedIfds(tiff, ifd, TiffTag.SubIFDs)) visit(sub, depth + 1);
  };
  for (const ifd of readIfdChain(tiff)) visit(ifd, 0);
  return out;
}

/** PhotometricInterpretation of a colour filter array: a camera's raw sensor data. */
export const PHOTOMETRIC_CFA = 32803;

/**
 * The full-resolution CFA image (NewSubfileType 0, absent counting as 0,
 * and PhotometricInterpretation CFA) among IFD0's chain and its SubIFDs;
 * null when there is none.
 */
export function findCfaImageIfd(tiff: TiffFile): TiffIfd | null {
  for (const ifd of collectImageIfds(tiff)) {
    if ((getNumber(tiff, ifd, TiffTag.NewSubfileType) ?? 0) !== 0) continue;
    if (getNumber(tiff, ifd, TiffTag.PhotometricInterpretation) === PHOTOMETRIC_CFA) return ifd;
  }
  return null;
}

export function readPointedIfd(tiff: TiffFile, ifd: TiffIfd, tag: number): TiffIfd | null {
  return readPointedIfds(tiff, ifd, tag)[0] ?? null;
}

function readValue(tiff: TiffFile, type: number, at: number): number {
  const { view, littleEndian } = tiff;
  switch (type) {
    case 1:
    case 7:
      return view.getUint8(at);
    case 6:
      return view.getInt8(at);
    case 3:
      return view.getUint16(at, littleEndian);
    case 8:
      return view.getInt16(at, littleEndian);
    case 4:
    case 13:
      return view.getUint32(at, littleEndian);
    case 9:
      return view.getInt32(at, littleEndian);
    case 5: {
      const den = view.getUint32(at + 4, littleEndian);
      return den === 0 ? Number.NaN : view.getUint32(at, littleEndian) / den;
    }
    case 10: {
      const den = view.getInt32(at + 4, littleEndian);
      return den === 0 ? Number.NaN : view.getInt32(at, littleEndian) / den;
    }
    case 11:
      return view.getFloat32(at, littleEndian);
    case 12:
      return view.getFloat64(at, littleEndian);
    default:
      return Number.NaN;
  }
}

/** Every value of a numeric field (rationals divided out); null when absent or not numeric. */
export function getNumbers(tiff: TiffFile, ifd: TiffIfd, tag: number): number[] | null {
  const entry = ifd.entries.get(tag);
  if (!entry || entry.type === 2) return null;
  const size = TYPE_SIZES[entry.type] ?? 0;
  const count = Math.min(entry.count, MAX_VALUES);
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(readValue(tiff, entry.type, entry.valueOffset + i * size));
  return out;
}

/** The first value of a numeric field, when it is a finite number. */
export function getNumber(tiff: TiffFile, ifd: TiffIfd, tag: number): number | null {
  const value = getNumbers(tiff, ifd, tag)?.[0];
  return value !== undefined && Number.isFinite(value) ? value : null;
}

/** The first rational of a RATIONAL/SRATIONAL field, undivided. */
export function getRational(tiff: TiffFile, ifd: TiffIfd, tag: number): Rational | null {
  const entry = ifd.entries.get(tag);
  if (!entry || entry.count < 1) return null;
  const { view, littleEndian } = tiff;
  if (entry.type === 5) {
    return { num: view.getUint32(entry.valueOffset, littleEndian), den: view.getUint32(entry.valueOffset + 4, littleEndian) };
  }
  if (entry.type === 10) {
    return { num: view.getInt32(entry.valueOffset, littleEndian), den: view.getInt32(entry.valueOffset + 4, littleEndian) };
  }
  return null;
}

/** An ASCII (or UNDEFINED-as-text) field: leading NULs skipped, cut at the next NUL, trimmed. */
export function getString(tiff: TiffFile, ifd: TiffIfd, tag: number): string | null {
  const entry = ifd.entries.get(tag);
  if (!entry || (entry.type !== 2 && entry.type !== 7 && entry.type !== 1)) return null;
  const count = Math.min(entry.count, MAX_VALUES);
  let i = 0;
  while (i < count && (tiff.bytes[entry.valueOffset + i] === 0 || tiff.bytes[entry.valueOffset + i] === 0x20)) i++;
  let text = '';
  for (; i < count; i++) {
    const c = tiff.bytes[entry.valueOffset + i] ?? 0;
    if (c === 0) break;
    text += String.fromCharCode(c);
  }
  return text.trim();
}
