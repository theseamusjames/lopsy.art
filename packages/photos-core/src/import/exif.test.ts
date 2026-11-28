import { describe, expect, it } from 'vitest';
import { detectFormat } from './detect-format';
import { formatExifDate, formatExposureTime, readMetadata } from './exif';
import { inspectImage } from './inspect';
import { remainingOrientation } from './orientation';
import { buildJpeg, buildPng, buildTiff, buildWebp } from './test-support/builders';
import type { EntrySpec, IfdSpec } from './test-support/builders';

function exifIfd0(orientation: number, littleEndian = true): Uint8Array {
  const spec: IfdSpec = {
    entries: [
      { tag: 0x010f, ascii: 'FUJIFILM' },
      { tag: 0x0110, ascii: 'X100VI  ' },
      { tag: 0x0112, type: 3, values: [orientation] },
      {
        tag: 0x8769,
        ifds: [
          {
            entries: [
              { tag: 0x829a, type: 5, rationals: [[1, 250]] },
              { tag: 0x829d, type: 5, rationals: [[56, 10]] },
              { tag: 0x8827, type: 3, values: [800] },
              { tag: 0x9003, ascii: '2026:11:14 16:02:11' },
              { tag: 0x9011, ascii: '+01:00' },
              { tag: 0x920a, type: 5, rationals: [[230, 10]] },
              { tag: 0xa434, ascii: 'XF23mmF2 R WR' },
            ],
          },
        ],
      },
      {
        tag: 0x8825,
        ifds: [
          {
            entries: [
              { tag: 0x0001, ascii: 'S' },
              { tag: 0x0002, type: 5, rationals: [[33, 1], [51, 1], [3150, 100]] },
              { tag: 0x0003, ascii: 'W' },
              { tag: 0x0004, type: 5, rationals: [[151, 1], [12, 1], [36, 1]] },
              { tag: 0x0005, type: 1, values: [1] },
              { tag: 0x0006, type: 5, rationals: [[125, 10]] },
            ],
          },
        ],
      },
    ],
  };
  return buildTiff(spec, littleEndian);
}

describe('detectFormat', () => {
  const ascii = (s: string) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));

  it('identifies each supported format by magic bytes', () => {
    expect(detectFormat(ascii('FUJIFILMCCD-RAW 0201FF179503'))).toBe('raf');
    expect(detectFormat(ascii('LOPSY\0\x03rest'))).toBe('lopsy');
    expect(detectFormat(buildJpeg({ width: 4, height: 3 }))).toBe('jpeg');
    expect(detectFormat(buildPng({ width: 4, height: 3 }))).toBe('png');
    expect(detectFormat(buildWebp({ width: 4, height: 3, kind: 'vp8l' }))).toBe('webp');
    expect(detectFormat(buildTiff({ entries: [{ tag: 0xc612, type: 1, values: [1, 4, 0, 0] }] }))).toBe('dng');
    expect(detectFormat(buildTiff({ entries: [{ tag: 0xc612, type: 1, values: [1, 6, 0, 0] }] }, false))).toBe('dng');
  });

  it('returns null for everything else', () => {
    expect(detectFormat(new Uint8Array())).toBeNull();
    expect(detectFormat(ascii('GIF89a'))).toBeNull();
    expect(detectFormat(buildTiff({ entries: [{ tag: 0x0100, type: 4, values: [10] }] }))).toBeNull();
    expect(detectFormat(ascii('FUJIFILM'))).toBeNull();
    expect(detectFormat(ascii('LOPSY'))).toBeNull();
  });

  it('takes a Sony-made TIFF for an ARW only when it holds raw (CFA) data and is not a DNG', () => {
    const sony: EntrySpec = { tag: 0x010f, ascii: 'SONY' };
    // An ordinary RGB TIFF that names Sony (as software that copies the camera's EXIF writes) is not one.
    const rgb: EntrySpec[] = [sony, { tag: 0x0100, type: 4, values: [10] }, { tag: 0x0101, type: 4, values: [10] }, { tag: 0x0106, type: 3, values: [2] }];
    expect(detectFormat(buildTiff({ entries: rgb }))).toBeNull();
    // A DNG that a Sony camera or Sony's software made stays a DNG.
    expect(detectFormat(buildTiff({ entries: [sony, { tag: 0xc612, type: 1, values: [1, 4, 0, 0] }] }))).toBe('dng');
  });
});

describe('Canon and Nikon RAW, by their bytes', () => {
  const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
  /** A TIFF header with Canon's "CR" and major version after it, as a CR2 starts. */
  function cr2Header(version: number, littleEndian = true): Uint8Array {
    const tiff = buildTiff({ entries: [{ tag: 0x010f, ascii: 'Canon' }, { tag: 0x0110, ascii: 'Canon EOS 5D Mark III' }] }, littleEndian);
    const out = new Uint8Array(tiff.length + 8);
    out.set(tiff.subarray(0, 8), 0);
    out.set([0x43, 0x52, version, 0, 0, 0, 0, 0], 8);
    out.set(tiff.subarray(8), 16);
    // The first IFD moved 8 bytes on.
    new DataView(out.buffer).setUint32(4, new DataView(tiff.buffer).getUint32(4, littleEndian) + 8, littleEndian);
    return out;
  }

  it('takes a little-endian TIFF with CR and version 2 after its header for a CR2', () => {
    expect(detectFormat(cr2Header(2))).toBe('cr2');
    // Anything else in that place, or a big-endian header, is not one.
    expect(detectFormat(cr2Header(3))).toBeNull();
    expect(detectFormat(cr2Header(2, false))).toBeNull();
  });

  it('does not take a CR3 (an ISO media file with the brand "crx ") for a photo it reads', () => {
    const cr3 = new Uint8Array(64);
    cr3.set([0, 0, 0, 24, ...ascii('ftypcrx '), 0, 0, 0, 1, ...ascii('crx isom')], 0);
    expect(detectFormat(cr3)).toBeNull();
  });

  const nikon: EntrySpec = { tag: 0x010f, ascii: 'NIKON CORPORATION' };
  const cfa: EntrySpec[] = [{ tag: 0x0100, type: 4, values: [10] }, { tag: 0x0101, type: 4, values: [10] }, { tag: 0x0106, type: 3, values: [32803] }];

  it('takes a Nikon-made TIFF that holds raw (CFA) data and is not a DNG for a NEF', () => {
    expect(detectFormat(buildTiff({ entries: [nikon, { tag: 0x0110, ascii: 'NIKON D850' }, ...cfa] }))).toBe('nef');
    expect(detectFormat(buildTiff({ entries: [nikon, { tag: 0x0110, ascii: 'NIKON D3' }, ...cfa] }, false))).toBe('nef');
    // An RGB TIFF that names Nikon (as Nikon's own software writes) is not one, and a DNG stays a DNG.
    const rgb: EntrySpec[] = [{ tag: 0x0100, type: 4, values: [10] }, { tag: 0x0101, type: 4, values: [10] }, { tag: 0x0106, type: 3, values: [2] }];
    expect(detectFormat(buildTiff({ entries: [nikon, ...rgb] }))).toBeNull();
    expect(detectFormat(buildTiff({ entries: [nikon, { tag: 0xc612, type: 1, values: [1, 4, 0, 0] }, ...cfa] }))).toBe('dng');
  });

  it("does not take a COOLPIX compact's NRW for a NEF: the engine does not decode one", () => {
    expect(detectFormat(buildTiff({ entries: [nikon, { tag: 0x0110, ascii: 'COOLPIX P950' }, ...cfa] }))).toBeNull();
  });
});

describe('formatting', () => {
  it('writes shutter speeds for people', () => {
    expect(formatExposureTime(1, 250)).toBe('1/250');
    expect(formatExposureTime(10, 2500)).toBe('1/250');
    expect(formatExposureTime(5, 2)).toBe('2.5');
    expect(formatExposureTime(30, 1)).toBe('30');
    expect(formatExposureTime(1, 3)).toBe('1/3');
    expect(formatExposureTime(4, 10)).toBe('0.4');
    expect(formatExposureTime(0, 1)).toBeNull();
    expect(formatExposureTime(1, 0)).toBeNull();
  });

  it('writes capture dates as ISO-like local times', () => {
    expect(formatExifDate('2026:11:14 16:02:11', null)).toBe('2026-11-14T16:02:11');
    expect(formatExifDate('2026:11:14 16:02:11', '-05:00')).toBe('2026-11-14T16:02:11-05:00');
    expect(formatExifDate('2026:11:14 16:02:11', 'junk')).toBe('2026-11-14T16:02:11');
    expect(formatExifDate('0000:00:00 00:00:00', null)).toBeNull();
    expect(formatExifDate('    :  :     :  :  ', null)).toBeNull();
  });
});

describe('readMetadata', () => {
  it('reads EXIF from a JPEG APP1 (little-endian)', () => {
    const bytes = buildJpeg({ width: 6000, height: 4000, exif: exifIfd0(6) });
    const m = readMetadata(bytes);
    expect(m).toEqual({
      format: 'jpeg',
      mimeType: 'image/jpeg',
      width: 4000,
      height: 6000,
      orientation: 6,
      capturedAt: '2026-11-14T16:02:11+01:00',
      camera: { make: 'FUJIFILM', model: 'X100VI' },
      lens: 'XF23mmF2 R WR',
      exposure: { iso: 800, shutter: '1/250', aperture: 5.6, focalLength: 23 },
      gps: { lat: -33.85875, lon: -151.21, alt: -12.5 },
    });
    expect(m?.gps?.lat).toBeCloseTo(-33.858750, 5);
  });

  it('reads EXIF from a big-endian APP1', () => {
    const m = readMetadata(buildJpeg({ width: 600, height: 400, exif: exifIfd0(1, false) }));
    expect(m?.width).toBe(600);
    expect(m?.camera?.model).toBe('X100VI');
    expect(m?.exposure?.shutter).toBe('1/250');
  });

  it('handles a JPEG without EXIF', () => {
    const m = readMetadata(buildJpeg({ width: 10, height: 20 }));
    expect(m).toMatchObject({ width: 10, height: 20, orientation: 1, camera: null, exposure: null, gps: null, capturedAt: null });
  });

  it('reads PNG size and eXIf', () => {
    const m = readMetadata(buildPng({ width: 300, height: 200, exif: exifIfd0(8) }));
    expect(m).toMatchObject({ format: 'png', mimeType: 'image/png', width: 200, height: 300, orientation: 8 });
    expect(m?.lens).toBe('XF23mmF2 R WR');
  });

  it('reads WebP sizes and the EXIF chunk', () => {
    expect(readMetadata(buildWebp({ width: 1234, height: 567, kind: 'vp8l' }))).toMatchObject({ width: 1234, height: 567 });
    const m = readMetadata(buildWebp({ width: 4000, height: 3000, kind: 'vp8x', exif: exifIfd0(1) }));
    expect(m).toMatchObject({ format: 'webp', width: 4000, height: 3000, capturedAt: '2026-11-14T16:02:11+01:00' });
  });

  it('reads a DNG through its IFDs and finds its largest JPEG preview', () => {
    const small = buildJpeg({ width: 160, height: 120 });
    const large = buildJpeg({ width: 1024, height: 768 });
    const lossless = buildJpeg({ width: 6000, height: 4000, frameMarker: 0xc3 });
    const dng = buildTiff(
      {
        entries: [
          { tag: 0x00fe, type: 4, values: [1] },
          { tag: 0x010f, ascii: 'Leica Camera AG' },
          { tag: 0x0110, ascii: 'Q3' },
          { tag: 0x0112, type: 3, values: [6] },
          { tag: 0x0103, type: 3, values: [7] },
          { tag: 0x0111, blob: small },
          { tag: 0x0117, type: 4, values: [small.length] },
          { tag: 0xc612, type: 1, values: [1, 4, 0, 0] },
          {
            tag: 0x014a,
            ifds: [
              {
                entries: [
                  { tag: 0x00fe, type: 4, values: [0] },
                  { tag: 0x0100, type: 4, values: [6040] },
                  { tag: 0x0101, type: 4, values: [4020] },
                  { tag: 0x0103, type: 3, values: [7] },
                  { tag: 0x0111, blob: lossless },
                  { tag: 0x0117, type: 4, values: [lossless.length] },
                  { tag: 0xc620, type: 4, values: [6000, 4000] },
                ],
              },
              {
                entries: [
                  { tag: 0x00fe, type: 4, values: [1] },
                  { tag: 0x0103, type: 3, values: [7] },
                  { tag: 0x0201, blob: large },
                  { tag: 0x0202, type: 4, values: [large.length] },
                ],
              },
            ],
          },
          { tag: 0x8769, ifds: [{ entries: [{ tag: 0x8827, type: 3, values: [100] }] }] },
        ],
      },
      false,
    );
    const inspected = inspectImage(dng);
    expect(inspected?.metadata).toMatchObject({
      format: 'dng',
      mimeType: 'image/x-adobe-dng',
      width: 4000,
      height: 6000,
      orientation: 6,
      camera: { make: 'Leica Camera AG', model: 'Q3' },
      exposure: { iso: 100 },
    });
    expect(inspected?.preview).toMatchObject({ width: 1024, height: 768, orientation: 6 });
    expect(inspected?.preview?.blob.size).toBe(large.length);
  });

  it('returns null for unsupported files and never throws on truncated ones', () => {
    expect(readMetadata(new Uint8Array([0, 1, 2, 3]))).toBeNull();
    const samples = [
      buildJpeg({ width: 6000, height: 4000, exif: exifIfd0(6) }),
      buildPng({ width: 3, height: 2, exif: exifIfd0(3) }),
      buildWebp({ width: 3, height: 2, kind: 'vp8x', exif: exifIfd0(3, false) }),
    ];
    for (const bytes of samples) {
      for (let n = 0; n < bytes.length; n += 3) {
        expect(() => inspectImage(bytes.slice(0, n))).not.toThrow();
      }
    }
  });
});

describe('preview orientation', () => {
  it('leaves nothing to apply when the JPEG carries the orientation itself', () => {
    const bytes = buildJpeg({ width: 600, height: 400, exif: exifIfd0(6) });
    const inspected = inspectImage(bytes);
    expect(inspected?.preview).toMatchObject({ width: 400, height: 600, orientation: 1 });
  });

  it('composes orientations', () => {
    for (let o = 1; o <= 8; o++) {
      expect(remainingOrientation(o, o)).toBe(1);
      expect(remainingOrientation(o, 1)).toBe(o);
    }
    expect(remainingOrientation(3, 6)).toBe(6);
    expect(remainingOrientation(8, 6)).toBe(3);
  });
});
