import { isWideGamut } from '../engine/color-space';

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

function createPngTextChunk(keyword: string, text: string): Uint8Array {
  const enc = new TextEncoder();
  const keyBytes = enc.encode(keyword);
  const textBytes = enc.encode(text);
  const payload = new Uint8Array(keyBytes.length + 1 + textBytes.length);
  payload.set(keyBytes, 0);
  payload[keyBytes.length] = 0;
  payload.set(textBytes, keyBytes.length + 1);

  const typeAndPayload = new Uint8Array(4 + payload.length);
  typeAndPayload.set(enc.encode('tEXt'), 0);
  typeAndPayload.set(payload, 4);

  const chunk = new Uint8Array(4 + typeAndPayload.length + 4);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, payload.length);
  chunk.set(typeAndPayload, 4);
  view.setUint32(chunk.length - 4, crc32(typeAndPayload));
  return chunk;
}

function createPngSrgbChunk(): Uint8Array {
  const enc = new TextEncoder();
  const typeBytes = enc.encode('sRGB');
  const payload = new Uint8Array([0]); // rendering intent: perceptual
  const typeAndPayload = new Uint8Array(4 + payload.length);
  typeAndPayload.set(typeBytes, 0);
  typeAndPayload.set(payload, 4);
  const chunk = new Uint8Array(4 + typeAndPayload.length + 4);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, payload.length);
  chunk.set(typeAndPayload, 4);
  view.setUint32(chunk.length - 4, crc32(typeAndPayload));
  return chunk;
}

/** Create a PNG iCCP chunk embedding a compressed ICC profile. */
function createPngIccpChunk(profileName: string, iccProfile: Uint8Array): Uint8Array {
  const enc = new TextEncoder();
  const nameBytes = enc.encode(profileName);
  // iCCP payload: profile name (null terminated) + compression method (0 = deflate) + compressed data
  // Use uncompressed deflate (stored blocks) since we don't have zlib here
  const compressed = deflateStored(iccProfile);
  const payloadLen = nameBytes.length + 1 + 1 + compressed.length;

  const typeAndPayload = new Uint8Array(4 + payloadLen);
  typeAndPayload.set(enc.encode('iCCP'), 0);
  let off = 4;
  typeAndPayload.set(nameBytes, off);
  off += nameBytes.length;
  typeAndPayload[off++] = 0; // null terminator
  typeAndPayload[off++] = 0; // compression method: deflate
  typeAndPayload.set(compressed, off);

  const chunk = new Uint8Array(4 + typeAndPayload.length + 4);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, payloadLen);
  chunk.set(typeAndPayload, 4);
  view.setUint32(chunk.length - 4, crc32(typeAndPayload));
  return chunk;
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

/** Create the PNG color profile chunk appropriate for the active color space. */
function createPngColorChunk(): Uint8Array {
  if (isWideGamut()) {
    return createPngIccpChunk('Display P3', displayP3IccProfile);
  }
  return createPngSrgbChunk();
}

function findIhdrEnd(): number {
  // PNG signature is 8 bytes, IHDR chunk follows: 4 (length) + 4 (type) + 13 (data) + 4 (crc) = 25
  return 8 + 25;
}

export async function addPngMetadata(
  blob: Blob,
  entries: Record<string, string>,
): Promise<Blob> {
  const data = new Uint8Array(await blob.arrayBuffer());

  const colorChunk = createPngColorChunk();

  const chunks = Object.entries(entries).map(([k, v]) => createPngTextChunk(k, v));
  const extra = colorChunk.length + chunks.reduce((s, c) => s + c.length, 0);
  const ihdrEnd = findIhdrEnd();
  const iend = data.length - 12;
  const result = new Uint8Array(data.length + extra);

  // Copy up to end of IHDR
  result.set(data.subarray(0, ihdrEnd), 0);
  let offset = ihdrEnd;

  // Color profile chunk must come before IDAT
  result.set(colorChunk, offset);
  offset += colorChunk.length;

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

function buildMinimalIcc(desc: string): Uint8Array {
  const enc = new TextEncoder();
  const descBytes = enc.encode(desc);

  // Tag table: 3 tags (desc, wtpt, cprt)
  const tagCount = 3;
  const headerSize = 128;
  const tagTableSize = 4 + tagCount * 12;

  // desc tag data (type 'desc')
  const descDataSize = 4 + 4 + 4 + descBytes.length + 1; // type + reserved + length + string + null
  const descPad = (4 - (descDataSize % 4)) % 4;
  const descTotalSize = descDataSize + descPad + 12 + 67; // + unicode + scriptcode

  // wtpt tag data (type 'XYZ ')
  const wtptDataSize = 4 + 4 + 12; // type + reserved + XYZ (D65: 0.9505, 1.0, 1.0890)

  // cprt tag data (type 'text')
  const cprtText = 'No copyright';
  const cprtBytes = enc.encode(cprtText);
  const cprtDataSize = 4 + 4 + cprtBytes.length; // type + reserved + text

  const dataStart = headerSize + tagTableSize;
  const totalSize = dataStart + descTotalSize + wtptDataSize + cprtDataSize;
  const profile = new Uint8Array(totalSize);
  const view = new DataView(profile.buffer);

  // --- Header (128 bytes) ---
  view.setUint32(0, totalSize); // profile size
  // preferred CMM: 0
  view.setUint32(8, 0x02100000); // version 2.1.0
  // device class: 'mntr'
  profile.set(enc.encode('mntr'), 12);
  // color space: 'RGB '
  profile.set(enc.encode('RGB '), 16);
  // PCS: 'XYZ '
  profile.set(enc.encode('XYZ '), 20);
  // date: 2024-01-01
  view.setUint16(24, 2024); // year
  view.setUint16(26, 1); // month
  view.setUint16(28, 1); // day
  // signature: 'acsp'
  profile.set(enc.encode('acsp'), 36);
  // primary platform: 'APPL'
  profile.set(enc.encode('APPL'), 40);
  // rendering intent: perceptual (0)
  view.setUint32(64, 0);
  // PCS illuminant D50 (fixed point s15.16)
  view.setUint32(68, 0x0000f6d6); // X = 0.9642
  view.setUint32(72, 0x00010000); // Y = 1.0
  view.setUint32(76, 0x0000d32d); // Z = 0.8249

  // --- Tag table ---
  const tableOffset = headerSize;
  view.setUint32(tableOffset, tagCount);

  let dataOffset = dataStart;

  // desc tag entry
  profile.set(enc.encode('desc'), tableOffset + 4);
  view.setUint32(tableOffset + 8, dataOffset);
  view.setUint32(tableOffset + 12, descTotalSize);

  // desc tag data
  profile.set(enc.encode('desc'), dataOffset);
  view.setUint32(dataOffset + 8, descBytes.length + 1);
  profile.set(descBytes, dataOffset + 12);
  dataOffset += descTotalSize;

  // wtpt tag entry
  profile.set(enc.encode('wtpt'), tableOffset + 16);
  view.setUint32(tableOffset + 20, dataOffset);
  view.setUint32(tableOffset + 24, wtptDataSize);

  // wtpt tag data (D65 white point in PCS XYZ)
  profile.set(enc.encode('XYZ '), dataOffset);
  view.setUint32(dataOffset + 8, 0x0000f6d6); // X
  view.setUint32(dataOffset + 12, 0x00010000); // Y
  view.setUint32(dataOffset + 16, 0x0000d32d); // Z
  dataOffset += wtptDataSize;

  // cprt tag entry
  profile.set(enc.encode('cprt'), tableOffset + 28);
  view.setUint32(tableOffset + 32, dataOffset);
  view.setUint32(tableOffset + 36, cprtDataSize);

  // cprt tag data
  profile.set(enc.encode('text'), dataOffset);
  profile.set(cprtBytes, dataOffset + 8);

  return profile;
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

const srgbIccProfile = buildMinimalIcc('sRGB');
const displayP3IccProfile = buildMinimalIcc('Display P3');

function getActiveIccProfile(): Uint8Array {
  return isWideGamut() ? displayP3IccProfile : srgbIccProfile;
}

export async function addJpegComment(blob: Blob, comment: string): Promise<Blob> {
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

  // Build ICC profile marker
  const iccMarker = createJpegIccMarker(getActiveIccProfile());

  // Insert both after SOI (first 2 bytes)
  const result = new Uint8Array(data.length + commentMarker.length + iccMarker.length);
  result.set(data.subarray(0, 2), 0);
  result.set(iccMarker, 2);
  result.set(commentMarker, 2 + iccMarker.length);
  result.set(data.subarray(2), 2 + iccMarker.length + commentMarker.length);
  return new Blob([result], { type: 'image/jpeg' });
}
