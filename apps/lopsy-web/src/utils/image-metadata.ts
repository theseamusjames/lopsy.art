/**
 * Post-encode metadata insertion for exported PNG and JPEG blobs.
 *
 * Adds tEXt/COM annotations and — when the encoder did not already tag the
 * file — a color profile. Chromium's encoders tag display-p3 canvases
 * themselves (PNG iCCP, JPEG APP2 ICC), so the profile passed in here is a
 * fallback for encoders that leave wide-gamut output untagged. Inserting a
 * second profile alongside the encoder's own would be invalid (PNG allows a
 * single iCCP chunk) and readers would pick ours over the correct one, so
 * both inserters detect existing color metadata first.
 */

/** An ICC profile to embed when the encoder left the file untagged. */
export interface EmbeddedIccProfile {
  name: string;
  data: Uint8Array;
}

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = (crcTable[(crc ^ data[i]!) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildPngChunk(type: string, payload: Uint8Array): Uint8Array {
  const enc = new TextEncoder();
  const typeAndPayload = new Uint8Array(4 + payload.length);
  typeAndPayload.set(enc.encode(type), 0);
  typeAndPayload.set(payload, 4);

  const chunk = new Uint8Array(4 + typeAndPayload.length + 4);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, payload.length);
  chunk.set(typeAndPayload, 4);
  view.setUint32(chunk.length - 4, crc32(typeAndPayload));
  return chunk;
}

function createPngTextChunk(keyword: string, text: string): Uint8Array {
  const enc = new TextEncoder();
  const keyBytes = enc.encode(keyword);
  const textBytes = enc.encode(text);
  const payload = new Uint8Array(keyBytes.length + 1 + textBytes.length);
  payload.set(keyBytes, 0);
  payload[keyBytes.length] = 0;
  payload.set(textBytes, keyBytes.length + 1);
  return buildPngChunk('tEXt', payload);
}

function createPngSrgbChunk(): Uint8Array {
  return buildPngChunk('sRGB', new Uint8Array([0])); // rendering intent: perceptual
}

/** Create a PNG iCCP chunk embedding a compressed ICC profile. */
function createPngIccpChunk(profileName: string, iccProfile: Uint8Array): Uint8Array {
  const enc = new TextEncoder();
  const nameBytes = enc.encode(profileName);
  // iCCP payload: profile name (null terminated) + compression method (0 = deflate) + compressed data
  // Use uncompressed deflate (stored blocks) since we don't have zlib here
  const compressed = deflateStored(iccProfile);
  const payload = new Uint8Array(nameBytes.length + 1 + 1 + compressed.length);
  let off = 0;
  payload.set(nameBytes, off);
  off += nameBytes.length;
  payload[off++] = 0; // null terminator
  payload[off++] = 0; // compression method: deflate
  payload.set(compressed, off);
  return buildPngChunk('iCCP', payload);
}

/** Wrap data in a valid deflate stream using stored (uncompressed) blocks. */
function deflateStored(data: Uint8Array): Uint8Array {
  // Zlib header (CM=8, CINFO=7, FCHECK for valid header)
  const zlibHeader = new Uint8Array([0x78, 0x01]);
  // Split into stored blocks of up to 65535 bytes
  const maxBlock = 65535;
  const blockCount = Math.ceil(data.length / maxBlock) || 1;
  const blockHeaderSize = 5; // BFINAL/BTYPE + LEN + NLEN
  const deflateSize = blockCount * blockHeaderSize + data.length;
  const out = new Uint8Array(zlibHeader.length + deflateSize + 4); // +4 for Adler-32
  out.set(zlibHeader, 0);
  let pos = zlibHeader.length;
  let remaining = data.length;
  let srcOff = 0;

  for (let i = 0; i < blockCount; i++) {
    const isLast = i === blockCount - 1;
    const len = Math.min(remaining, maxBlock);
    out[pos++] = isLast ? 0x01 : 0x00; // BFINAL=1 for last, BTYPE=00 (stored)
    out[pos++] = len & 0xff;
    out[pos++] = (len >> 8) & 0xff;
    out[pos++] = ~len & 0xff;
    out[pos++] = (~len >> 8) & 0xff;
    out.set(data.subarray(srcOff, srcOff + len), pos);
    pos += len;
    srcOff += len;
    remaining -= len;
  }

  // Adler-32 checksum
  let a = 1, b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]!) % 65521;
    b = (b + a) % 65521;
  }
  const adler = ((b << 16) | a) >>> 0;
  out[pos++] = (adler >> 24) & 0xff;
  out[pos++] = (adler >> 16) & 0xff;
  out[pos++] = (adler >> 8) & 0xff;
  out[pos++] = adler & 0xff;

  return out.subarray(0, pos);
}

/** PNG chunk types that pin down the file's color interpretation. */
const PNG_COLOR_CHUNK_TYPES = new Set(['iCCP', 'sRGB', 'cICP']);

/**
 * Walk the PNG chunk list and report whether a color-space chunk
 * (iCCP, sRGB, or cICP) is already present.
 */
export function pngHasColorChunk(data: Uint8Array): boolean {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 8; // skip PNG signature
  while (offset + 8 <= data.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      data[offset + 4]!,
      data[offset + 5]!,
      data[offset + 6]!,
      data[offset + 7]!,
    );
    if (PNG_COLOR_CHUNK_TYPES.has(type)) return true;
    if (type === 'IDAT' || type === 'IEND') return false;
    offset += 12 + length;
  }
  return false;
}

function findIhdrEnd(): number {
  // PNG signature is 8 bytes, IHDR chunk follows: 4 (length) + 4 (type) + 13 (data) + 4 (crc) = 25
  return 8 + 25;
}

/**
 * Insert tEXt metadata and, when the encoder did not embed one, a color
 * profile chunk. `icc` is embedded as an iCCP chunk for wide-gamut exports;
 * without it an untagged file gets the 1-byte sRGB chunk (sRGB exports keep
 * their historical shape).
 */
export async function addPngMetadata(
  blob: Blob,
  entries: Record<string, string>,
  icc?: EmbeddedIccProfile,
): Promise<Blob> {
  const data = new Uint8Array(await blob.arrayBuffer());

  // Only tag untagged files — a second color chunk is invalid and would
  // override the encoder's correct profile in most readers.
  const colorChunk = pngHasColorChunk(data)
    ? null
    : icc
      ? createPngIccpChunk(icc.name, icc.data)
      : createPngSrgbChunk();

  const chunks = Object.entries(entries).map(([k, v]) => createPngTextChunk(k, v));
  const extra = (colorChunk?.length ?? 0) + chunks.reduce((s, c) => s + c.length, 0);
  const ihdrEnd = findIhdrEnd();
  const iend = data.length - 12;
  const result = new Uint8Array(data.length + extra);

  // Copy up to end of IHDR
  result.set(data.subarray(0, ihdrEnd), 0);
  let offset = ihdrEnd;

  // Color profile chunk must come before IDAT
  if (colorChunk) {
    result.set(colorChunk, offset);
    offset += colorChunk.length;
  }

  // Copy everything between IHDR end and IEND
  result.set(data.subarray(ihdrEnd, iend), offset);
  offset += iend - ihdrEnd;

  // Text chunks before IEND
  for (const c of chunks) {
    result.set(c, offset);
    offset += c.length;
  }

  // IEND
  result.set(data.subarray(iend), offset);
  return new Blob([result], { type: 'image/png' });
}

const JPEG_ICC_IDENTIFIER = 'ICC_PROFILE\0';

/**
 * Walk the JPEG segment list up to SOS and report whether an APP2
 * ICC_PROFILE segment is already present.
 */
export function jpegHasIccProfile(data: Uint8Array): boolean {
  let offset = 2; // skip SOI
  while (offset + 4 <= data.length) {
    if (data[offset] !== 0xff) return false;
    const marker = data[offset + 1]!;
    if (marker === 0xda || marker === 0xd9) return false; // SOS / EOI
    const length = ((data[offset + 2]! << 8) | data[offset + 3]!) + 2;
    if (marker === 0xe2 && length >= 4 + JPEG_ICC_IDENTIFIER.length) {
      let matches = true;
      for (let i = 0; i < JPEG_ICC_IDENTIFIER.length; i++) {
        if (data[offset + 4 + i] !== JPEG_ICC_IDENTIFIER.charCodeAt(i)) {
          matches = false;
          break;
        }
      }
      if (matches) return true;
    }
    offset += length;
  }
  return false;
}

function createJpegIccMarker(iccProfile: Uint8Array): Uint8Array {
  // APP2 marker with ICC_PROFILE header
  const header = new TextEncoder().encode('ICC_PROFILE');
  // header(12 bytes with null) + chunk number(1) + total chunks(1) + profile data
  const payloadSize = 12 + 1 + 1 + 1 + iccProfile.length; // header + null + seq + count + data
  const markerLen = payloadSize + 2;
  const marker = new Uint8Array(4 + payloadSize);
  marker[0] = 0xff;
  marker[1] = 0xe2; // APP2
  marker[2] = (markerLen >> 8) & 0xff;
  marker[3] = markerLen & 0xff;
  marker.set(header, 4);
  marker[4 + 11] = 0; // null terminator
  marker[4 + 12] = 1; // chunk number
  marker[4 + 13] = 1; // total chunks
  marker.set(iccProfile, 4 + 14);
  return marker;
}

/**
 * Insert a COM comment segment and, when the encoder did not embed one and
 * `icc` is provided, an APP2 ICC profile segment.
 */
export async function addJpegComment(
  blob: Blob,
  comment: string,
  icc?: EmbeddedIccProfile,
): Promise<Blob> {
  const data = new Uint8Array(await blob.arrayBuffer());
  const bytes = new TextEncoder().encode(comment);

  // Build comment marker
  const commentLen = bytes.length + 2;
  const commentMarker = new Uint8Array(4 + bytes.length);
  commentMarker[0] = 0xff;
  commentMarker[1] = 0xfe;
  commentMarker[2] = (commentLen >> 8) & 0xff;
  commentMarker[3] = commentLen & 0xff;
  commentMarker.set(bytes, 4);

  // Only tag untagged files — readers use the first ICC_PROFILE segment,
  // so inserting a second profile would override the encoder's.
  const iccMarker = icc && !jpegHasIccProfile(data) ? createJpegIccMarker(icc.data) : null;

  // Insert after SOI (first 2 bytes)
  const result = new Uint8Array(data.length + commentMarker.length + (iccMarker?.length ?? 0));
  result.set(data.subarray(0, 2), 0);
  let offset = 2;
  if (iccMarker) {
    result.set(iccMarker, offset);
    offset += iccMarker.length;
  }
  result.set(commentMarker, offset);
  offset += commentMarker.length;
  result.set(data.subarray(2), offset);
  return new Blob([result], { type: 'image/jpeg' });
}
