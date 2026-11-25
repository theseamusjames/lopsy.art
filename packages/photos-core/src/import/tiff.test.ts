import { describe, expect, it } from 'vitest';
import { buildTiff } from './test-support/builders';
import {
  collectImageIfds,
  getNumber,
  getNumbers,
  getRational,
  getString,
  openTiff,
  readIfd,
  readIfdChain,
  readPointedIfd,
} from './tiff';

const spec = {
  entries: [
    { tag: 0x010f, ascii: 'FUJIFILM  ' },
    { tag: 0x0112, type: 3 as const, values: [6] },
    { tag: 0x0100, type: 4 as const, values: [7728] },
    { tag: 0x829a, type: 5 as const, rationals: [[1, 250]] as const },
    { tag: 0x9999, type: 10 as const, rationals: [[-3, 2]] as const },
    { tag: 0x9998, type: 8 as const, values: [-5, 7] },
    { tag: 0x8769, ifds: [{ entries: [{ tag: 0x8827, type: 3 as const, values: [400] }] }] },
  ],
  next: { entries: [{ tag: 0x0100, type: 4 as const, values: [160] }] },
};

describe.each([
  ['little-endian', true],
  ['big-endian', false],
])('TIFF reader (%s)', (_name, littleEndian) => {
  const bytes = buildTiff(spec, littleEndian);
  const tiff = openTiff(bytes);

  it('opens the header', () => {
    expect(tiff).not.toBeNull();
    expect(tiff?.littleEndian).toBe(littleEndian);
  });

  it('reads values of every type', () => {
    if (!tiff) throw new Error('no tiff');
    const ifd0 = readIfd(tiff, tiff.firstIfd);
    if (!ifd0) throw new Error('no ifd0');
    expect(getString(tiff, ifd0, 0x010f)).toBe('FUJIFILM');
    expect(getNumber(tiff, ifd0, 0x0112)).toBe(6);
    expect(getNumber(tiff, ifd0, 0x0100)).toBe(7728);
    expect(getNumber(tiff, ifd0, 0x829a)).toBeCloseTo(0.004);
    expect(getRational(tiff, ifd0, 0x829a)).toEqual({ num: 1, den: 250 });
    expect(getNumber(tiff, ifd0, 0x9999)).toBe(-1.5);
    expect(getNumbers(tiff, ifd0, 0x9998)).toEqual([-5, 7]);
    expect(getNumber(tiff, ifd0, 0x1234)).toBeNull();
    const exif = readPointedIfd(tiff, ifd0, 0x8769);
    expect(exif && getNumber(tiff, exif, 0x8827)).toBe(400);
  });

  it('follows the IFD chain', () => {
    if (!tiff) throw new Error('no tiff');
    const chain = readIfdChain(tiff);
    expect(chain).toHaveLength(2);
    const ifd1 = chain[1];
    expect(ifd1 && getNumber(tiff, ifd1, 0x0100)).toBe(160);
  });
});

describe('TIFF reader on malformed input', () => {
  it('rejects what is not a TIFF', () => {
    expect(openTiff(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(openTiff(new Uint8Array([0x49, 0x49, 43, 0, 8, 0, 0, 0]))).toBeNull();
  });

  it('never throws on truncations or garbage', () => {
    const bytes = buildTiff(spec, false);
    for (let n = 0; n <= bytes.length; n++) {
      const cut = bytes.slice(0, n);
      const tiff = openTiff(cut);
      if (!tiff) continue;
      for (const ifd of collectImageIfds(tiff)) {
        for (const tag of ifd.entries.keys()) {
          getNumbers(tiff, ifd, tag);
          getString(tiff, ifd, tag);
          getRational(tiff, ifd, tag);
        }
      }
    }
    let seed = 7;
    for (let round = 0; round < 200; round++) {
      const noisy = bytes.slice();
      for (let k = 0; k < 6; k++) {
        seed = (seed * 1103515245 + 12345) >>> 0;
        noisy[seed % noisy.length] = seed >>> 24;
      }
      const tiff = openTiff(noisy);
      if (tiff) for (const ifd of collectImageIfds(tiff)) for (const tag of ifd.entries.keys()) getNumbers(tiff, ifd, tag);
    }
  });

  it('stops at an IFD loop', () => {
    const bytes = buildTiff({ entries: [{ tag: 0x0100, type: 4, values: [1] }] });
    const tiff = openTiff(bytes);
    if (!tiff) throw new Error('no tiff');
    // Point IFD0's next link back at itself.
    const nextAt = tiff.firstIfd + 2 + 12;
    new DataView(bytes.buffer).setUint32(nextAt, tiff.firstIfd, true);
    expect(readIfdChain(tiff)).toHaveLength(1);
  });
});
