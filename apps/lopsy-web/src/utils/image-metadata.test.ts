import { describe, it, expect } from 'vitest';
import {
  addPngMetadata,
  addJpegComment,
  pngHasColorChunk,
  jpegHasIccProfile,
} from './image-metadata';

/**
 * Decode the zlib stream produced by the iCCP inserter. It always uses
 * stored (uncompressed) deflate blocks, so no real inflate is needed:
 * skip the 2-byte zlib header, then walk BFINAL/BTYPE + LEN/NLEN blocks.
 */
function inflateStored(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let pos = 2;
  for (;;) {
    const header = data[pos]!;
    if (header >> 1 !== 0) throw new Error('not a stored deflate block');
    const len = data[pos + 1]! | (data[pos + 2]! << 8);
    pos += 5;
    for (let i = 0; i < len; i++) out.push(data[pos + i]!);
    pos += len;
    if ((header & 1) === 1) break;
  }
  return new Uint8Array(out);
}

// ─── Synthetic file builders ───────────────────────────────────────────

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pngChunk(type: string, payload: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(12 + payload.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, payload.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(payload, 8);
  // CRC left as zero — the parser walks lengths and never validates CRCs.
  return out;
}

function buildPng(extraChunks: Uint8Array[] = []): Uint8Array<ArrayBuffer> {
  const ihdr = pngChunk('IHDR', new Uint8Array(13));
  const idat = pngChunk('IDAT', new Uint8Array([1, 2, 3, 4]));
  const iend = pngChunk('IEND', new Uint8Array(0));
  const parts = [new Uint8Array(PNG_SIGNATURE), ihdr, ...extraChunks, idat, iend];
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

interface ParsedChunk {
  type: string;
  payload: Uint8Array;
  crc: number;
}

function parsePngChunks(data: Uint8Array): ParsedChunk[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const chunks: ParsedChunk[] = [];
  let off = 8;
  while (off + 12 <= data.length) {
    const length = view.getUint32(off);
    const type = String.fromCharCode(data[off + 4]!, data[off + 5]!, data[off + 6]!, data[off + 7]!);
    chunks.push({
      type,
      payload: data.subarray(off + 8, off + 8 + length),
      crc: view.getUint32(off + 8 + length),
    });
    off += 12 + length;
  }
  return chunks;
}

function crc32Reference(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i]!;
    for (let k = 0; k < 8; k++) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function jpegSegment(marker: number, payload: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(4 + payload.length);
  out[0] = 0xff;
  out[1] = marker;
  out[2] = ((payload.length + 2) >> 8) & 0xff;
  out[3] = (payload.length + 2) & 0xff;
  out.set(payload, 4);
  return out;
}

function jpegIccSegment(profile: Uint8Array): Uint8Array<ArrayBuffer> {
  const id = new TextEncoder().encode('ICC_PROFILE\0');
  const payload = new Uint8Array(id.length + 2 + profile.length);
  payload.set(id, 0);
  payload[id.length] = 1; // chunk number
  payload[id.length + 1] = 1; // total chunks
  payload.set(profile, id.length + 2);
  return jpegSegment(0xe2, payload);
}

function buildJpeg(extraSegments: Uint8Array[] = []): Uint8Array<ArrayBuffer> {
  const soi = new Uint8Array([0xff, 0xd8]);
  const app0 = jpegSegment(0xe0, new TextEncoder().encode('JFIF\0'));
  const sos = new Uint8Array([0xff, 0xda, 0x00, 0x02]);
  const scanData = new Uint8Array([0x12, 0x34, 0x56]);
  const eoi = new Uint8Array([0xff, 0xd9]);
  const parts = [soi, app0, ...extraSegments, sos, scanData, eoi];
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function countJpegIccSegments(data: Uint8Array): number {
  const id = 'ICC_PROFILE\0';
  let count = 0;
  let off = 2;
  while (off + 4 <= data.length) {
    if (data[off] !== 0xff) break;
    const marker = data[off + 1]!;
    if (marker === 0xda || marker === 0xd9) break;
    const length = ((data[off + 2]! << 8) | data[off + 3]!) + 2;
    if (marker === 0xe2) {
      let matches = true;
      for (let i = 0; i < id.length; i++) {
        if (data[off + 4 + i] !== id.charCodeAt(i)) {
          matches = false;
          break;
        }
      }
      if (matches) count++;
    }
    off += length;
  }
  return count;
}

const fakeProfile = new Uint8Array(Array.from({ length: 300 }, (_, i) => i % 251));

async function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

// ─── PNG ───────────────────────────────────────────────────────────────

describe('pngHasColorChunk', () => {
  it('returns false for a PNG without color chunks', () => {
    expect(pngHasColorChunk(buildPng())).toBe(false);
  });

  it.each(['iCCP', 'sRGB', 'cICP'])('detects an existing %s chunk', (type) => {
    const png = buildPng([pngChunk(type, new Uint8Array([0]))]);
    expect(pngHasColorChunk(png)).toBe(true);
  });

  it('ignores color-chunk bytes inside IDAT data', () => {
    const idatPayload = new TextEncoder().encode('xxiCCPxx');
    const png = buildPng([pngChunk('IDAT', idatPayload)]);
    expect(pngHasColorChunk(png)).toBe(false);
  });
});

describe('addPngMetadata', () => {
  it('adds tEXt chunks and an sRGB chunk to an untagged PNG without a profile', async () => {
    const blob = new Blob([buildPng()], { type: 'image/png' });
    const out = await blobBytes(await addPngMetadata(blob, { Software: 'Lopsy' }));
    const chunks = parsePngChunks(out);
    const types = chunks.map((c) => c.type);

    expect(types).toEqual(['IHDR', 'sRGB', 'IDAT', 'tEXt', 'IEND']);
    const text = chunks.find((c) => c.type === 'tEXt')!;
    expect(new TextDecoder().decode(text.payload)).toBe('Software\0Lopsy');
  });

  it('embeds the provided ICC profile as an iCCP chunk before IDAT', async () => {
    const blob = new Blob([buildPng()], { type: 'image/png' });
    const out = await blobBytes(
      await addPngMetadata(blob, {}, { name: 'Display P3', data: fakeProfile }),
    );
    const chunks = parsePngChunks(out);
    const types = chunks.map((c) => c.type);
    expect(types).toEqual(['IHDR', 'iCCP', 'IDAT', 'IEND']);

    const iccp = chunks.find((c) => c.type === 'iCCP')!;
    const nameEnd = iccp.payload.indexOf(0);
    expect(new TextDecoder().decode(iccp.payload.subarray(0, nameEnd))).toBe('Display P3');
    expect(iccp.payload[nameEnd + 1]).toBe(0); // compression method: deflate

    expect(inflateStored(iccp.payload.subarray(nameEnd + 2))).toEqual(fakeProfile);
  });

  it('writes a valid CRC for inserted chunks', async () => {
    const blob = new Blob([buildPng()], { type: 'image/png' });
    const out = await blobBytes(
      await addPngMetadata(blob, {}, { name: 'Display P3', data: fakeProfile }),
    );
    const data = out;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    // iCCP follows IHDR (8 signature + 25 IHDR bytes).
    const off = 33;
    const length = view.getUint32(off);
    const typeAndPayload = data.subarray(off + 4, off + 8 + length);
    expect(view.getUint32(off + 8 + length)).toBe(crc32Reference(typeAndPayload));
  });

  it('does not insert a second color chunk when the encoder already tagged the file', async () => {
    const existing = pngChunk('iCCP', new TextEncoder().encode('Encoder P3\0\0compressed'));
    const blob = new Blob([buildPng([existing])], { type: 'image/png' });
    const out = await blobBytes(
      await addPngMetadata(blob, { Software: 'Lopsy' }, { name: 'Display P3', data: fakeProfile }),
    );
    const chunks = parsePngChunks(out);
    const colorChunks = chunks.filter((c) => ['iCCP', 'sRGB', 'cICP'].includes(c.type));
    expect(colorChunks).toHaveLength(1);
    expect(new TextDecoder().decode(colorChunks[0]!.payload.subarray(0, 10))).toBe('Encoder P3');
    // tEXt metadata is still added.
    expect(chunks.some((c) => c.type === 'tEXt')).toBe(true);
  });

  it('round-trips profiles larger than one deflate stored block', async () => {
    const bigProfile = new Uint8Array(70000);
    for (let i = 0; i < bigProfile.length; i++) bigProfile[i] = (i * 7) & 0xff;
    const blob = new Blob([buildPng()], { type: 'image/png' });
    const out = await blobBytes(
      await addPngMetadata(blob, {}, { name: 'Display P3', data: bigProfile }),
    );
    const iccp = parsePngChunks(out).find((c) => c.type === 'iCCP')!;
    const nameEnd = iccp.payload.indexOf(0);
    expect(inflateStored(iccp.payload.subarray(nameEnd + 2))).toEqual(bigProfile);
  });
});

// ─── JPEG ──────────────────────────────────────────────────────────────

describe('jpegHasIccProfile', () => {
  it('returns false for a JPEG without an ICC segment', () => {
    expect(jpegHasIccProfile(buildJpeg())).toBe(false);
  });

  it('detects an existing APP2 ICC_PROFILE segment', () => {
    expect(jpegHasIccProfile(buildJpeg([jpegIccSegment(fakeProfile)]))).toBe(true);
  });

  it('ignores APP2 segments that are not ICC profiles', () => {
    const app2 = jpegSegment(0xe2, new TextEncoder().encode('FPXR\0not-icc-data'));
    expect(jpegHasIccProfile(buildJpeg([app2]))).toBe(false);
  });

  it('stops scanning at SOS so scan data cannot false-positive', () => {
    const jpeg = buildJpeg();
    // Splice ICC_PROFILE text into the entropy-coded data after SOS.
    const withText = new Uint8Array(jpeg.length + 12);
    withText.set(jpeg.subarray(0, jpeg.length - 2), 0);
    withText.set(new TextEncoder().encode('ICC_PROFILE\0'), jpeg.length - 2);
    expect(jpegHasIccProfile(withText)).toBe(false);
  });
});

describe('addJpegComment', () => {
  it('adds a COM segment with the comment text', async () => {
    const blob = new Blob([buildJpeg()], { type: 'image/jpeg' });
    const out = await blobBytes(await addJpegComment(blob, 'hello'));
    // COM marker (FF FE) directly after SOI.
    expect(out[2]).toBe(0xff);
    expect(out[3]).toBe(0xfe);
    const length = (out[4]! << 8) | out[5]!;
    expect(length).toBe('hello'.length + 2);
    expect(new TextDecoder().decode(out.subarray(6, 6 + 5))).toBe('hello');
  });

  it('embeds the provided ICC profile as an APP2 segment', async () => {
    const blob = new Blob([buildJpeg()], { type: 'image/jpeg' });
    const out = await blobBytes(
      await addJpegComment(blob, 'note', { name: 'Display P3', data: fakeProfile }),
    );
    expect(countJpegIccSegments(out)).toBe(1);
    // APP2 directly after SOI, identifier + 1/1 chunk numbering + profile.
    expect(out[2]).toBe(0xff);
    expect(out[3]).toBe(0xe2);
    expect(new TextDecoder().decode(out.subarray(6, 17))).toBe('ICC_PROFILE');
    expect(out[17]).toBe(0); // null terminator
    expect(out[18]).toBe(1); // chunk number
    expect(out[19]).toBe(1); // total chunks
    expect(out.subarray(20, 20 + fakeProfile.length)).toEqual(fakeProfile);
  });

  it('does not embed without a profile', async () => {
    const blob = new Blob([buildJpeg()], { type: 'image/jpeg' });
    const out = await blobBytes(await addJpegComment(blob, 'note'));
    expect(countJpegIccSegments(out)).toBe(0);
  });

  it('does not insert a second profile when the encoder already tagged the file', async () => {
    const encoderProfile = new Uint8Array([9, 9, 9, 9]);
    const blob = new Blob([buildJpeg([jpegIccSegment(encoderProfile)])], { type: 'image/jpeg' });
    const out = await blobBytes(
      await addJpegComment(blob, 'note', { name: 'Display P3', data: fakeProfile }),
    );
    expect(countJpegIccSegments(out)).toBe(1);
    // The surviving profile is the encoder's, not ours.
    const idx = out.findIndex(
      (_, i) => out[i] === 9 && out[i + 1] === 9 && out[i + 2] === 9 && out[i + 3] === 9,
    );
    expect(idx).toBeGreaterThan(0);
  });
});
