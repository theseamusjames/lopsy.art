export interface AbrBrush {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
  readonly spacing?: number;
}

/**
 * Parse a Photoshop .abr brush file and extract brush tip bitmaps.
 * Returns partial results on corruption rather than throwing.
 */
export function parseABR(buffer: ArrayBuffer): AbrBrush[] {
  const brushes: AbrBrush[] = [];

  try {
    if (buffer.byteLength < 2) {
      return brushes;
    }

    const view = new DataView(buffer);
    const version = view.getUint16(0);

    if (version === 1 || version === 2) {
      parseV1V2(view, version, brushes);
    } else if (version === 6 || version === 7 || version === 10) {
      parseV6Plus(view, brushes);
    }
  } catch {
    // Return whatever was successfully parsed
  }

  return brushes;
}

function parseV1V2(
  view: DataView,
  version: number,
  brushes: AbrBrush[],
): void {
  let offset = 2; // skip version
  let brushIndex = 0;

  while (offset + 6 <= view.byteLength) {
    const brushType = view.getUint16(offset);
    offset += 2;
    const chunkSize = view.getUint32(offset);
    offset += 4;

    const chunkEnd = offset + chunkSize;
    if (chunkEnd > view.byteLength) {
      break;
    }

    if (brushType === 1) {
      // Computed brush — skip
      offset = chunkEnd;
      continue;
    }

    if (brushType !== 2) {
      offset = chunkEnd;
      continue;
    }

    try {
      const result = parseSampledBrush(view, offset, version, brushIndex);
      if (result !== null) {
        brushes.push(result);
      }
    } catch {
      // Skip corrupted brush, continue with next
    }

    offset = chunkEnd;
    brushIndex++;
  }
}

function parseSampledBrush(
  view: DataView,
  startOffset: number,
  version: number,
  brushIndex: number,
): AbrBrush | null {
  let offset = startOffset;

  // miscInfo
  if (offset + 4 > view.byteLength) return null;
  offset += 4; // skip miscInfo

  // spacing
  if (offset + 2 > view.byteLength) return null;
  const spacing = view.getUint16(offset);
  offset += 2;

  // Name
  let name = `Brush ${brushIndex + 1}`;

  if (version === 1) {
    // Pascal string: 1 byte length + ASCII bytes
    if (offset + 1 > view.byteLength) return null;
    const nameLen = view.getUint8(offset);
    offset += 1;
    if (offset + nameLen > view.byteLength) return null;
    const nameBytes: string[] = [];
    for (let i = 0; i < nameLen; i++) {
      nameBytes.push(String.fromCharCode(view.getUint8(offset + i)));
    }
    if (nameLen > 0) {
      name = nameBytes.join('');
    }
    offset += nameLen;
  } else {
    // v2: uint16 nameLength, then UTF-16BE chars
    if (offset + 2 > view.byteLength) return null;
    const nameLength = view.getUint16(offset);
    offset += 2;
    if (offset + nameLength * 2 > view.byteLength) return null;
    if (nameLength > 0) {
      name = readUtf16BE(view, offset, nameLength);
    }
    offset += nameLength * 2;
  }

  // antiAlias
  if (offset + 1 > view.byteLength) return null;
  offset += 1; // skip antiAlias

  // bounds: top, left, bottom, right (each uint16)
  if (offset + 8 > view.byteLength) return null;
  const top = view.getUint16(offset);
  offset += 2;
  const left = view.getUint16(offset);
  offset += 2;
  const bottom = view.getUint16(offset);
  offset += 2;
  const right = view.getUint16(offset);
  offset += 2;

  const height = bottom - top;
  const width = right - left;

  if (width <= 0 || height <= 0) return null;

  // depth
  if (offset + 2 > view.byteLength) return null;
  const depth = view.getUint16(offset);
  offset += 2;

  // compression
  if (offset + 1 > view.byteLength) return null;
  const compression = view.getUint8(offset);
  offset += 1;

  const data = readPixelData(view, offset, width, height, depth, compression);
  if (data === null) return null;

  return {
    name,
    width,
    height,
    data,
    spacing,
  };
}

function parseV6Plus(view: DataView, brushes: AbrBrush[]): void {
  let offset = 2; // skip version

  if (offset + 2 > view.byteLength) return;
  offset += 2; // skip subVersion (uint16)

  // Read 8BIM resource blocks
  while (offset + 12 <= view.byteLength) {
    const sig = readAscii(view, offset, 4);
    offset += 4;

    if (sig !== '8BIM') break;

    const blockType = readAscii(view, offset, 4);
    offset += 4;

    if (offset + 4 > view.byteLength) break;
    const blockSize = view.getUint32(offset);
    offset += 4;

    const blockEnd = offset + blockSize;
    if (blockEnd > view.byteLength) break;

    if (blockType === 'samp') {
      try {
        parseSampBlockV6(view, offset, blockEnd, brushes);
      } catch {
        // Continue with next block
      }
    }

    offset = blockEnd;
  }
}

function readAscii(view: DataView, offset: number, len: number): string {
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

/**
 * Parse a v6+ samp block. Each entry is: uint32 sampleLength, then sample data.
 * Sample data contains a UUID, descriptor header, and pixel data with int32 bounds.
 */
function parseSampBlockV6(
  view: DataView,
  startOffset: number,
  blockEnd: number,
  brushes: AbrBrush[],
): void {
  let offset = startOffset;
  let brushIndex = brushes.length;

  while (offset + 4 <= blockEnd) {
    const sampleLength = view.getUint32(offset);
    offset += 4;

    if (sampleLength < 20 || offset + sampleLength > blockEnd) break;

    const sampleEnd = offset + sampleLength;

    try {
      const brush = parseV6Sample(view, offset, sampleEnd, brushIndex);
      if (brush !== null) {
        brushes.push(brush);
      }
    } catch {
      // Skip corrupted sample
    }

    offset = sampleEnd;
    brushIndex++;
  }
}

/**
 * Parse a single v6 sample entry. The pixel data is preceded by a variable-length
 * descriptor, so we scan for the bounds/depth/compression signature.
 */
function parseV6Sample(
  view: DataView,
  sampleStart: number,
  sampleEnd: number,
  brushIndex: number,
): AbrBrush | null {
  // Skip UUID + null terminator
  let nameEnd = sampleStart;
  while (nameEnd < sampleEnd && view.getUint8(nameEnd) !== 0) {
    nameEnd++;
  }
  const brushName = readAsciiRange(view, sampleStart, nameEnd);
  const dataStart = nameEnd + 1;

  // Scan for valid bounds/depth/compression pattern using int32 bounds.
  // Pattern: 4x int32 (top, left, bottom, right), uint16 depth (8|16), uint8 comp (0|1)
  const result = scanForBoundsInt32(view, dataStart, sampleEnd);
  if (result !== null) {
    const { width, height, depth, compression, pixelDataOffset } = result;
    const data = readPixelData(view, pixelDataOffset, width, height, depth, compression);
    if (data !== null) {
      const name = brushName.length > 1 ? cleanBrushName(brushName) : `Brush ${brushIndex + 1}`;
      return { name, width, height, data };
    }
  }

  // Fallback: try uint16 bounds (older v6 files or simpler structure)
  const result16 = scanForBoundsUint16(view, dataStart, sampleEnd);
  if (result16 !== null) {
    const { width, height, depth, compression, pixelDataOffset } = result16;
    const data = readPixelData(view, pixelDataOffset, width, height, depth, compression);
    if (data !== null) {
      const name = brushName.length > 1 ? cleanBrushName(brushName) : `Brush ${brushIndex + 1}`;
      return { name, width, height, data };
    }
  }

  return null;
}

function readAsciiRange(view: DataView, start: number, end: number): string {
  let s = '';
  for (let i = start; i < end; i++) s += String.fromCharCode(view.getUint8(i));
  return s;
}

function cleanBrushName(raw: string): string {
  // Strip leading $ and UUID-like patterns, keep readable parts
  const cleaned = raw.replace(/^\$[0-9a-f-]+$/i, '');
  return cleaned.length > 0 ? cleaned : raw;
}

/**
 * Scan for the pattern: 4x int32 bounds + uint16 depth (8|16) + uint8 comp (0|1)
 * Validate that the RLE row counts fit within the sample.
 */
function scanForBoundsInt32(
  view: DataView,
  start: number,
  end: number,
): { top: number; left: number; width: number; height: number; depth: number; compression: number; pixelDataOffset: number } | null {
  for (let i = start + 16; i < end - 3; i++) {
    const depth = view.getUint16(i);
    if (depth !== 8 && depth !== 16) continue;
    const comp = view.getUint8(i + 2);
    if (comp !== 0 && comp !== 1) continue;

    const top = view.getInt32(i - 16);
    const left = view.getInt32(i - 12);
    const bottom = view.getInt32(i - 8);
    const right = view.getInt32(i - 4);

    if (top < 0 || left < 0 || bottom <= top || right <= left) continue;
    const width = right - left;
    const height = bottom - top;
    if (width < 2 || height < 2 || width > 16384 || height > 16384) continue;

    const pixelDataOffset = i + 3;
    if (!validatePixelData(view, pixelDataOffset, width, height, depth, comp, end)) continue;

    return { top, left, width, height, depth, compression: comp, pixelDataOffset };
  }
  return null;
}

/**
 * Scan for: 4x uint16 bounds + uint16 depth (8|16) + uint8 comp (0|1)
 */
function scanForBoundsUint16(
  view: DataView,
  start: number,
  end: number,
): { top: number; left: number; width: number; height: number; depth: number; compression: number; pixelDataOffset: number } | null {
  for (let i = start + 8; i < end - 3; i++) {
    const depth = view.getUint16(i);
    if (depth !== 8 && depth !== 16) continue;
    const comp = view.getUint8(i + 2);
    if (comp !== 0 && comp !== 1) continue;

    const top = view.getUint16(i - 8);
    const left = view.getUint16(i - 6);
    const bottom = view.getUint16(i - 4);
    const right = view.getUint16(i - 2);

    if (bottom <= top || right <= left) continue;
    const width = right - left;
    const height = bottom - top;
    if (width < 2 || height < 2 || width > 16384 || height > 16384) continue;

    const pixelDataOffset = i + 3;
    if (!validatePixelData(view, pixelDataOffset, width, height, depth, comp, end)) continue;

    return { top, left, width, height, depth, compression: comp, pixelDataOffset };
  }
  return null;
}

/** Check that pixel data fits and RLE row counts are plausible. */
function validatePixelData(
  view: DataView,
  pixelDataOffset: number,
  width: number,
  height: number,
  depth: number,
  compression: number,
  end: number,
): boolean {
  const bytesPerPixel = depth === 16 ? 2 : 1;
  if (compression === 0) {
    return pixelDataOffset + width * height * bytesPerPixel <= end;
  }
  // RLE: height x uint16 row byte counts, then compressed data
  if (pixelDataOffset + height * 2 > end) return false;
  let total = 0;
  for (let row = 0; row < height; row++) {
    const rb = view.getUint16(pixelDataOffset + row * 2);
    if (rb > width * bytesPerPixel * 2) return false; // row can't be larger than 2x uncompressed
    total += rb;
  }
  return pixelDataOffset + height * 2 + total <= end + 100; // small tolerance
}

function readPixelData(
  view: DataView,
  offset: number,
  width: number,
  height: number,
  depth: number,
  compression: number,
): Uint8ClampedArray | null {
  const totalPixels = width * height;

  if (depth === 8 && compression === 0) {
    // Raw 8-bit grayscale
    if (offset + totalPixels > view.byteLength) return null;
    const data = new Uint8ClampedArray(totalPixels);
    for (let i = 0; i < totalPixels; i++) {
      data[i] = view.getUint8(offset + i);
    }
    return data;
  }

  if (depth === 8 && compression === 1) {
    return decompressRLE(view, offset, width, height);
  }

  if (depth === 16 && compression === 0) {
    // Raw 16-bit, downsample to 8-bit
    if (offset + totalPixels * 2 > view.byteLength) return null;
    const data = new Uint8ClampedArray(totalPixels);
    for (let i = 0; i < totalPixels; i++) {
      const val16 = view.getUint16(offset + i * 2);
      data[i] = val16 >> 8;
    }
    return data;
  }

  if (depth === 16 && compression === 1) {
    return decompressRLE16(view, offset, width, height);
  }

  return null;
}

function decompressRLE(
  view: DataView,
  startOffset: number,
  width: number,
  height: number,
): Uint8ClampedArray | null {
  let offset = startOffset;

  // Row byte counts come first as height uint16 values
  if (offset + height * 2 > view.byteLength) return null;
  const rowByteCounts: number[] = [];
  for (let row = 0; row < height; row++) {
    rowByteCounts.push(view.getUint16(offset));
    offset += 2;
  }

  const data = new Uint8ClampedArray(width * height);
  let pixelOffset = 0;

  for (let row = 0; row < height; row++) {
    const rowBytes = rowByteCounts[row] ?? 0;
    const rowEnd = offset + rowBytes;
    if (rowEnd > view.byteLength) return null;

    let rowPixels = 0;
    while (offset < rowEnd && rowPixels < width) {
      const n = view.getInt8(offset);
      offset += 1;

      if (n >= 0) {
        // Literal: copy n+1 bytes
        const count = n + 1;
        for (let i = 0; i < count && rowPixels < width; i++) {
          if (offset >= view.byteLength) return null;
          data[pixelOffset + rowPixels] = view.getUint8(offset);
          offset += 1;
          rowPixels++;
        }
      } else if (n === -128) {
        // No-op
      } else {
        // Repeat: next byte repeated 1-n times
        const count = 1 - n;
        if (offset >= view.byteLength) return null;
        const val = view.getUint8(offset);
        offset += 1;
        for (let i = 0; i < count && rowPixels < width; i++) {
          data[pixelOffset + rowPixels] = val;
          rowPixels++;
        }
      }
    }

    offset = rowEnd;
    pixelOffset += width;
  }

  return data;
}

function decompressRLE16(
  view: DataView,
  startOffset: number,
  width: number,
  height: number,
): Uint8ClampedArray | null {
  let offset = startOffset;

  // Row byte counts
  if (offset + height * 2 > view.byteLength) return null;
  const rowByteCounts: number[] = [];
  for (let row = 0; row < height; row++) {
    rowByteCounts.push(view.getUint16(offset));
    offset += 2;
  }

  const data = new Uint8ClampedArray(width * height);
  let pixelOffset = 0;

  for (let row = 0; row < height; row++) {
    const rowBytes16 = rowByteCounts[row] ?? 0;
    const rowEnd = offset + rowBytes16;
    if (rowEnd > view.byteLength) return null;

    // Decompress row into 16-bit values, then downsample
    const row16: number[] = [];
    while (offset < rowEnd && row16.length < width) {
      const n = view.getInt8(offset);
      offset += 1;

      if (n >= 0) {
        const count = n + 1;
        for (let i = 0; i < count && row16.length < width; i++) {
          if (offset + 1 >= view.byteLength) return null;
          row16.push(view.getUint16(offset));
          offset += 2;
        }
      } else if (n === -128) {
        // No-op
      } else {
        const count = 1 - n;
        if (offset + 1 >= view.byteLength) return null;
        const val = view.getUint16(offset);
        offset += 2;
        for (let i = 0; i < count && row16.length < width; i++) {
          row16.push(val);
        }
      }
    }

    for (let i = 0; i < row16.length; i++) {
      data[pixelOffset + i] = (row16[i] ?? 0) >> 8;
    }

    offset = rowEnd;
    pixelOffset += width;
  }

  return data;
}

function readUtf16BE(
  view: DataView,
  offset: number,
  charCount: number,
): string {
  const chars: string[] = [];
  for (let i = 0; i < charCount; i++) {
    const code = view.getUint16(offset + i * 2);
    if (code === 0) break; // Null terminator
    chars.push(String.fromCharCode(code));
  }
  return chars.join('');
}
