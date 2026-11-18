import { describe, it, expect } from 'vitest';
import { rgba16BlobSize } from './layer-pixel-format';

describe('rgba16BlobSize (#1780)', () => {
  it('reads the full layer size from the 16-bit blob header', () => {
    const blob = new Uint8Array(32);
    const view = new DataView(blob.buffer);
    [3, 4, 10, 6, 640, 480].forEach((v, i) => view.setInt32(i * 4, v, true));
    expect(rgba16BlobSize(blob)).toEqual({ width: 640, height: 480 });
  });

  it('reads a blob that is a view into a larger buffer', () => {
    const buffer = new Uint8Array(40);
    const view = new DataView(buffer.buffer);
    [0, 0, 1, 1, 12, 34].forEach((v, i) => view.setInt32(8 + i * 4, v, true));
    expect(rgba16BlobSize(buffer.subarray(8))).toEqual({ width: 12, height: 34 });
  });

  it('is null for a blob too short to hold a header', () => {
    expect(rgba16BlobSize(new Uint8Array(12))).toBeNull();
  });
});
