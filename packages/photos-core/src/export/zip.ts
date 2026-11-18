/**
 * A minimal ZIP writer: STORED entries (exported JPEGs and PNGs do not
 * compress), CRC-32, UTF-8 names flagged as such, no ZIP64. The result is
 * a Blob assembled from the entries' own Blobs, so only one entry is read
 * into memory at a time, to compute its CRC.
 */

import { crc32 } from './crc32';

export interface ZipEntry {
  readonly name: string;
  readonly blob: Blob;
  /** Shown as the file's date in the archive; defaults to now. */
  readonly modified?: Date;
}

const UTF8_FLAG = 0x0800;
const VERSION = 20;
const MAX_U32 = 0xffffffff;

/** Above this an entry's CRC is computed in chunks rather than from one buffer. */
const CRC_CHUNK = 16 * 1024 * 1024;

function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.min(2107, Math.max(1980, date.getFullYear()));
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

async function blobCrc(blob: Blob): Promise<number> {
  let crc = 0;
  for (let at = 0; at < blob.size; at += CRC_CHUNK) {
    crc = crc32(new Uint8Array(await blob.slice(at, at + CRC_CHUNK).arrayBuffer()), crc);
  }
  return crc;
}

class Bytes {
  readonly data: Uint8Array<ArrayBuffer>;
  private readonly view: DataView;
  constructor(size: number) {
    this.data = new Uint8Array(size);
    this.view = new DataView(this.data.buffer);
  }
  u16(at: number, v: number): this {
    this.view.setUint16(at, v, true);
    return this;
  }
  u32(at: number, v: number): this {
    this.view.setUint32(at, v >>> 0, true);
    return this;
  }
  set(at: number, bytes: Uint8Array): this {
    this.data.set(bytes, at);
    return this;
  }
}

/** A stored ZIP of the entries, in order. Throws RangeError past the non-ZIP64 limits. */
export async function createZip(entries: readonly ZipEntry[]): Promise<Blob> {
  if (entries.length > 0xffff) throw new RangeError('Too many files for a zip without ZIP64');
  const encoder = new TextEncoder();
  const parts: BlobPart[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const size = entry.blob.size;
    if (size > MAX_U32 || offset > MAX_U32) throw new RangeError('Zip larger than 4 GB needs ZIP64');
    const crc = await blobCrc(entry.blob);
    const { time, date } = dosDateTime(entry.modified ?? new Date());

    const local = new Bytes(30 + name.length)
      .u32(0, 0x04034b50)
      .u16(4, VERSION)
      .u16(6, UTF8_FLAG)
      .u16(8, 0)
      .u16(10, time)
      .u16(12, date)
      .u32(14, crc)
      .u32(18, size)
      .u32(22, size)
      .u16(26, name.length)
      .u16(28, 0)
      .set(30, name);
    parts.push(local.data, entry.blob);

    const header = new Bytes(46 + name.length)
      .u32(0, 0x02014b50)
      .u16(4, VERSION)
      .u16(6, VERSION)
      .u16(8, UTF8_FLAG)
      .u16(10, 0)
      .u16(12, time)
      .u16(14, date)
      .u32(16, crc)
      .u32(20, size)
      .u32(24, size)
      .u16(28, name.length)
      .u16(30, 0)
      .u16(32, 0)
      .u16(34, 0)
      .u16(36, 0)
      .u32(38, 0)
      .u32(42, offset)
      .set(46, name);
    central.push(header.data);
    offset += local.data.length + size;
  }
  const centralSize = central.reduce((n, c) => n + c.length, 0);
  if (offset + centralSize > MAX_U32) throw new RangeError('Zip larger than 4 GB needs ZIP64');
  const end = new Bytes(22)
    .u32(0, 0x06054b50)
    .u16(4, 0)
    .u16(6, 0)
    .u16(8, entries.length)
    .u16(10, entries.length)
    .u32(12, centralSize)
    .u32(16, offset)
    .u16(20, 0);
  return new Blob([...parts, ...central, end.data], { type: 'application/zip' });
}
