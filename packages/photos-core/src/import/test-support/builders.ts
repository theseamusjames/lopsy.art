/**
 * Builds small synthetic TIFF, JPEG, PNG and WebP byte structures for
 * tests of the metadata readers. They carry metadata and container
 * structure only; no pixels are encoded.
 */

export type EntrySpec =
  | { readonly tag: number; readonly ascii: string }
  | { readonly tag: number; readonly type: 1 | 3 | 4 | 7 | 8 | 9; readonly values: readonly number[] }
  | { readonly tag: number; readonly type: 5 | 10; readonly rationals: readonly (readonly [number, number])[] }
  /** A LONG pointing at sub-IFDs written after this one. */
  | { readonly tag: number; readonly ifds: readonly IfdSpec[] }
  /** A LONG holding the offset of `blob`, written into the data area. */
  | { readonly tag: number; readonly blob: Uint8Array };

export interface IfdSpec {
  readonly entries: readonly EntrySpec[];
  readonly next?: IfdSpec;
}

const SIZES: Readonly<Record<number, number>> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 8: 2, 9: 4, 10: 8 };

class Writer {
  bytes: number[] = [];
  constructor(readonly littleEndian: boolean) {}
  alloc(n: number): number {
    const at = this.bytes.length;
    for (let i = 0; i < n; i++) this.bytes.push(0);
    if (this.bytes.length % 2 === 1) this.bytes.push(0);
    return at;
  }
  u16(at: number, v: number) {
    const b = [v & 0xff, (v >>> 8) & 0xff];
    if (!this.littleEndian) b.reverse();
    this.bytes[at] = b[0] ?? 0;
    this.bytes[at + 1] = b[1] ?? 0;
  }
  u32(at: number, v: number) {
    const b = [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
    if (!this.littleEndian) b.reverse();
    for (let i = 0; i < 4; i++) this.bytes[at + i] = b[i] ?? 0;
  }
  put(at: number, data: readonly number[] | Uint8Array) {
    for (let i = 0; i < data.length; i++) this.bytes[at + i] = data[i] ?? 0;
  }
}

function valueBytes(w: Writer, type: number, values: readonly number[]): number[] {
  const tmp = new Writer(w.littleEndian);
  const size = SIZES[type] ?? 1;
  tmp.alloc(size * values.length);
  values.forEach((v, i) => {
    if (size === 1) tmp.bytes[i] = v & 0xff;
    else if (size === 2) tmp.u16(i * 2, v & 0xffff);
    else tmp.u32(i * 4, v >>> 0);
  });
  return tmp.bytes.slice(0, size * values.length);
}

function writeIfd(w: Writer, spec: IfdSpec): number {
  const entries = [...spec.entries].sort((a, b) => a.tag - b.tag);
  const at = w.alloc(2 + entries.length * 12 + 4);
  w.u16(at, entries.length);
  entries.forEach((entry, i) => {
    const p = at + 2 + i * 12;
    let type: number;
    let count: number;
    let data: number[];
    if ('ascii' in entry) {
      type = 2;
      data = [...entry.ascii].map((c) => c.charCodeAt(0)).concat([0]);
      count = data.length;
    } else if ('rationals' in entry) {
      type = entry.type;
      data = valueBytes(w, 4, entry.rationals.flatMap(([n, d]) => [n, d]));
      count = entry.rationals.length;
    } else if ('ifds' in entry) {
      type = 4;
      const offsets = entry.ifds.map((sub) => writeIfd(w, sub));
      data = valueBytes(w, 4, offsets);
      count = offsets.length;
    } else if ('blob' in entry) {
      type = 4;
      const blobAt = w.alloc(entry.blob.length);
      w.put(blobAt, entry.blob);
      data = valueBytes(w, 4, [blobAt]);
      count = 1;
    } else {
      type = entry.type;
      data = valueBytes(w, type, entry.values);
      count = entry.values.length;
    }
    w.u16(p, entry.tag);
    w.u16(p + 2, type);
    w.u32(p + 4, count);
    if (data.length <= 4) {
      w.put(p + 8, data);
    } else {
      const dataAt = w.alloc(data.length);
      w.put(dataAt, data);
      w.u32(p + 8, dataAt);
    }
  });
  const next = spec.next ? writeIfd(w, spec.next) : 0;
  w.u32(at + 2 + entries.length * 12, next);
  return at;
}

/** A TIFF structure (header plus IFDs) with offsets relative to its first byte. */
export function buildTiff(ifd0: IfdSpec, littleEndian = true): Uint8Array {
  const w = new Writer(littleEndian);
  w.alloc(8);
  w.put(0, littleEndian ? [0x49, 0x49] : [0x4d, 0x4d]);
  w.u16(2, 42);
  const first = writeIfd(w, ifd0);
  w.u32(4, first);
  return Uint8Array.from(w.bytes);
}

function concat(parts: readonly (readonly number[] | Uint8Array)[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function ascii(text: string): number[] {
  return [...text].map((c) => c.charCodeAt(0));
}

/** A JPEG's marker structure: optional APP1 EXIF, a SOF frame header, an empty scan. */
export function buildJpeg(options: { width: number; height: number; exif?: Uint8Array; frameMarker?: number }): Uint8Array {
  const parts: (readonly number[] | Uint8Array)[] = [[0xff, 0xd8]];
  if (options.exif) {
    const length = 2 + 6 + options.exif.length;
    parts.push([0xff, 0xe1, length >> 8, length & 0xff], ascii('Exif\0\0'), options.exif);
  }
  const { width: w, height: h } = options;
  parts.push([0xff, options.frameMarker ?? 0xc0, 0, 17, 8, h >> 8, h & 0xff, w >> 8, w & 0xff, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  parts.push([0xff, 0xda, 0, 12, 3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0], [0x00, 0x00], [0xff, 0xd9]);
  return concat(parts);
}

function u32be(v: number): number[] {
  return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
}

function u32le(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
}

/** A PNG's chunk structure: IHDR, optional eXIf, IEND (CRCs are zero; readers skip them). */
export function buildPng(options: { width: number; height: number; exif?: Uint8Array }): Uint8Array {
  const chunk = (type: string, data: readonly number[] | Uint8Array) => concat([u32be(data.length), ascii(type), data, [0, 0, 0, 0]]);
  const parts = [
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    chunk('IHDR', [...u32be(options.width), ...u32be(options.height), 8, 6, 0, 0, 0]),
  ];
  if (options.exif) parts.push(chunk('eXIf', options.exif));
  parts.push(chunk('IEND', []));
  return concat(parts);
}

/** A WebP's RIFF structure: VP8X (extended) or VP8L (lossless) with an optional EXIF chunk. */
export function buildWebp(options: { width: number; height: number; kind: 'vp8x' | 'vp8l'; exif?: Uint8Array }): Uint8Array {
  const chunk = (type: string, data: readonly number[] | Uint8Array) =>
    concat([ascii(type), u32le(data.length), data, data.length % 2 === 1 ? [0] : []]);
  const w = options.width - 1;
  const h = options.height - 1;
  const chunks: Uint8Array[] = [];
  if (options.kind === 'vp8x') {
    chunks.push(chunk('VP8X', [options.exif ? 0x08 : 0, 0, 0, 0, w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff, h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff]));
    if (options.exif) chunks.push(chunk('EXIF', options.exif));
  } else {
    const bits = (w & 0x3fff) | ((h & 0x3fff) << 14);
    chunks.push(chunk('VP8L', [0x2f, ...u32le(bits >>> 0), 0, 0]));
  }
  const body = concat([ascii('WEBP'), ...chunks]);
  return concat([ascii('RIFF'), u32le(body.length), body]);
}
