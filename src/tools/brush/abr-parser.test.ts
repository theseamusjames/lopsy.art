import { describe, test, expect } from 'vitest';
import { parseABR } from './abr-parser';

function makeDataView(size: number): { buffer: ArrayBuffer; view: DataView } {
  const buffer = new ArrayBuffer(size);
  const view = new DataView(buffer);
  return { buffer, view };
}

describe('parseABR', () => {
  test('returns empty array for empty buffer', () => {
    const result = parseABR(new ArrayBuffer(0));
    expect(result).toEqual([]);
  });

  test('returns empty array for buffer too small for version', () => {
    const result = parseABR(new ArrayBuffer(1));
    expect(result).toEqual([]);
  });

  describe('v2 format', () => {
    test('single computed brush is skipped', () => {
      // Version 2, one computed brush (type=1)
      const { buffer, view } = makeDataView(2 + 2 + 4 + 4);
      let offset = 0;

      // version = 2
      view.setUint16(offset, 2);
      offset += 2;

      // brushType = 1 (computed)
      view.setUint16(offset, 1);
      offset += 2;

      // chunkSize = 4 (some dummy data)
      view.setUint32(offset, 4);
      offset += 4;

      // 4 bytes of dummy data
      view.setUint32(offset, 0);

      const result = parseABR(buffer);
      expect(result).toEqual([]);
    });

    test('single sampled brush', () => {
      // Build a v2 buffer with a 4x4 sampled brush, raw compression
      const width = 4;
      const height = 4;
      const pixelCount = width * height;

      // Chunk contents: miscInfo(4) + spacing(2) + nameLength(2) + name(0)
      //   + antiAlias(1) + bounds(8) + depth(2) + compression(1) + pixels(16)
      const chunkSize = 4 + 2 + 2 + 1 + 8 + 2 + 1 + pixelCount;
      const totalSize = 2 + 2 + 4 + chunkSize;
      const { buffer, view } = makeDataView(totalSize);
      let offset = 0;

      // version = 2
      view.setUint16(offset, 2);
      offset += 2;

      // brushType = 2 (sampled)
      view.setUint16(offset, 2);
      offset += 2;

      // chunkSize
      view.setUint32(offset, chunkSize);
      offset += 4;

      // miscInfo
      view.setUint32(offset, 0);
      offset += 4;

      // spacing = 25%
      view.setUint16(offset, 25);
      offset += 2;

      // nameLength = 0 (no name)
      view.setUint16(offset, 0);
      offset += 2;

      // antiAlias
      view.setUint8(offset, 1);
      offset += 1;

      // bounds: top=0, left=0, bottom=4, right=4
      view.setUint16(offset, 0);
      offset += 2;
      view.setUint16(offset, 0);
      offset += 2;
      view.setUint16(offset, height);
      offset += 2;
      view.setUint16(offset, width);
      offset += 2;

      // depth = 8
      view.setUint16(offset, 8);
      offset += 2;

      // compression = 0 (raw)
      view.setUint8(offset, 0);
      offset += 1;

      // Pixel data: gradient pattern
      for (let i = 0; i < pixelCount; i++) {
        view.setUint8(offset + i, i * 16);
      }

      const result = parseABR(buffer);
      expect(result).toHaveLength(1);

      const brush = result[0]!;
      expect(brush.width).toBe(4);
      expect(brush.height).toBe(4);
      expect(brush.spacing).toBe(25);
      expect(brush.data).toBeInstanceOf(Uint8ClampedArray);
      expect(brush.data.length).toBe(16);
      expect(brush.data[0]).toBe(0);
      expect(brush.data[1]).toBe(16);
      expect(brush.data[15]).toBe(240);
    });

    test('v2 sampled brush with UTF-16 name', () => {
      const width = 2;
      const height = 2;
      const pixelCount = width * height;
      const nameChars = 4; // "Test"

      const chunkSize =
        4 + 2 + 2 + nameChars * 2 + 1 + 8 + 2 + 1 + pixelCount;
      const totalSize = 2 + 2 + 4 + chunkSize;
      const { buffer, view } = makeDataView(totalSize);
      let offset = 0;

      view.setUint16(offset, 2);
      offset += 2;
      view.setUint16(offset, 2);
      offset += 2;
      view.setUint32(offset, chunkSize);
      offset += 4;
      view.setUint32(offset, 0);
      offset += 4;
      view.setUint16(offset, 50);
      offset += 2;

      // nameLength = 4
      view.setUint16(offset, nameChars);
      offset += 2;

      // "Test" in UTF-16BE
      const nameStr = 'Test';
      for (let i = 0; i < nameChars; i++) {
        view.setUint16(offset, nameStr.charCodeAt(i));
        offset += 2;
      }

      view.setUint8(offset, 0);
      offset += 1;
      view.setUint16(offset, 0);
      offset += 2;
      view.setUint16(offset, 0);
      offset += 2;
      view.setUint16(offset, height);
      offset += 2;
      view.setUint16(offset, width);
      offset += 2;
      view.setUint16(offset, 8);
      offset += 2;
      view.setUint8(offset, 0);
      offset += 1;

      for (let i = 0; i < pixelCount; i++) {
        view.setUint8(offset + i, 128);
      }

      const result = parseABR(buffer);
      expect(result).toHaveLength(1);
      expect(result[0]!.name).toBe('Test');
    });
  });

  describe('v6+ format', () => {
    test('samp block with single brush using int32 bounds', () => {
      const width = 20;
      const height = 20;
      const pixelCount = width * height;

      // Sample data: uuid+null(6) + padding(2) + int32 bounds(16) + depth(2) + compression(1) + raw pixels
      const uuidStr = 'test\0'; // 5 bytes + we manually set null
      const uuidLen = 5;
      const paddingLen = 3; // pad to align
      const sampleDataSize = uuidLen + paddingLen + 16 + 2 + 1 + pixelCount;

      // Samp block: sampleLength(4) + sampleData
      const sampBlockSize = 4 + sampleDataSize;

      // Total: version(2) + subVersion(2) + 8BIM(4) + type(4) + blockSize(4) + sampBlock
      const totalSize = 2 + 2 + 4 + 4 + 4 + sampBlockSize;
      const { buffer, view } = makeDataView(totalSize);
      let offset = 0;

      // version = 6
      view.setUint16(offset, 6); offset += 2;
      // subVersion = 2
      view.setUint16(offset, 2); offset += 2;

      // "8BIM"
      const sig = '8BIMsamp';
      for (let i = 0; i < 8; i++) view.setUint8(offset + i, sig.charCodeAt(i));
      offset += 8;

      // block size
      view.setUint32(offset, sampBlockSize); offset += 4;

      // sampleLength
      view.setUint32(offset, sampleDataSize); offset += 4;

      // UUID "test" + null
      for (let i = 0; i < 4; i++) view.setUint8(offset + i, 'test'.charCodeAt(i));
      offset += 4;
      view.setUint8(offset, 0); offset += 1; // null terminator

      // Padding (3 bytes of zeros to reach int32 bounds)
      offset += paddingLen;

      // int32 bounds: top=0, left=0, bottom=height, right=width
      view.setInt32(offset, 0); offset += 4;
      view.setInt32(offset, 0); offset += 4;
      view.setInt32(offset, height); offset += 4;
      view.setInt32(offset, width); offset += 4;

      // depth = 8
      view.setUint16(offset, 8); offset += 2;

      // compression = 0
      view.setUint8(offset, 0); offset += 1;

      // Pixel data
      for (let i = 0; i < pixelCount; i++) {
        view.setUint8(offset + i, 128 + (i % 128));
      }

      const result = parseABR(buffer);
      expect(result).toHaveLength(1);

      const brush = result[0]!;
      expect(brush.width).toBe(20);
      expect(brush.height).toBe(20);
      expect(brush.data).toBeInstanceOf(Uint8ClampedArray);
      expect(brush.data.length).toBe(400);
      expect(brush.data[0]).toBe(128);
    });
  });

  describe('error handling', () => {
    test('handles truncated buffer gracefully', () => {
      // Version 2 header but truncated before brush data
      const { buffer, view } = makeDataView(8);
      view.setUint16(0, 2); // version
      view.setUint16(2, 2); // brushType = sampled
      view.setUint32(4, 9999); // chunkSize way beyond buffer

      // Should not be added because chunkEnd > byteLength
      const result = parseABR(buffer);
      expect(result).toEqual([]);
    });

    test('handles unknown version gracefully', () => {
      const { buffer, view } = makeDataView(2);
      view.setUint16(0, 99);

      const result = parseABR(buffer);
      expect(result).toEqual([]);
    });

    test('handles v6 with missing 8BIM signature', () => {
      const { buffer, view } = makeDataView(10);
      view.setUint16(0, 6);
      view.setUint32(2, 1);
      // No valid 8BIM block follows

      const result = parseABR(buffer);
      expect(result).toEqual([]);
    });
  });
});
