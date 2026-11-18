/**
 * Writes export metadata: a small big-endian EXIF TIFF block, inserted as
 * a JPEG APP1 segment or a PNG eXIf chunk into what the browser encoder
 * produced. Only container structure is touched, never pixel data.
 */

import type { Asset } from '../library/types';
import { crc32 } from './crc32';
import { mimeTypeFor, type ExportSettings } from './types';

const ASCII = 2;
const SHORT = 3;
const LONG = 4;
const RATIONAL = 5;
const BYTE = 1;

interface Field {
  readonly tag: number;
  readonly type: number;
  readonly count: number;
  /** Big-endian value bytes, or a pointer filled in at layout (`pointsTo`). */
  readonly data: Uint8Array;
  readonly pointsTo?: 'exif' | 'gps';
}

function asciiField(tag: number, text: string): Field {
  // EXIF says 7-bit ASCII, but '©' in a copyright is common and readers (exiftool, Lightroom) take UTF-8.
  const bytes = concat([new TextEncoder().encode(text), new Uint8Array(1)]);
  return { tag, type: ASCII, count: bytes.length, data: bytes };
}

function shortField(tag: number, value: number): Field {
  const v = Math.max(0, Math.min(0xffff, Math.round(value)));
  return { tag, type: SHORT, count: 1, data: Uint8Array.from([v >> 8, v & 0xff]) };
}

function byteField(tag: number, values: readonly number[]): Field {
  return { tag, type: BYTE, count: values.length, data: Uint8Array.from(values) };
}

function rationalField(tag: number, pairs: readonly (readonly [number, number])[]): Field {
  const data = new Uint8Array(pairs.length * 8);
  const view = new DataView(data.buffer);
  pairs.forEach(([num, den], i) => {
    view.setUint32(i * 8, Math.max(0, Math.round(num)) >>> 0);
    view.setUint32(i * 8 + 4, Math.max(1, Math.round(den)) >>> 0);
  });
  return { tag, type: RATIONAL, count: pairs.length, data };
}

function pointerField(tag: number, pointsTo: 'exif' | 'gps'): Field {
  return { tag, type: LONG, count: 1, data: new Uint8Array(4), pointsTo };
}

/** A decimal as a rational with `scale` as the denominator. */
function decimal(value: number, scale: number): readonly [number, number] {
  return [Math.round(value * scale), scale];
}

/** '1/250' or '2.5' as an EXIF rational. */
export function shutterToRational(shutter: string): readonly [number, number] | null {
  const fraction = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(shutter);
  if (fraction) {
    const num = Number(fraction[1]);
    const den = Number(fraction[2]);
    return num > 0 && den > 0 ? [num, den] : null;
  }
  const seconds = Number(shutter);
  return Number.isFinite(seconds) && seconds > 0 ? decimal(seconds, 1000) : null;
}

const CAPTURE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})([+-]\d{2}:\d{2})?/;

function ifdSize(fields: readonly Field[]): number {
  let size = 2 + fields.length * 12 + 4;
  for (const f of fields) if (f.data.length > 4) size += f.data.length + (f.data.length & 1);
  return size;
}

function writeIfd(out: Uint8Array, at: number, fields: readonly Field[], pointers: Record<'exif' | 'gps', number>): void {
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const sorted = [...fields].sort((a, b) => a.tag - b.tag);
  view.setUint16(at, sorted.length);
  let dataAt = at + 2 + sorted.length * 12 + 4;
  sorted.forEach((f, i) => {
    const p = at + 2 + i * 12;
    view.setUint16(p, f.tag);
    view.setUint16(p + 2, f.type);
    view.setUint32(p + 4, f.count);
    if (f.pointsTo) {
      view.setUint32(p + 8, pointers[f.pointsTo]);
    } else if (f.data.length <= 4) {
      out.set(f.data, p + 8);
    } else {
      view.setUint32(p + 8, dataAt);
      out.set(f.data, dataAt);
      dataAt += f.data.length + (f.data.length & 1);
    }
  });
  view.setUint32(at + 2 + sorted.length * 12, 0);
}

/** The EXIF TIFF block for an exported asset; null when the settings keep nothing. */
export function buildExportExif(asset: Asset, settings: ExportSettings): Uint8Array | null {
  if (settings.metadata === 'none') return null;
  const ifd0: Field[] = [];
  const exif: Field[] = [];
  const gps: Field[] = [];
  if (settings.creator) ifd0.push(asciiField(0x013b, settings.creator));
  if (settings.copyright) ifd0.push(asciiField(0x8298, settings.copyright));

  if (settings.metadata === 'all') {
    if (asset.camera?.make) ifd0.push(asciiField(0x010f, asset.camera.make));
    if (asset.camera?.model) ifd0.push(asciiField(0x0110, asset.camera.model));
    // The renderer outputs pixels already turned upright.
    ifd0.push(shortField(0x0112, 1));

    const m = asset.capturedAt ? CAPTURE.exec(asset.capturedAt) : null;
    if (m) {
      exif.push(asciiField(0x9003, `${m[1]}:${m[2]}:${m[3]} ${m[4]}:${m[5]}:${m[6]}`));
      if (m[7]) exif.push(asciiField(0x9011, m[7]));
    }
    const e = asset.exposure;
    const shutter = e?.shutter ? shutterToRational(e.shutter) : null;
    if (shutter) exif.push(rationalField(0x829a, [shutter]));
    if (e?.aperture) exif.push(rationalField(0x829d, [decimal(e.aperture, 10)]));
    if (e?.iso) exif.push(shortField(0x8827, e.iso));
    if (e?.focalLength) exif.push(rationalField(0x920a, [decimal(e.focalLength, 10)]));
    if (asset.lens) exif.push(asciiField(0xa434, asset.lens));

    if (asset.gps && !settings.removeLocation) {
      const dms = (value: number): (readonly [number, number])[] => {
        const abs = Math.abs(value);
        const deg = Math.floor(abs);
        const minutes = Math.floor((abs - deg) * 60);
        const seconds = (abs - deg - minutes / 60) * 3600;
        return [[deg, 1], [minutes, 1], decimal(seconds, 1000)];
      };
      gps.push(byteField(0x0000, [2, 3, 0, 0]));
      gps.push(asciiField(0x0001, asset.gps.lat < 0 ? 'S' : 'N'));
      gps.push(rationalField(0x0002, dms(asset.gps.lat)));
      gps.push(asciiField(0x0003, asset.gps.lon < 0 ? 'W' : 'E'));
      gps.push(rationalField(0x0004, dms(asset.gps.lon)));
      if (asset.gps.alt !== null) {
        gps.push(byteField(0x0005, [asset.gps.alt < 0 ? 1 : 0]));
        gps.push(rationalField(0x0006, [decimal(Math.abs(asset.gps.alt), 100)]));
      }
    }
  }
  if (exif.length > 0) ifd0.push(pointerField(0x8769, 'exif'));
  if (gps.length > 0) ifd0.push(pointerField(0x8825, 'gps'));
  if (ifd0.length === 0) return null;

  const ifd0At = 8;
  const exifAt = ifd0At + ifdSize(ifd0);
  const gpsAt = exifAt + (exif.length > 0 ? ifdSize(exif) : 0);
  const total = gpsAt + (gps.length > 0 ? ifdSize(gps) : 0);
  const out = new Uint8Array(total);
  out.set([0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, ifd0At]);
  const pointers = { exif: exifAt, gps: gpsAt };
  writeIfd(out, ifd0At, ifd0, pointers);
  if (exif.length > 0) writeIfd(out, exifAt, exif, pointers);
  if (gps.length > 0) writeIfd(out, gpsAt, gps, pointers);
  return out;
}

function concat(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const EXIF_HEADER = Uint8Array.from([0x45, 0x78, 0x69, 0x66, 0, 0]);
const MAX_SEGMENT = 0xffff - 2;

function isExifApp1(jpeg: Uint8Array, p: number, length: number): boolean {
  if (jpeg[p + 1] !== 0xe1 || length < 8) return false;
  return EXIF_HEADER.every((b, i) => jpeg[p + 4 + i] === b);
}

/**
 * The JPEG with `tiff` as its Exif APP1, placed after SOI and any APP0
 * (JFIF). An existing Exif APP1 is dropped; every other segment (the ICC
 * profile in APP2 included) is kept as it was. A null `tiff` only removes
 * Exif. Input that is not a well-formed JPEG header comes back unchanged.
 */
export function insertJpegExif(jpeg: Uint8Array, tiff: Uint8Array | null): Uint8Array {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return jpeg;
  const segment =
    tiff && EXIF_HEADER.length + tiff.length <= MAX_SEGMENT
      ? concat([
          Uint8Array.from([0xff, 0xe1, (EXIF_HEADER.length + tiff.length + 2) >> 8, (EXIF_HEADER.length + tiff.length + 2) & 0xff]),
          EXIF_HEADER,
          tiff,
        ])
      : null;
  const parts: Uint8Array[] = [jpeg.subarray(0, 2)];
  let p = 2;
  let inserted = segment === null;
  while (p + 4 <= jpeg.length && jpeg[p] === 0xff) {
    const marker = jpeg[p + 1] ?? 0;
    if (marker === 0xda || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd8) || marker === 0x01 || marker === 0xff) break;
    const length = ((jpeg[p + 2] ?? 0) << 8) | (jpeg[p + 3] ?? 0);
    if (length < 2 || p + 2 + length > jpeg.length) return jpeg;
    if (!inserted && marker !== 0xe0) {
      parts.push(segment ?? new Uint8Array());
      inserted = true;
    }
    if (!isExifApp1(jpeg, p, length)) parts.push(jpeg.subarray(p, p + 2 + length));
    p += 2 + length;
  }
  if (!inserted && segment) parts.push(segment);
  parts.push(jpeg.subarray(p));
  return concat(parts);
}

function u32(v: number): Uint8Array {
  return Uint8Array.from([(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]);
}

/**
 * The PNG with `tiff` as an eXIf chunk before the first IDAT; an existing
 * eXIf is dropped. A null `tiff` only removes it. Input that is not a
 * well-formed PNG comes back unchanged.
 */
export function insertPngExif(png: Uint8Array, tiff: Uint8Array | null): Uint8Array {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!signature.every((b, i) => png[i] === b)) return png;
  const type = (at: number) => String.fromCharCode(png[at] ?? 0, png[at + 1] ?? 0, png[at + 2] ?? 0, png[at + 3] ?? 0);
  let chunk: Uint8Array | null = null;
  if (tiff) {
    const typeAndData = concat([Uint8Array.from([0x65, 0x58, 0x49, 0x66]), tiff]);
    chunk = concat([u32(tiff.length), typeAndData, u32(crc32(typeAndData))]);
  }
  const parts: Uint8Array[] = [png.subarray(0, 8)];
  let p = 8;
  let inserted = chunk === null;
  while (p + 12 <= png.length) {
    const length = ((png[p] ?? 0) * 0x1000000 + (((png[p + 1] ?? 0) << 16) | ((png[p + 2] ?? 0) << 8) | (png[p + 3] ?? 0))) >>> 0;
    const end = p + 12 + length;
    if (end > png.length) return png;
    const t = type(p + 4);
    if (!inserted && (t === 'IDAT' || t === 'IEND') && chunk) {
      parts.push(chunk);
      inserted = true;
    }
    if (t !== 'eXIf') parts.push(png.subarray(p, end));
    p = end;
    if (t === 'IEND') break;
  }
  if (!inserted) return png;
  parts.push(png.subarray(p));
  return concat(parts);
}

/** The rendered blob with the metadata the settings ask for. */
export async function applyExportMetadata(blob: Blob, asset: Asset, settings: ExportSettings): Promise<Blob> {
  // A TIFF's tags are written by the engine as it encodes it; splicing EXIF into it is not this module's job.
  if (settings.format === 'tiff') return blob;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const tiff = buildExportExif(asset, settings);
  const out = settings.format === 'png' ? insertPngExif(bytes, tiff) : insertJpegExif(bytes, tiff);
  if (out === bytes) return blob;
  return new Blob([out.slice()], { type: mimeTypeFor(settings.format) });
}
