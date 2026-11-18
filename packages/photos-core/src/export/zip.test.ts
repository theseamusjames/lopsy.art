import { describe, expect, it } from 'vitest';
import { crc32 } from './crc32';
import { createZip } from './zip';

interface Parsed {
  name: string;
  flags: number;
  method: number;
  crc: number;
  data: Uint8Array;
}

/** Reads a zip back through its end record and central directory, checking each local header. */
function parseZip(bytes: Uint8Array): Parsed[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  const cdSize = view.getUint32(end + 12, true);
  const cdOffset = view.getUint32(end + 16, true);
  expect(cdOffset + cdSize).toBe(end);
  const out: Parsed[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(p, true)).toBe(0x02014b50);
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const crc = view.getUint32(p + 16, true);
    const size = view.getUint32(p + 20, true);
    expect(view.getUint32(p + 24, true)).toBe(size);
    const nameLength = view.getUint16(p + 28, true);
    const extra = view.getUint16(p + 30, true);
    const comment = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLength));
    expect(view.getUint32(local, true)).toBe(0x04034b50);
    expect(view.getUint32(local + 14, true)).toBe(crc);
    expect(view.getUint32(local + 18, true)).toBe(size);
    const localName = view.getUint16(local + 26, true);
    const localExtra = view.getUint16(local + 28, true);
    const dataAt = local + 30 + localName + localExtra;
    out.push({ name, flags, method, crc, data: bytes.subarray(dataAt, dataAt + size) });
    p += 46 + nameLength + extra + comment;
  }
  return out;
}

describe('createZip', () => {
  it('writes stored entries that read back with matching CRCs and contents', async () => {
    const a = new Uint8Array(3000).map((_, i) => (i * 7) & 0xff);
    const b = new TextEncoder().encode('hello');
    const zip = await createZip([
      { name: 'DSCF0001.jpg', blob: new Blob([a]) },
      { name: 'Café ✓.jpg', blob: new Blob([b]), modified: new Date(2026, 10, 14, 16, 2, 10) },
      { name: 'empty.txt', blob: new Blob([]) },
    ]);
    expect(zip.type).toBe('application/zip');
    const entries = parseZip(new Uint8Array(await zip.arrayBuffer()));
    expect(entries.map((e) => e.name)).toEqual(['DSCF0001.jpg', 'Café ✓.jpg', 'empty.txt']);
    for (const e of entries) {
      expect(e.method).toBe(0);
      expect(e.flags & 0x0800).toBe(0x0800);
      expect(e.crc).toBe(crc32(e.data));
    }
    expect(Array.from(entries[0]?.data ?? [])).toEqual(Array.from(a));
    expect(new TextDecoder().decode(entries[1]?.data)).toBe('hello');
    expect(entries[2]?.data.length).toBe(0);
  });

  it('writes an empty archive', async () => {
    const zip = new Uint8Array(await (await createZip([])).arrayBuffer());
    expect(zip.length).toBe(22);
    expect(parseZip(zip)).toEqual([]);
  });
});
