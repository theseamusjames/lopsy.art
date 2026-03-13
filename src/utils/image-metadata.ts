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

export async function addPngMetadata(
  blob: Blob,
  entries: Record<string, string>,
): Promise<Blob> {
  const data = new Uint8Array(await blob.arrayBuffer());
  const chunks = Object.entries(entries).map(([k, v]) => createPngTextChunk(k, v));
  const extra = chunks.reduce((s, c) => s + c.length, 0);
  const iend = data.length - 12;
  const result = new Uint8Array(data.length + extra);
  result.set(data.subarray(0, iend), 0);
  let offset = iend;
  for (const c of chunks) {
    result.set(c, offset);
    offset += c.length;
  }
  result.set(data.subarray(iend), offset);
  return new Blob([result], { type: 'image/png' });
}

export async function addJpegComment(blob: Blob, comment: string): Promise<Blob> {
  const data = new Uint8Array(await blob.arrayBuffer());
  const bytes = new TextEncoder().encode(comment);
  const markerLen = bytes.length + 2;
  const marker = new Uint8Array(4 + bytes.length);
  marker[0] = 0xff;
  marker[1] = 0xfe;
  marker[2] = (markerLen >> 8) & 0xff;
  marker[3] = markerLen & 0xff;
  marker.set(bytes, 4);
  const result = new Uint8Array(data.length + marker.length);
  result.set(data.subarray(0, 2), 0);
  result.set(marker, 2);
  result.set(data.subarray(2), 2 + marker.length);
  return new Blob([result], { type: 'image/jpeg' });
}
