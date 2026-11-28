import { describe, expect, it } from 'vitest';
import { scanJpeg } from './containers';
import { detectFormat } from './detect-format';
import { startImport } from './importer';
import { inspectImage } from './inspect';
import { FakeLibrarySession } from './test-support/fake-session';
import { TestMemoryAdapter } from './test-support/memory-adapter';

// photos-core has no Node type definitions (its code targets the browser), so the few fs calls are typed here.
interface NodeFs {
  readFileSync(path: string): Uint8Array;
  readdirSync(path: string): string[];
}
const { readFileSync, readdirSync } = (await import('node:fs' as string)) as NodeFs;
const env = (globalThis as unknown as { process?: { env: Record<string, string | undefined> } }).process?.env;
const cr2Dir = env?.['LOPSY_CR2_SAMPLES'];
const nefDir = env?.['LOPSY_NEF_SAMPLES'];

function read(dir: string | undefined, name: string): Uint8Array {
  return readFileSync(`${dir ?? ''}/${name}`);
}

/**
 * The size import records for each full-size sample is the one the
 * engine's decode gives (before orientation): for a CR2 the Exif pixel
 * dimensions, which are the crop of the sensor it keeps; for a NEF the
 * camera's largest embedded JPEG. Every NEF the engine opens is pinned,
 * compressed ones included.
 */
const CR2_SIZES: readonly (readonly [string, string, number, number])[] = [
  ['EOS-20D_RAW.CR2', 'Canon EOS 20D', 3504, 2336],
  ['EOS-40D_RAW.CR2', 'Canon EOS 40D', 3888, 2592],
  ['EOS-5D-Mark-III_RAW.CR2', 'Canon EOS 5D Mark III', 5760, 3840],
  ['EOS-5D-Mark-IV_RAW-B.CR2', 'Canon EOS 5D Mark IV', 6720, 4480],
  ['EOS-5D-Mark-IV_RAW.CR2', 'Canon EOS 5D Mark IV', 6720, 4480],
  ['EOS-7D_RAW.CR2', 'Canon EOS 7D', 5184, 3456],
  ['PowerShot-G16_RAW.CR2', 'Canon PowerShot G16', 4000, 3000],
];

const NEF_SIZES: readonly (readonly [string, string, number, number])[] = [
  ['D200_12bit_uncompressed.NEF', 'NIKON D200', 3872, 2592],
  ['D3_12bit_lossless.NEF', 'NIKON D3', 4256, 2832],
  ['D3_12bit_uncompressed.NEF', 'NIKON D3', 4256, 2832],
  ['D3_14bit_lossy_type2.NEF', 'NIKON D3', 4256, 2832],
  ['D3_14bit_uncompressed.NEF', 'NIKON D3', 4256, 2832],
  ['D500_12bit_compression6.NEF', 'NIKON D500', 5568, 3712],
  ['D6_14bit_compression10.NEF', 'NIKON D6', 5568, 3712],
  ['D7000_12bit_lossy_type2.NEF', 'NIKON D7000', 4928, 3264],
  ['D850_12bit_lossy_type2.NEF', 'NIKON D850', 8256, 5504],
  ['D850_14bit_uncompressed.NEF', 'NIKON D850', 8256, 5504],
  // Portrait: stored landscape with the orientation tag, recorded upright.
  ['Z30_14bit_lossless.NEF', 'NIKON Z 30', 3712, 5568],
  ['Z6_12bit_uncompressed.NEF', 'NIKON Z 6', 6048, 4024],
  ['Z6_14bit_lossless.NEF', 'NIKON Z 6', 6048, 4024],
  ['Z6_14bit_uncompressed.NEF', 'NIKON Z 6', 6048, 4024],
  ['Z7II_12bit_lossy_type2.NEF', 'NIKON Z 7_2', 8256, 5504],
];

describe.skipIf(!cr2Dir)('the real CR2 samples (LOPSY_CR2_SAMPLES)', () => {
  const files = cr2Dir ? readdirSync(cr2Dir).sort() : [];

  it('holds every full-size CR2 whose size is pinned', () => {
    expect(files.filter((f) => /_RAW(-B)?\.CR2$/i.test(f))).toEqual(CR2_SIZES.map(([name]) => name).sort());
  });

  it.each(files.filter((f) => /\.cr2$/i.test(f)))('%s is a CR2, by its bytes (a reduced-size sRAW or mRAW too)', (name: string) => {
    expect(detectFormat(read(cr2Dir, name))).toBe('cr2');
  });

  // The engine reads a CR3's container but not its codec: import turns one away as a file it cannot read.
  it.each(files.filter((f) => /\.cr3$/i.test(f)))('%s (a CR3) is not a photo import reads', (name: string) => {
    expect(detectFormat(read(cr2Dir, name))).toBeNull();
  });

  it.each(CR2_SIZES)('%s records its camera, %s, at %i x %i, with a preview', (name: string, model: string, width: number, height: number) => {
    const inspected = inspectImage(read(cr2Dir, name));
    expect(inspected?.metadata).toMatchObject({ format: 'cr2', mimeType: 'image/x-canon-cr2', width, height, camera: { make: 'Canon', model } });
    expect(inspected?.metadata.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(inspected?.preview?.blob.type).toBe('image/jpeg');
    expect(inspected?.preview?.width).toBeGreaterThanOrEqual(1024);
  });

  it("previews a 5D Mark III with the camera's full-size JPEG, a whole one a browser decodes", async () => {
    const preview = inspectImage(read(cr2Dir, 'EOS-5D-Mark-III_RAW.CR2'))?.preview;
    if (!preview) throw new Error('no preview');
    expect(preview).toMatchObject({ width: 5760, height: 3840, orientation: 1 });
    const jpeg = new Uint8Array(await preview.blob.arrayBuffer());
    expect(scanJpeg(jpeg)).toMatchObject({ width: 5760, height: 3840, frameMarker: 0xc0 });
    expect([jpeg[0], jpeg[1], jpeg[jpeg.length - 2], jpeg[jpeg.length - 1]]).toEqual([0xff, 0xd8, 0xff, 0xd9]);
  });

  it('imports a CR2 end to end on the test doubles', async () => {
    const bytes = read(cr2Dir, 'EOS-5D-Mark-III_RAW.CR2');
    const asset = await importOne(bytes, 'EOS-5D-Mark-III_RAW.CR2');
    expect(asset).toMatchObject({ format: 'cr2', mimeType: 'image/x-canon-cr2', width: 5760, height: 3840 });
    expect(asset?.camera).toEqual({ make: 'Canon', model: 'Canon EOS 5D Mark III' });
  });
});

describe.skipIf(!nefDir)('the real NEF samples (LOPSY_NEF_SAMPLES)', () => {
  const files = nefDir ? readdirSync(nefDir).sort() : [];

  it('holds every full-size NEF whose size is pinned', () => {
    const pinned = NEF_SIZES.map(([name]) => name);
    expect(files.filter((f) => pinned.includes(f))).toEqual([...pinned].sort());
  });

  // High Efficiency and Small NEFs, and the D70's, are NEFs too: import cannot tell them from those that open, and the engine says why it cannot open one.
  it.each(files.filter((f) => /\.nef$/i.test(f)))('%s is a NEF, by its bytes', (name: string) => {
    expect(detectFormat(read(nefDir, name))).toBe('nef');
  });

  // A COOLPIX compact's NRW, which the engine does not decode: import turns it away as a file it cannot read.
  it.each(files.filter((f) => /\.nrw$/i.test(f)))('%s (an NRW) is not a photo import reads', (name: string) => {
    expect(detectFormat(read(nefDir, name))).toBeNull();
  });

  it.each(NEF_SIZES)('%s records its camera, %s, at %i x %i, with a preview', (name: string, model: string, width: number, height: number) => {
    const inspected = inspectImage(read(nefDir, name));
    expect(inspected?.metadata).toMatchObject({ format: 'nef', mimeType: 'image/x-nikon-nef', width, height, camera: { make: 'NIKON CORPORATION', model } });
    expect(inspected?.metadata.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    // The camera's full-size JPEG, stored unturned (a portrait one is landscape, its orientation left to apply).
    const preview = inspected?.preview;
    expect([preview?.width, preview?.height].sort()).toEqual([width, height].sort());
  });

  it('imports a NEF end to end on the test doubles', async () => {
    const asset = await importOne(read(nefDir, 'D850_14bit_uncompressed.NEF'), 'D850_14bit_uncompressed.NEF');
    expect(asset).toMatchObject({ format: 'nef', mimeType: 'image/x-nikon-nef', width: 8256, height: 5504 });
    expect(asset?.camera).toEqual({ make: 'NIKON CORPORATION', model: 'NIKON D850' });
  });
});

async function importOne(bytes: Uint8Array, name: string) {
  const adapter = new TestMemoryAdapter();
  const root = await adapter.getRoot();
  const originals = await adapter.createFolder(root.id, 'Originals');
  const previews = await adapter.createFolder(root.id, 'previews');
  const session = new FakeLibrarySession(adapter, { rootId: root.id, originalsId: originals.id, previewsId: previews.id });
  const result = await startImport([new File([bytes.slice()], name)], {
    session,
    previewRenderer: {
      async render(_source, maxSize) {
        return { blob: new Blob(['x'], { type: 'image/jpeg' }), width: maxSize, height: maxSize };
      },
    },
  }).finished;
  expect(result.items[0]?.state).toBe('done');
  return session.getView().assets.get(result.items[0]?.assetId ?? '');
}
