import { describe, expect, it } from 'vitest';
import { imageMimeType, readImageSize } from './image-size';

function bytes(length: number, writes: Array<[number, number[]]>): Uint8Array {
  const out = new Uint8Array(length);
  for (const [offset, values] of writes) out.set(values, offset);
  return out;
}

const ascii = (text: string): number[] => [...text].map((ch) => ch.charCodeAt(0));

describe('readImageSize', () => {
  it('reads PNG dimensions from IHDR', () => {
    const png = bytes(32, [
      [0, [0x89, ...ascii('PNG'), 0x0d, 0x0a, 0x1a, 0x0a]],
      [16, [0, 0, 0x06, 0x40, 0, 0, 0x03, 0x84]],
    ]);
    expect(readImageSize(png)).toEqual({ width: 1600, height: 900 });
  });

  it('reads JPEG dimensions from the first SOF segment, skipping others', () => {
    const jpeg = bytes(40, [
      [0, [0xff, 0xd8]],
      [2, [0xff, 0xe0, 0x00, 0x04, 0, 0]],
      [8, [0xff, 0xc4, 0x00, 0x04, 0, 0]],
      [14, [0xff, 0xc2, 0x00, 0x11, 0x08, 0x02, 0xee, 0x04, 0xb0]],
    ]);
    expect(readImageSize(jpeg)).toEqual({ width: 1200, height: 750 });
  });

  it('reads lossy, lossless and extended WebP', () => {
    const header = [0, [...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP')]] as [number, number[]];
    const lossy = bytes(32, [header, [12, ascii('VP8 ')], [26, [0x40, 0x06, 0x84, 0x03]]]);
    expect(readImageSize(lossy)).toEqual({ width: 1600, height: 900 });

    // 14-bit (width - 1) then 14-bit (height - 1), little-endian.
    const packed = (1599) | (899 << 14);
    const lossless = bytes(32, [
      header,
      [12, ascii('VP8L')],
      [20, [0x2f, packed & 0xff, (packed >> 8) & 0xff, (packed >> 16) & 0xff, (packed >> 24) & 0xff]],
    ]);
    expect(readImageSize(lossless)).toEqual({ width: 1600, height: 900 });

    const extended = bytes(32, [header, [12, ascii('VP8X')], [24, [0x3f, 0x06, 0x00, 0x83, 0x03, 0x00]]]);
    expect(readImageSize(extended)).toEqual({ width: 1600, height: 900 });
  });

  it('reads GIF dimensions', () => {
    const gif = bytes(32, [[0, ascii('GIF89a')], [6, [0x40, 0x06, 0x84, 0x03]]]);
    expect(readImageSize(gif)).toEqual({ width: 1600, height: 900 });
  });

  it('returns null for unknown or truncated data', () => {
    expect(readImageSize(new Uint8Array(10))).toBeNull();
    expect(readImageSize(bytes(40, [[0, ascii('<svg')]]))).toBeNull();
    expect(readImageSize(bytes(30, [[0, [0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff]]]))).toBeNull();
  });
});

describe('imageMimeType', () => {
  it('maps supported extensions case-insensitively', () => {
    expect(imageMimeType('a.WEBP')).toBe('image/webp');
    expect(imageMimeType('a.jpeg')).toBe('image/jpeg');
    expect(imageMimeType('a.svg')).toBeNull();
    expect(imageMimeType('noext')).toBeNull();
  });
});
