import { describe, expect, it } from 'vitest';
import { scanJpeg } from './containers';
import { detectFormat } from './detect-format';
import { startImport } from './importer';
import { inspectImage } from './inspect';
import { extractPreview } from './preview';
import { FakeLibrarySession } from './test-support/fake-session';
import { TestMemoryAdapter } from './test-support/memory-adapter';
import { TiffTag, collectImageIfds, getNumber, openTiff } from './tiff';

// photos-core has no Node type definitions (its code targets the browser), so the few fs calls are typed here.
interface NodeFs {
  openSync(path: string, flags: string): number;
  readSync(fd: number, buffer: Uint8Array, offset: number, length: number, position: number): number;
  closeSync(fd: number): void;
  readdirSync(path: string): string[];
}
const { openSync, readSync, closeSync, readdirSync } = (await import('node:fs' as string)) as NodeFs;
const env = (globalThis as unknown as { process?: { env: Record<string, string | undefined> } }).process?.env;
const arwDir = env?.['LOPSY_ARW_SAMPLES'];
const dngDir = env?.['LOPSY_DNG_SAMPLES'];

const HEAD = 256 * 1024;

function readBytes(path: string, length: number): Uint8Array {
  const fd = openSync(path, 'r');
  try {
    const bytes = new Uint8Array(length);
    const read = readSync(fd, bytes, 0, length, 0);
    return bytes.subarray(0, read);
  } finally {
    closeSync(fd);
  }
}

/**
 * An ARW's IFDs and embedded JPEGs, never its raw data: the first 256 KB
 * (where the IFDs are), then up to the end of the furthest JPEG they name.
 */
function readArwHead(path: string): Uint8Array {
  const head = readBytes(path, HEAD);
  const tiff = openTiff(head);
  if (!tiff) return head;
  let end = head.length;
  for (const ifd of collectImageIfds(tiff)) {
    const offset = getNumber(tiff, ifd, TiffTag.JpegInterchangeFormat);
    const length = getNumber(tiff, ifd, TiffTag.JpegInterchangeFormatLength);
    if (offset !== null && length !== null) end = Math.max(end, offset + length);
  }
  return end > head.length ? readBytes(path, Math.min(end, 32 * 1024 * 1024)) : head;
}

/** The Sony A7 IV sample in its compressed (lossy) encoding, the one the preview offsets below are for. */
const COMPRESSED_A7IV = 'ILCE-7M4_DSC06677_FullFrame-Raw-Compressed.ARW';

/** Where each embedded JPEG of the sample is (IFD0, IFD1, IFD2), and its size. */
const SAMPLE_JPEGS = {
  preview: { offset: 192_674, length: 498_845, width: 1616, height: 1080 },
  thumbnail: { offset: 43_946, length: 12_389, width: 160, height: 120 },
  full: { offset: 692_224, length: 6_964_228, width: 7008, height: 4672 },
} as const;

describe.skipIf(!arwDir)('the real ARW sample (LOPSY_ARW_SAMPLES)', () => {
  const files = arwDir ? readdirSync(arwDir).filter((f) => /\.arw$/i.test(f)).sort() : [];
  const sample = files.find((f) => f === COMPRESSED_A7IV) ?? '';
  const path = `${arwDir ?? ''}/${sample}`;

  it('has the compressed Sony A7 IV sample', () => {
    expect(sample).not.toBe('');
  });

  it.each(files)('%s is an ARW, by its bytes', (name: string) => {
    expect(detectFormat(readBytes(`${arwDir ?? ''}/${name}`, HEAD))).toBe('arw');
  });

  // Sony's older formats, which the engine refuses: import turns them away as files it cannot read.
  const older = arwDir ? readdirSync(arwDir).filter((f) => /\.(sr2|srf)$/i.test(f)).sort() : [];
  it.each(older)('%s (an SR2 or SRF) is not a photo import reads', (name: string) => {
    expect(detectFormat(readArwHead(`${arwDir ?? ''}/${name}`))).toBeNull();
  });

  /**
   * The size import records is the one the engine's decode gives: the
   * DefaultCropSize where the camera wrote one, else (A6000, RX100 III) the
   * Exif pixel dimensions, which are Sony's crop of the sensor.
   */
  const EXPECTED_SIZES: readonly (readonly [string, number, number])[] = [
    ['ILCE-7M4_DSC06673_FullFrame-Raw-Uncompressed.ARW', 7008, 4672],
    ['ILCE-7M4_DSC06674_FullFrame-LossLess-Compressed-Large.ARW', 7008, 4672],
    ['ILCE-7M4_DSC06677_FullFrame-Raw-Compressed.ARW', 7008, 4672],
    ['ILCE-7M3_DSC0009.ARW', 6000, 4000],
    ['ILCE-6000_DSC01542.ARW', 6000, 4000],
    ['DSC-RX100M3_DSC00734.ARW', 5472, 3648],
  ];

  it('holds every ARW whose size is pinned', () => {
    expect(files).toEqual(EXPECTED_SIZES.map(([name]) => name).sort());
  });

  it.each(EXPECTED_SIZES)('%s records %i x %i, with its camera and a preview', (name: string, width: number, height: number) => {
    const inspected = inspectImage(readArwHead(`${arwDir ?? ''}/${name}`));
    expect(inspected?.metadata).toMatchObject({ format: 'arw', width, height, camera: { make: 'SONY', model: name.split('_')[0] } });
    expect(inspected?.metadata.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(inspected?.preview?.width).toBeGreaterThanOrEqual(1024);
  });

  it('reads its camera, capture time, exposure and picture size (the default crop, not the sensor)', () => {
    const inspected = inspectImage(readArwHead(path));
    if (!inspected) throw new Error('not inspected');
    const { metadata } = inspected;
    expect(metadata).toMatchObject({
      format: 'arw',
      mimeType: 'image/x-sony-arw',
      camera: { make: 'SONY', model: 'ILCE-7M4' },
      lens: 'FE 50mm F2.5 G',
      capturedAt: '2023-10-19T16:15:24+02:00',
      orientation: 1,
      width: 7008,
      height: 4672,
    });
    expect(metadata.exposure).toEqual({ iso: 250, shutter: '1/50', aperture: 5.6, focalLength: 50 });
  });

  it('previews with the full-size embedded JPEG, the largest one', async () => {
    const bytes = readArwHead(path);
    const preview = inspectImage(bytes)?.preview;
    if (!preview) throw new Error('no preview');
    const { full } = SAMPLE_JPEGS;
    expect(preview).toMatchObject({ width: full.width, height: full.height, orientation: 1 });
    expect(preview.blob.type).toBe('image/jpeg');
    expect(preview.blob.size).toBe(full.length);
    const jpeg = new Uint8Array(await preview.blob.arrayBuffer());
    // A whole baseline JPEG, start to end marker, as browsers decode.
    expect(scanJpeg(jpeg)).toMatchObject({ width: full.width, height: full.height, frameMarker: 0xc0 });
    expect([jpeg[0], jpeg[1], jpeg[jpeg.length - 2], jpeg[jpeg.length - 1]]).toEqual([0xff, 0xd8, 0xff, 0xd9]);
  });

  it('falls back to a smaller JPEG when the full-size one is not all there, and to none', () => {
    const { preview, thumbnail, full } = SAMPLE_JPEGS;
    // Cut inside the full-size JPEG: the 1616-wide preview is the largest left.
    const cutFull = readBytes(path, full.offset + full.length - 1);
    expect(detectFormat(cutFull)).toBe('arw');
    expect(inspectImage(cutFull)?.preview).toMatchObject({ width: preview.width, height: preview.height });
    // Cut inside the 1616-wide one too: the thumbnail.
    const cutPreview = readBytes(path, preview.offset + preview.length - 1);
    expect(detectFormat(cutPreview)).toBe('arw');
    expect(inspectImage(cutPreview)?.preview).toMatchObject({ width: thumbnail.width, height: thumbnail.height });
    // Cut inside the thumbnail as well: no preview at all.
    expect(extractPreview(readBytes(path, thumbnail.offset + 100), 'arw', 1)).toBeNull();
  });

  it('a JPEG the Sony camera made (the full-size one it embedded) is a JPEG, not an ARW', () => {
    const { full } = SAMPLE_JPEGS;
    const bytes = readArwHead(path);
    expect(detectFormat(bytes.slice(full.offset, full.offset + full.length))).toBe('jpeg');
  });

  it('imports end to end on the test doubles, previews rendered from the embedded JPEG', async () => {
    const bytes = readArwHead(path);
    const adapter = new TestMemoryAdapter();
    const root = await adapter.getRoot();
    const originals = await adapter.createFolder(root.id, 'Originals');
    const previews = await adapter.createFolder(root.id, 'previews');
    const session = new FakeLibrarySession(adapter, { rootId: root.id, originalsId: originals.id, previewsId: previews.id });
    const calls: { size: number; orientation: number; type: string; bytes: number }[] = [];
    const result = await startImport([new File([bytes.slice()], sample)], {
      session,
      previewRenderer: {
        async render(source, maxSize, orientation) {
          calls.push({ size: maxSize, orientation, type: source.type, bytes: source.size });
          return { blob: new Blob(['x'], { type: 'image/jpeg' }), width: maxSize, height: maxSize };
        },
      },
    }).finished;
    expect(result.items[0]?.state).toBe('done');
    const asset = session.getView().assets.get(result.items[0]?.assetId ?? '');
    expect(asset).toMatchObject({ format: 'arw', mimeType: 'image/x-sony-arw', width: 7008, height: 4672 });
    expect(asset?.camera).toEqual({ make: 'SONY', model: 'ILCE-7M4' });
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.type === 'image/jpeg' && c.bytes === SAMPLE_JPEGS.full.length && c.orientation === 1)).toBe(true);
    const folder = await adapter.getFile((await adapter.getFile(asset?.fileId ?? ''))?.parentId ?? '');
    expect(folder?.name).toBe('2023-10-19');
  });
});

describe.skipIf(!dngDir)('real DNG samples stay DNGs (LOPSY_DNG_SAMPLES)', () => {
  const files = dngDir ? readdirSync(dngDir).filter((f) => /\.dng$/i.test(f)).sort() : [];

  it('has samples', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s is a DNG', (name: string) => {
    expect(detectFormat(readBytes(`${dngDir ?? ''}/${name}`, 1024 * 1024))).toBe('dng');
  });
});
