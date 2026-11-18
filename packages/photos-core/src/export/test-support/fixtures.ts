import type { Asset, Version } from '../../library/types';
import { DEFAULT_RECIPE } from '../../library/recipe';

export function testAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: 'asset-1',
    kind: 'original',
    fileId: 'file-1',
    sha256: 'a'.repeat(64),
    fileName: 'DSCF1234.RAF',
    byteSize: 1000,
    format: 'raf',
    mimeType: 'image/x-fuji-raf',
    capturedAt: '2026-11-14T16:02:11+01:00',
    importedAt: '2026-11-18T10:00:00.000Z',
    importId: 'import-1',
    width: 7728,
    height: 5152,
    orientation: 6,
    camera: { make: 'FUJIFILM', model: 'X100VI' },
    lens: 'XF23mmF2 R WR',
    exposure: { iso: 800, shutter: '1/250', aperture: 5.6, focalLength: 23 },
    gps: { lat: -33.85875, lon: 151.21, alt: 12.5 },
    pairedWith: null,
    source: null,
    renderFileId: null,
    rating: 0,
    label: null,
    setAside: false,
    title: 'Harbour',
    caption: '',
    keywords: [],
    primaryVersionId: 'v1',
    deleted: false,
    ...overrides,
  };
}

export function testVersion(overrides: Partial<Version> = {}): Version {
  return {
    id: 'v1',
    assetId: 'asset-1',
    name: 'Original',
    recipe: DEFAULT_RECIPE,
    createdAt: '2026-11-18T10:00:00.000Z',
    thumb: null,
    screen: null,
    deleted: false,
    ...overrides,
  };
}

/** The marker structure of a browser-encoded JPEG: SOI, APP0 JFIF, APP2 ICC_PROFILE, DQT, SOF0, SOS, EOI. */
export function browserJpeg(width = 64, height = 48, withExif?: Uint8Array): Uint8Array<ArrayBuffer> {
  const seg = (marker: number, body: readonly number[]) => [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body];
  const text = (s: string) => [...s].map((c) => c.charCodeAt(0));
  const bytes = [
    0xff,
    0xd8,
    ...seg(0xe0, [...text('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...(withExif ? seg(0xe1, [...text('Exif\0\0'), ...withExif]) : []),
    ...seg(0xe2, [...text('ICC_PROFILE\0'), 1, 1, 9, 8, 7, 6]),
    ...seg(0xdb, [0, ...new Array<number>(64).fill(1)]),
    ...seg(0xc0, [8, height >> 8, height & 0xff, width >> 8, width & 0xff, 1, 1, 0x11, 0]),
    ...seg(0xda, [1, 1, 0, 0, 63, 0]),
    0x12,
    0x34,
    0xff,
    0xd9,
  ];
  return Uint8Array.from(bytes);
}
