import { describe, expect, it } from 'vitest';
import { dngSize, pngSize } from './image-header-size';

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

describe('pngSize', () => {
  it("reads the IHDR's width and height", () => {
    expect(pngSize(png(17504, 3440))).toEqual({ width: 17504, height: 3440 });
  });

  it('is null for anything else', () => {
    expect(pngSize(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBeNull();
    expect(pngSize(png(17504, 3440).slice(0, 20))).toBeNull();
  });
});

type Entry = [tag: number, type: 3 | 4 | 5, values: number[]];

/**
 * A little-endian TIFF header (no image data): IFD0's entries, and sub-IFDs
 * whose offsets it lists under tag 330. Rationals are written as n/1.
 */
function tiff(ifd0: Entry[], subs: Entry[][] = []): Uint8Array {
  const bytes = new Uint8Array(4096);
  const view = new DataView(bytes.buffer);
  bytes.set([0x49, 0x49]);
  view.setUint16(2, 42, true);
  let free = 2048;
  const writeIfd = (at: number, entries: Entry[]) => {
    view.setUint16(at, entries.length, true);
    entries.forEach(([tag, type, values], i) => {
      const e = at + 2 + i * 12;
      view.setUint16(e, tag, true);
      view.setUint16(e + 2, type, true);
      view.setUint32(e + 4, values.length, true);
      const size = type === 3 ? 2 : type === 4 ? 4 : 8;
      const out = values.length * size <= 4 ? e + 8 : free;
      if (out === free) {
        view.setUint32(e + 8, free, true);
        free += values.length * size;
      }
      values.forEach((v, k) => {
        if (type === 3) view.setUint16(out + k * 2, v, true);
        else if (type === 4) view.setUint32(out + k * 4, v, true);
        else {
          view.setUint32(out + k * 8, v, true);
          view.setUint32(out + k * 8 + 4, 1, true);
        }
      });
    });
  };
  const subOffsets = subs.map((_, i) => 512 + i * 256);
  view.setUint32(4, 8, true);
  writeIfd(8, subs.length > 0 ? [...ifd0, [330, 4, subOffsets]] : ifd0);
  subs.forEach((sub, i) => writeIfd(subOffsets[i] ?? 0, sub));
  return bytes;
}

const thumbnail: Entry[] = [[254, 4, [1]], [256, 4, [256]], [257, 4, [171]], [262, 3, [2]]];
const raw = (width: number, height: number, more: Entry[] = []): Entry[] => [[254, 4, [0]], [256, 4, [width]], [257, 4, [height]], [262, 3, [32803]], ...more];

describe('dngSize', () => {
  it("is the main raw sub-IFD's size, not the thumbnail's in IFD0", () => {
    expect(dngSize(tiff(thumbnail, [raw(8392, 5584)]))).toEqual({ width: 8392, height: 5584 });
  });

  it('keeps the active area and, inside it, a whole-pixel default crop', () => {
    const active: Entry = [50829, 4, [0, 0, 5584, 8392]];
    expect(dngSize(tiff(thumbnail, [raw(8400, 5600, [active])]))).toEqual({ width: 8392, height: 5584 });
    const crop: Entry[] = [[50719, 5, [12, 0]], [50720, 5, [8368, 5584]]];
    expect(dngSize(tiff(thumbnail, [raw(8400, 5600, [active, ...crop])]))).toEqual({ width: 8368, height: 5584 });
    // At a default scale other than 1 the crop is not applied, as the engine's decoder does.
    expect(dngSize(tiff(thumbnail, [raw(8400, 5600, [active, ...crop, [50718, 5, [2, 1]]])]))).toEqual({ width: 8392, height: 5584 });
  });

  it('swaps the sides for orientations 5 to 8', () => {
    expect(dngSize(tiff([...thumbnail, [274, 3, [6]]], [raw(8392, 5584)]))).toEqual({ width: 5584, height: 8392 });
    expect(dngSize(tiff([...thumbnail, [274, 3, [3]]], [raw(8392, 5584)]))).toEqual({ width: 8392, height: 5584 });
  });

  it('takes the main image from IFD0 when it is there', () => {
    expect(dngSize(tiff(raw(4000, 3000)))).toEqual({ width: 4000, height: 3000 });
  });

  it('is null for what is not a TIFF, or an active area outside the image', () => {
    expect(dngSize(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull();
    expect(dngSize(tiff(thumbnail, [raw(100, 100, [[50829, 4, [0, 0, 200, 200]]])]))).toBeNull();
  });
});
