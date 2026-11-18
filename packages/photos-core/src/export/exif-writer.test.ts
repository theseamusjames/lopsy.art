import { describe, expect, it } from 'vitest';
import { scanJpeg, scanPng, u32be } from '../import/containers';
import { readExifAt, readMetadata } from '../import/exif';
import { getString, openTiff, readIfd } from '../import/tiff';
import { buildPng } from '../import/test-support/builders';
import { crc32 } from './crc32';
import { applyExportMetadata, buildExportExif, insertJpegExif, insertPngExif, shutterToRational } from './exif-writer';
import { browserJpeg, testAsset } from './test-support/fixtures';
import { DEFAULT_EXPORT_SETTINGS } from './types';
import type { ExportSettings } from './types';

const settings = (s: Partial<ExportSettings> = {}): ExportSettings => ({
  ...DEFAULT_EXPORT_SETTINGS,
  copyright: '© 2026 Jo',
  creator: 'Jo Bloggs',
  ...s,
});

function markers(jpeg: Uint8Array): string[] {
  const out: string[] = [];
  let p = 2;
  while (p + 4 <= jpeg.length && jpeg[p] === 0xff) {
    const m = jpeg[p + 1] ?? 0;
    out.push(m.toString(16));
    if (m === 0xda) break;
    p += 2 + (((jpeg[p + 2] ?? 0) << 8) | (jpeg[p + 3] ?? 0));
  }
  return out;
}

function artistAndCopyright(bytes: Uint8Array, base: number | null) {
  const tiff = base === null ? null : openTiff(bytes, base);
  const ifd0 = tiff ? readIfd(tiff, tiff.firstIfd) : null;
  if (!tiff || !ifd0) return null;
  const decode = (tag: number) => {
    const entry = ifd0.entries.get(tag);
    return entry ? new TextDecoder().decode(bytes.subarray(entry.valueOffset, entry.valueOffset + entry.count - 1)) : null;
  };
  return { artist: decode(0x013b), copyright: decode(0x8298), make: getString(tiff, ifd0, 0x010f) };
}

describe('EXIF writer', () => {
  it('round-trips everything through the reader, location kept when asked', () => {
    const jpeg = insertJpegExif(browserJpeg(), buildExportExif(testAsset(), settings({ removeLocation: false })));
    expect(markers(jpeg)).toEqual(['e0', 'e1', 'e2', 'db', 'c0', 'da']);
    const m = readMetadata(jpeg);
    expect(m).toMatchObject({
      width: 64,
      height: 48,
      orientation: 1,
      capturedAt: '2026-11-14T16:02:11+01:00',
      camera: { make: 'FUJIFILM', model: 'X100VI' },
      lens: 'XF23mmF2 R WR',
      exposure: { iso: 800, shutter: '1/250', aperture: 5.6, focalLength: 23 },
    });
    expect(m?.gps?.lat).toBeCloseTo(-33.85875, 5);
    expect(m?.gps?.lon).toBeCloseTo(151.21, 5);
    expect(m?.gps?.alt).toBe(12.5);
    expect(artistAndCopyright(jpeg, scanJpeg(jpeg).exifBase)).toMatchObject({ artist: 'Jo Bloggs', copyright: '© 2026 Jo' });
  });

  it('removes location by default', () => {
    const jpeg = insertJpegExif(browserJpeg(), buildExportExif(testAsset(), settings()));
    expect(readMetadata(jpeg)?.gps).toBeNull();
    expect(readMetadata(jpeg)?.camera?.model).toBe('X100VI');
  });

  it("keeps only Artist and Copyright for 'copyright'", () => {
    const jpeg = insertJpegExif(browserJpeg(), buildExportExif(testAsset(), settings({ metadata: 'copyright', removeLocation: false })));
    const m = readMetadata(jpeg);
    expect(m).toMatchObject({ camera: null, lens: null, exposure: null, gps: null, capturedAt: null });
    expect(artistAndCopyright(jpeg, scanJpeg(jpeg).exifBase)).toEqual({ artist: 'Jo Bloggs', copyright: '© 2026 Jo', make: null });
  });

  it("writes nothing for 'none', and strips an existing Exif", () => {
    expect(buildExportExif(testAsset(), settings({ metadata: 'none' }))).toBeNull();
    const old = buildExportExif(testAsset(), settings());
    const stripped = insertJpegExif(browserJpeg(64, 48, old ?? undefined), null);
    expect(markers(stripped)).toEqual(['e0', 'e2', 'db', 'c0', 'da']);
    expect(readMetadata(stripped)?.camera).toBeNull();
  });

  it('replaces an existing Exif APP1 and keeps the ICC profile byte for byte', () => {
    const old = buildExportExif(testAsset({ camera: { make: 'OLD', model: 'OLD' } }), settings());
    const source = browserJpeg(64, 48, old ?? undefined);
    const jpeg = insertJpegExif(source, buildExportExif(testAsset(), settings()));
    expect(markers(jpeg)).toEqual(['e0', 'e1', 'e2', 'db', 'c0', 'da']);
    expect(readMetadata(jpeg)?.camera?.make).toBe('FUJIFILM');
    const icc = (b: Uint8Array) => {
      const s = new TextDecoder('latin1').decode(b);
      const at = s.indexOf('ICC_PROFILE');
      return Array.from(b.subarray(at - 4, at + 18));
    };
    expect(icc(jpeg)).toEqual(icc(source));
    expect(Array.from(jpeg.subarray(jpeg.length - 4))).toEqual([0x12, 0x34, 0xff, 0xd9]);
  });

  it('leaves what is not a JPEG or PNG alone', () => {
    const junk = Uint8Array.from([1, 2, 3, 4, 5, 6]);
    expect(insertJpegExif(junk, new Uint8Array(8))).toBe(junk);
    expect(insertPngExif(junk, new Uint8Array(8))).toBe(junk);
    const truncated = browserJpeg().slice(0, 30);
    expect(insertJpegExif(truncated, new Uint8Array(8))).toBe(truncated);
  });

  it('writes a PNG eXIf chunk before IDAT with a correct CRC', () => {
    const png = buildPng({ width: 10, height: 20 });
    // Give it an IDAT before IEND.
    const withIdat = Uint8Array.from([...png.subarray(0, png.length - 12), 0, 0, 0, 1, 0x49, 0x44, 0x41, 0x54, 0x78, 0, 0, 0, 0, ...png.subarray(png.length - 12)]);
    const out = insertPngExif(withIdat, buildExportExif(testAsset(), settings()));
    const types: string[] = [];
    let p = 8;
    while (p + 12 <= out.length) {
      const length = u32be(out, p);
      const type = new TextDecoder().decode(out.subarray(p + 4, p + 8));
      types.push(type);
      if (type === 'eXIf') expect(u32be(out, p + 8 + length)).toBe(crc32(out.subarray(p + 4, p + 8 + length)));
      p += 12 + length;
    }
    expect(types).toEqual(['IHDR', 'eXIf', 'IDAT', 'IEND']);
    expect(readMetadata(out)).toMatchObject({ format: 'png', width: 10, height: 20, camera: { model: 'X100VI' } });
    expect(readExifAt(out, scanPng(out).exifBase).lens).toBe('XF23mmF2 R WR');
    const again = insertPngExif(out, null);
    expect(again.length).toBe(withIdat.length);
  });

  it('applies metadata to a Blob', async () => {
    const blob = await applyExportMetadata(new Blob([browserJpeg()], { type: 'image/jpeg' }), testAsset(), settings());
    expect(blob.type).toBe('image/jpeg');
    expect(readMetadata(new Uint8Array(await blob.arrayBuffer()))?.camera?.model).toBe('X100VI');
  });

  it('parses shutter strings', () => {
    expect(shutterToRational('1/250')).toEqual([1, 250]);
    expect(shutterToRational('2.5')).toEqual([2500, 1000]);
    expect(shutterToRational('fast')).toBeNull();
  });

  it('checks CRC-32 against the known vector', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
});
