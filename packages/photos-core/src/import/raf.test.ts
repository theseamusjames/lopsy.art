import { describe, expect, it } from 'vitest';
import { readRafHeader, scanJpeg } from './containers';
import { detectFormat } from './detect-format';
import { startImport } from './importer';
import { inspectImage } from './inspect';
import { FakeLibrarySession } from './test-support/fake-session';
import { TestMemoryAdapter } from './test-support/memory-adapter';

// photos-core has no Node type definitions (its code targets the browser), so the few fs calls are typed here.
interface NodeFs {
  openSync(path: string, flags: string): number;
  readSync(fd: number, buffer: Uint8Array, offset: number, length: number, position: number): number;
  closeSync(fd: number): void;
  readdirSync(path: string): string[];
}
const { openSync, readSync, closeSync, readdirSync } = (await import('node:fs' as string)) as NodeFs;
const env = (globalThis as unknown as { process?: { env: Record<string, string | undefined> } }).process?.env;
const dir = env?.['LOPSY_RAF_SAMPLES'];

/** Reads only the header, embedded JPEG and CFA header, never the raw data. */
function readRafHead(path: string): Uint8Array {
  const fd = openSync(path, 'r');
  try {
    const header = new Uint8Array(108);
    readSync(fd, header, 0, 108, 0);
    const view = new DataView(header.buffer);
    const end = Math.max(view.getUint32(84) + view.getUint32(88), view.getUint32(92) + view.getUint32(96));
    const bytes = new Uint8Array(Math.min(end, 32 * 1024 * 1024));
    readSync(fd, bytes, 0, bytes.length, 0);
    return bytes;
  } finally {
    closeSync(fd);
  }
}

describe.skipIf(!dir)('real RAF samples (LOPSY_RAF_SAMPLES)', () => {
  const files = dir ? readdirSync(dir).filter((f) => /\.raf$/i.test(f)).sort() : [];

  it('has samples', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('imports a RAF end to end (its first megabytes, on the test doubles)', async () => {
    const name = files[0] ?? '';
    const bytes = readRafHead(`${dir ?? ''}/${name}`);
    const adapter = new TestMemoryAdapter();
    const root = await adapter.getRoot();
    const originals = await adapter.createFolder(root.id, 'Originals');
    const previews = await adapter.createFolder(root.id, 'previews');
    const session = new FakeLibrarySession(adapter, { rootId: root.id, originalsId: originals.id, previewsId: previews.id });
    const calls: { size: number; orientation: number; type: string }[] = [];
    const result = await startImport([new File([bytes.slice()], name)], {
      session,
      previewRenderer: {
        async render(source, maxSize, orientation) {
          calls.push({ size: maxSize, orientation, type: source.type });
          return { blob: new Blob(['x'], { type: 'image/jpeg' }), width: maxSize, height: maxSize };
        },
      },
    }).finished;
    expect(result.items[0]?.state).toBe('done');
    const asset = session.getView().assets.get(result.items[0]?.assetId ?? '');
    expect(asset?.format).toBe('raf');
    expect(asset?.mimeType).toBe('image/x-fuji-raf');
    expect(calls.map((c) => c.type)).toEqual(['image/jpeg', 'image/jpeg']);
    expect(calls.every((c) => c.orientation === 1)).toBe(true);
    const day = asset?.capturedAt?.slice(0, 10) ?? '';
    const folder = await adapter.getFile((await adapter.getFile(asset?.fileId ?? ''))?.parentId ?? '');
    expect(folder?.name).toBe(day);
  });

  it.each(files)('%s: metadata and embedded preview', async (name: string) => {
    const bytes = readRafHead(`${dir ?? ''}/${name}`);
    expect(detectFormat(bytes)).toBe('raf');
    const inspected = inspectImage(bytes);
    if (!inspected) throw new Error('not inspected');
    const { metadata, preview } = inspected;
    expect(metadata.format).toBe('raf');
    expect(metadata.camera?.make).toBe('FUJIFILM');
    expect(metadata.camera?.model).toMatch(/^X/);
    expect(metadata.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(metadata.exposure?.iso).toBeGreaterThan(0);
    expect(metadata.exposure?.shutter).toMatch(/^(1\/\d+|\d+(\.\d)?)$/);
    expect(metadata.width).toBeGreaterThan(1000);
    expect(metadata.height).toBeGreaterThan(1000);
    if (!preview) throw new Error('no preview');
    expect(preview.width).toBeGreaterThan(100);
    const header = readRafHeader(bytes);
    expect(preview.blob.size).toBe(header?.jpegLength);
    const jpeg = new Uint8Array(await preview.blob.arrayBuffer());
    expect(scanJpeg(jpeg)).toMatchObject({ width: preview.width === null ? null : expect.any(Number) });
    console.log(
      `${name}: ${metadata.camera?.make} ${metadata.camera?.model}, lens ${metadata.lens}, ` +
        `${JSON.stringify(metadata.exposure)}, ${metadata.capturedAt}, ` +
        `${metadata.width}x${metadata.height} orientation ${metadata.orientation}, ` +
        `preview ${preview.width}x${preview.height} (${preview.blob.size} bytes, orientation still to apply ${preview.orientation})`,
    );
  });
});
