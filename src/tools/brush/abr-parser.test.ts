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

  test('returns empty array for unknown version', () => {
    const { buffer, view } = makeDataView(2);
    view.setUint16(0, 99);
    expect(parseABR(buffer)).toEqual([]);
  });

  describe('v1 format', () => {
    test('single sampled brush with Pascal string name', () => {
      const width = 4;
      const height = 4;
      const pixelCount = width * height;
      const nameStr = 'Dot';
      const nameLen = nameStr.length;

      const chunkSize = 4 + 2 + 1 + nameLen + 1 + 8 + 2 + 1 + pixelCount;
      const totalSize = 2 + 2 + 4 + chunkSize;
      const { buffer, view } = makeDataView(totalSize);
      let offset = 0;

      view.setUint16(offset, 1); offset += 2;
      view.setUint16(offset, 2); offset += 2;
      view.setUint32(offset, chunkSize); offset += 4;
      view.setUint32(offset, 0); offset += 4;
      view.setUint16(offset, 30); offset += 2;

      view.setUint8(offset, nameLen); offset += 1;
      for (let i = 0; i < nameLen; i++) {
        view.setUint8(offset + i, nameStr.charCodeAt(i));
      }
      offset += nameLen;

      view.setUint8(offset, 0); offset += 1;
      view.setUint16(offset, 0); offset += 2;
      view.setUint16(offset, 0); offset += 2;
      view.setUint16(offset, height); offset += 2;
      view.setUint16(offset, width); offset += 2;
      view.setUint16(offset, 8); offset += 2;
      view.setUint8(offset, 0); offset += 1;

      for (let i = 0; i < pixelCount; i++) {
        view.setUint8(offset + i, 255);
      }

      const result = parseABR(buffer);
      expect(result).toHaveLength(1);
      expect(result[0]!.name).toBe('Dot');
      expect(result[0]!.width).toBe(4);
      expect(result[0]!.height).toBe(4);
      expect(result[0]!.spacing).toBe(30);
      expect(result[0]!.data[0]).toBe(255);
    });
  });

  describe('v2 format', () => {
    test('single computed brush is skipped', () => {
      const { buffer, view } = makeDataView(2 + 2 + 4 + 4);
      let offset = 0;
      view.setUint16(offset, 2); offset += 2;
      view.setUint16(offset, 1); offset += 2;
      view.setUint32(offset, 4); offset += 4;
      view.setUint32(offset, 0);

      const result = parseABR(buffer);
      expect(result).toEqual([]);
    });

    test('single sampled brush with raw 8-bit pixels', () => {
      const width = 4;
      const height = 4;
      const pixelCount = width * height;
      const chunkSize = 4 + 2 + 2 + 1 + 8 + 2 + 1 + pixelCount;
      const totalSize = 2 + 2 + 4 + chunkSize;
      const { buffer, view } = makeDataView(totalSize);
      let offset = 0;

      view.setUint16(offset, 2); offset += 2;
      view.setUint16(offset, 2); offset += 2;
      view.setUint32(offset, chunkSize); offset += 4;
      view.setUint32(offset, 0); offset += 4;
      view.setUint16(offset, 25); offset += 2;
      view.setUint16(offset, 0); offset += 2;
      view.setUint8(offset, 1); offset += 1;
      view.setUint16(offset, 0); offset += 2;
      view.setUint16(offset, 0); offset += 2;
      view.setUint16(offset, height); offset += 2;
      view.setUint16(offset, width); offset += 2;
      view.setUint16(offset, 8); offset += 2;
      view.setUint8(offset, 0); offset += 1;

      for (let i = 0; i < pixelCount; i++) {
        view.setUint8(offset + i, i * 16);
      }

      const result = parseABR(buffer);
      expect(result).toHaveLength(1);
      expect(result[0]!.width).toBe(4);
      expect(result[0]!.height).toBe(4);
      expect(result[0]!.spacing).toBe(25);
      expect(result[0]!.data[0]).toBe(0);
      expect(result[0]!.data[1]).toBe(16);
      expect(result[0]!.data[15]).toBe(240);
    });

    test('sampled brush with UTF-16 name', () => {
      const width = 2;
      const height = 2;
      const pixelCount = width * height;
      const nameChars = 4;
      const chunkSize = 4 + 2 + 2 + nameChars * 2 + 1 + 8 + 2 + 1 + pixelCount;
      const totalSize = 2 + 2 + 4 + chunkSize;
      const { buffer, view } = makeDataView(totalSize);
      let offset = 0;

      view.setUint16(offset, 2); offset += 2;
      view.setUint16(offset, 2); offset += 2;
      view.setUint32(offset, chunkSize); offset += 4;
      view.setUint32(offset, 0); offset += 4;
      view.setUint16(offset, 50); offset += 2;
      view.setUint16(offset, nameChars); offset += 2;

      const nameStr = 'Test';
      for (let i = 0; i < nameChars; i++) {
        view.setUint16(offset, nameStr.charCodeAt(i)); offset += 2;
      }

      view.setUint8(offset, 0); offset += 1;
      view.setUint16(offset, 0); offset += 2;
      view.setUint16(offset, 0); offset += 2;
      view.setUint16(offset, height); offset += 2;
      view.setUint16(offset, width); offset += 2;
      view.setUint16(offset, 8); offset += 2;
      view.setUint8(offset, 0); offset += 1;

      for (let i = 0; i < pixelCount; i++) {
        view.setUint8(offset + i, 128);
      }

      const result = parseABR(buffer);
      expect(result).toHaveLength(1);
      expect(result[0]!.name).toBe('Test');
    });

    test('raw 16-bit depth downsamples to 8-bit', () => {
      const width = 2;
      const height = 2;
      const pixelCount = width * height;
      const chunkSize = 4 + 2 + 2 + 1 + 8 + 2 + 1 + pixelCount * 2;
      const totalSize = 2 + 2 + 4 + chunkSize;
      const { buffer, view } = makeDataView(totalSize);
      let offset = 0;

      view.setUint16(offset, 2); offset += 2;
      view.setUint16(offset, 2); offset += 2;
      view.setUint32(offset, chunkSize); offset += 4;
      view.setUint32(offset, 0); offset += 4;
      view.setUint16(offset, 25); offset += 2;
      view.setUint16(offset, 0); offset += 2;
      view.setUint8(offset, 0); offset += 1;
      view.setUint16(offset, 0); offset += 2;
      view.setUint16(offset, 0); offset += 2;
      view.setUint16(offset, height); offset += 2;
      view.setUint16(offset, width); offset += 2;
      view.setUint16(offset, 16); offset += 2;
      view.setUint8(offset, 0); offset += 1;

      view.setUint16(offset, 0x8000); offset += 2;
      view.setUint16(offset, 0xFF00); offset += 2;
      view.setUint16(offset, 0x0000); offset += 2;
      view.setUint16(offset, 0x4000); offset += 2;

      const result = parseABR(buffer);
      expect(result).toHaveLength(1);
      expect(result[0]!.data[0]).toBe(0x80);
      expect(result[0]!.data[1]).toBe(0xFF);
      expect(result[0]!.data[2]).toBe(0x00);
      expect(result[0]!.data[3]).toBe(0x40);
    });

    test('RLE compressed 8-bit brush', () => {
      const width = 4;
      const height = 2;

      // RLE data for 2 rows of 4 pixels each:
      // Row 0: repeat 0xAA x4 → control byte = -3 (0xFD), value = 0xAA → 2 bytes
      // Row 1: literal [1,2,3,4] → control byte = 3, then 4 bytes → 5 bytes
      const row0Bytes = 2;
      const row1Bytes = 5;
      const rleData = [
        // Row byte counts (2 x uint16)
        0, row0Bytes, 0, row1Bytes,
        // Row 0: repeat 0xAA x4
        0xFD, 0xAA,
        // Row 1: literal 4 bytes
        3, 1, 2, 3, 4,
      ];

      const chunkSize = 4 + 2 + 2 + 1 + 8 + 2 + 1 + rleData.length;
      const totalSize = 2 + 2 + 4 + chunkSize;
      const { buffer, view } = makeDataView(totalSize);
      let offset = 0;

      view.setUint16(offset, 2); offset += 2;
      view.setUint16(offset, 2); offset += 2;
      view.setUint32(offset, chunkSize); offset += 4;
      view.setUint32(offset, 0); offset += 4;
      view.setUint16(offset, 25); offset += 2;
      view.setUint16(offset, 0); offset += 2;
      view.setUint8(offset, 0); offset += 1;
      view.setUint16(offset, 0); offset += 2;
      view.setUint16(offset, 0); offset += 2;
      view.setUint16(offset, height); offset += 2;
      view.setUint16(offset, width); offset += 2;
      view.setUint16(offset, 8); offset += 2;
      view.setUint8(offset, 1); offset += 1;

      for (const byte of rleData) {
        view.setUint8(offset, byte); offset += 1;
      }

      const result = parseABR(buffer);
      expect(result).toHaveLength(1);
      expect(result[0]!.width).toBe(4);
      expect(result[0]!.height).toBe(2);
      expect(Array.from(result[0]!.data)).toEqual([0xAA, 0xAA, 0xAA, 0xAA, 1, 2, 3, 4]);
    });

    test('multiple brushes in one file', () => {
      const width = 2;
      const height = 2;
      const pixelCount = width * height;
      const chunkSize = 4 + 2 + 2 + 1 + 8 + 2 + 1 + pixelCount;
      const totalSize = 2 + 2 * (2 + 4 + chunkSize);
      const { buffer, view } = makeDataView(totalSize);
      let offset = 0;

      view.setUint16(offset, 2); offset += 2;

      for (let b = 0; b < 2; b++) {
        view.setUint16(offset, 2); offset += 2;
        view.setUint32(offset, chunkSize); offset += 4;
        view.setUint32(offset, 0); offset += 4;
        view.setUint16(offset, 25); offset += 2;
        view.setUint16(offset, 0); offset += 2;
        view.setUint8(offset, 0); offset += 1;
        view.setUint16(offset, 0); offset += 2;
        view.setUint16(offset, 0); offset += 2;
        view.setUint16(offset, height); offset += 2;
        view.setUint16(offset, width); offset += 2;
        view.setUint16(offset, 8); offset += 2;
        view.setUint8(offset, 0); offset += 1;
        for (let i = 0; i < pixelCount; i++) {
          view.setUint8(offset + i, (b + 1) * 50);
        }
        offset += pixelCount;
      }

      const result = parseABR(buffer);
      expect(result).toHaveLength(2);
      expect(result[0]!.data[0]).toBe(50);
      expect(result[1]!.data[0]).toBe(100);
    });
  });

  describe('v6+ format', () => {
    test('samp block with single brush using int32 bounds', () => {
      const width = 20;
      const height = 20;
      const pixelCount = width * height;

      const uuidLen = 5;
      const paddingLen = 3;
      const sampleDataSize = uuidLen + paddingLen + 16 + 2 + 1 + pixelCount;
      const sampBlockSize = 4 + sampleDataSize;
      const totalSize = 2 + 2 + 4 + 4 + 4 + sampBlockSize;
      const { buffer, view } = makeDataView(totalSize);
      let offset = 0;

      view.setUint16(offset, 6); offset += 2;
      view.setUint16(offset, 2); offset += 2;

      const sig = '8BIMsamp';
      for (let i = 0; i < 8; i++) view.setUint8(offset + i, sig.charCodeAt(i));
      offset += 8;

      view.setUint32(offset, sampBlockSize); offset += 4;
      view.setUint32(offset, sampleDataSize); offset += 4;

      for (let i = 0; i < 4; i++) view.setUint8(offset + i, 'test'.charCodeAt(i));
      offset += 4;
      view.setUint8(offset, 0); offset += 1;
      offset += paddingLen;

      view.setInt32(offset, 0); offset += 4;
      view.setInt32(offset, 0); offset += 4;
      view.setInt32(offset, height); offset += 4;
      view.setInt32(offset, width); offset += 4;
      view.setUint16(offset, 8); offset += 2;
      view.setUint8(offset, 0); offset += 1;

      for (let i = 0; i < pixelCount; i++) {
        view.setUint8(offset + i, 128 + (i % 128));
      }

      const result = parseABR(buffer);
      expect(result).toHaveLength(1);
      expect(result[0]!.width).toBe(20);
      expect(result[0]!.height).toBe(20);
      expect(result[0]!.data.length).toBe(400);
    });

    test('v6 with missing 8BIM signature returns empty', () => {
      const { buffer, view } = makeDataView(10);
      view.setUint16(0, 6);
      view.setUint32(2, 1);
      expect(parseABR(buffer)).toEqual([]);
    });

    test('version 7 is parsed as v6+ format', () => {
      const { buffer, view } = makeDataView(6);
      view.setUint16(0, 7);
      view.setUint16(2, 1);
      const result = parseABR(buffer);
      expect(result).toEqual([]);
    });

    test('version 10 is parsed as v6+ format', () => {
      const { buffer, view } = makeDataView(6);
      view.setUint16(0, 10);
      view.setUint16(2, 1);
      const result = parseABR(buffer);
      expect(result).toEqual([]);
    });
  });

  describe('error handling', () => {
    test('truncated buffer beyond chunk size returns empty', () => {
      const { buffer, view } = makeDataView(8);
      view.setUint16(0, 2);
      view.setUint16(2, 2);
      view.setUint32(4, 9999);
      expect(parseABR(buffer)).toEqual([]);
    });

    test('zero-size bounds produce no brush', () => {
      const chunkSize = 4 + 2 + 2 + 1 + 8 + 2 + 1;
      const totalSize = 2 + 2 + 4 + chunkSize;
      const { buffer, view } = makeDataView(totalSize);
      let offset = 0;

      view.setUint16(offset, 2); offset += 2;
      view.setUint16(offset, 2); offset += 2;
      view.setUint32(offset, chunkSize); offset += 4;
      view.setUint32(offset, 0); offset += 4;
      view.setUint16(offset, 25); offset += 2;
      view.setUint16(offset, 0); offset += 2;
      view.setUint8(offset, 0); offset += 1;
      // bounds: top=0, left=0, bottom=0, right=0 (zero size)
      view.setUint16(offset, 0); offset += 2;
      view.setUint16(offset, 0); offset += 2;
      view.setUint16(offset, 0); offset += 2;
      view.setUint16(offset, 0); offset += 2;
      view.setUint16(offset, 8); offset += 2;
      view.setUint8(offset, 0);

      expect(parseABR(buffer)).toEqual([]);
    });

    test('random bytes do not throw', () => {
      const sizes = [4, 10, 50, 100, 256];
      for (const size of sizes) {
        const buffer = new ArrayBuffer(size);
        const arr = new Uint8Array(buffer);
        for (let i = 0; i < size; i++) {
          arr[i] = Math.floor(Math.random() * 256);
        }
        expect(() => parseABR(buffer)).not.toThrow();
      }
    });

    test('truncated mid-pixel returns partial results', () => {
      const width = 4;
      const height = 4;
      const chunkSize = 4 + 2 + 2 + 1 + 8 + 2 + 1 + 8;
      const totalSize = 2 + 2 + 4 + chunkSize;
      const { buffer, view } = makeDataView(totalSize);
      let offset = 0;

      view.setUint16(offset, 2); offset += 2;
      view.setUint16(offset, 2); offset += 2;
      view.setUint32(offset, chunkSize); offset += 4;
      view.setUint32(offset, 0); offset += 4;
      view.setUint16(offset, 25); offset += 2;
      view.setUint16(offset, 0); offset += 2;
      view.setUint8(offset, 0); offset += 1;
      view.setUint16(offset, 0); offset += 2;
      view.setUint16(offset, 0); offset += 2;
      view.setUint16(offset, height); offset += 2;
      view.setUint16(offset, width); offset += 2;
      view.setUint16(offset, 8); offset += 2;
      view.setUint8(offset, 0); offset += 1;
      // Only 8 bytes of pixel data instead of 16 needed
      for (let i = 0; i < 8; i++) {
        view.setUint8(offset + i, 128);
      }

      const result = parseABR(buffer);
      expect(result).toEqual([]);
    });
  });
});
