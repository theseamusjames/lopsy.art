import { describe, expect, it } from 'vitest';
import {
  MAX_LAYERS,
  ProjectFormatError,
  checkU16Blob,
  inflateExact,
  readProjectContainer,
  validateManifest,
} from './project-format';
import { ImageTooLargeError } from './image-too-large';

const MAX_SIDE = 16384;

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function layer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'l1',
    name: 'Background',
    type: 'raster',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 0,
    y: 0,
    clipToBelow: false,
    effects: {},
    width: 4,
    height: 2,
    pixelDataIndex: 0,
    maskDataIndex: -1,
    pixelWidth: 4,
    pixelHeight: 2,
    ...overrides,
  };
}

function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 3,
    documentName: 'doc',
    documentWidth: 4,
    documentHeight: 2,
    backgroundColor: { r: 0, g: 0, b: 0, a: 0 },
    layers: [layer()],
    layerOrder: ['l1'],
    rootGroupId: null,
    activeLayerId: 'l1',
    ...overrides,
  };
}

/** A container with the given manifest and blobs, as project-save.ts writes it. */
function container(manifestValue: unknown, blobs: Uint8Array[], version = 3): ArrayBuffer {
  const json = new TextEncoder().encode(JSON.stringify(manifestValue));
  const header = new Uint8Array(12);
  header.set([0x4c, 0x4f, 0x50, 0x53, 0x59, 0x00]);
  const view = new DataView(header.buffer);
  view.setUint16(6, version, true);
  view.setUint32(8, json.length, true);
  const table = new Uint8Array(4 + blobs.length * 4);
  const tableView = new DataView(table.buffer);
  tableView.setUint32(0, blobs.length, true);
  blobs.forEach((b, i) => tableView.setUint32(4 + i * 4, b.length, true));
  const parts = [header, json, table, ...blobs];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out.buffer;
}

/** A 32-byte u16 blob header (flags 2 = LZ4) plus `payload` bytes. */
function u16Blob(crop: [number, number, number, number], full: [number, number], uncompressed: number, payload = 8): Uint8Array {
  const blob = new Uint8Array(32 + payload);
  const view = new DataView(blob.buffer);
  [...crop, ...full].forEach((v, i) => view.setInt32(i * 4, v, true));
  view.setInt32(24, 2, true);
  view.setUint32(28, uncompressed, true);
  return blob;
}

const read = (buffer: ArrayBuffer) => readProjectContainer(buffer, { maxSide: MAX_SIDE, supportedVersion: 3 });

describe('readProjectContainer', () => {
  it('reads a well-formed file', () => {
    const parsed = read(container(manifest(), [new Uint8Array(10)]));
    expect(parsed.version).toBe(3);
    expect(parsed.manifest.documentWidth).toBe(4);
    expect(parsed.blobs).toHaveLength(1);
    expect(parsed.pixelBlobCount).toBe(1);
  });

  it('refuses missing magic bytes and newer versions', () => {
    expect(() => read(new ArrayBuffer(4))).toThrow(/missing magic bytes/);
    expect(() => read(container(manifest(), [new Uint8Array(10)], 9))).toThrow(/newer version of Lopsy \(format v9\)/);
  });

  it('refuses a manifest or blob that runs past the end of the file', () => {
    const buffer = container(manifest(), [new Uint8Array(10)]);
    const bytes = new Uint8Array(buffer);
    new DataView(buffer).setUint32(8, 1_000_000, true);
    expect(() => read(bytes.buffer)).toThrow(ProjectFormatError);

    const short = container(manifest(), [new Uint8Array(10)]);
    expect(() => read(short.slice(0, short.byteLength - 5))).toThrow(/runs past the end/);
  });

  it('refuses a manifest that is not JSON', () => {
    const buffer = container(manifest(), []);
    new Uint8Array(buffer)[12] = 0x7b + 1;
    expect(() => read(buffer)).toThrow(/not valid JSON/);
  });

  it('refuses a document larger than the texture limit as too large to open, saying whose limit it is', () => {
    const tooWide = () => read(container(manifest({ documentWidth: 1e6 }), [new Uint8Array(10)]));
    expect(tooWide).toThrow(ImageTooLargeError);
    expect(tooWide).toThrow(/^The project is 1,000,000 × 2 pixels\. Lopsy keeps each layer as one image, and the largest it allows/);
    const tooTall = () =>
      readProjectContainer(container(manifest({ documentHeight: 4096 }), [new Uint8Array(10)]), { maxSide: 2048, isDeviceLimit: true, supportedVersion: 3 });
    expect(tooTall).toThrow(/^The project is 4 × 4,096 pixels\. .*the largest this device allows is 2,048 pixels on a side/);
  });

  it('refuses a document side that is not a whole positive number as corrupt', () => {
    expect(() => read(container(manifest({ documentWidth: 2.5 }), [new Uint8Array(10)]))).toThrow(/document width/);
    expect(() => read(container(manifest({ documentHeight: 0 }), [new Uint8Array(10)]))).toThrow(/document height/);
  });

  it('refuses layers whose pixel or mask sizes are out of range or disagree with their blobs', () => {
    expect(() => read(container(manifest({ layers: [layer({ pixelWidth: 100_000 })] }), [new Uint8Array(10)]))).toThrow(/pixelWidth/);
    expect(() => read(container(manifest({ layers: [layer({ pixelDataIndex: 3 })] }), [new Uint8Array(10)]))).toThrow(/pixel data/);
    const masked = layer({ maskDataIndex: 0, maskWidth: 4, maskHeight: 2 });
    expect(read(container(manifest({ layers: [masked] }), [new Uint8Array(10), new Uint8Array(8)])).blobs).toHaveLength(2);
    expect(() => read(container(manifest({ layers: [masked] }), [new Uint8Array(10), new Uint8Array(7)]))).toThrow(/mask/);
  });

  it('checks 16-bit blobs against the layer', () => {
    const v3 = layer({ pixelFormat: 'rgba16-lz4' });
    const good = u16Blob([0, 0, 4, 2], [4, 2], 4 * 2 * 8);
    expect(read(container(manifest({ layers: [v3] }), [good])).blobs).toHaveLength(1);
    const lying = u16Blob([0, 0, 4, 2], [4, 2], 2_000_000_000);
    expect(() => read(container(manifest({ layers: [v3] }), [lying]))).toThrow(/do not match/);
    const wrongSize = u16Blob([0, 0, 4, 2], [8, 8], 4 * 2 * 8);
    expect(() => read(container(manifest({ layers: [v3] }), [wrongSize]))).toThrow(/not 4 × 2/);
    expect(() => read(container(manifest({ layers: [layer({ pixelFormat: 'jpeg' })] }), [good]))).toThrow(/unknown pixel format/);
  });

  it('refuses too many layers', () => {
    const many = Array.from({ length: MAX_LAYERS + 1 }, (_, i) => layer({ id: `l${i}`, pixelDataIndex: -1 }));
    expect(() => read(container(manifest({ layers: many }), []))).toThrow(/at most/);
  });
});

describe('validateManifest', () => {
  it('refuses wrong types and non-finite numbers', () => {
    expect(() => validateManifest(null, MAX_SIDE, 0)).toThrow(/not an object/);
    expect(() => validateManifest(manifest({ layers: 'x' }), MAX_SIDE, 1)).toThrow(/layer list/);
    expect(() => validateManifest(manifest({ layerOrder: [1] }), MAX_SIDE, 1)).toThrow(/layer order/);
    expect(() => validateManifest(manifest({ layers: [layer({ id: 7 })] }), MAX_SIDE, 1)).toThrow(/id/);
    expect(() => validateManifest(manifest({ layers: [layer({ opacity: 'full' })] }), MAX_SIDE, 1)).toThrow(/opacity/);
    expect(() => validateManifest(manifest({ layers: [layer({ x: 1e12 })] }), MAX_SIDE, 1)).toThrow(/x is out of range/);
    expect(() => validateManifest(manifest({ backgroundColor: { r: 0 } }), MAX_SIDE, 1)).toThrow(/background/);
    expect(() => validateManifest(manifest({ layers: [layer({ name: 'n'.repeat(5000) })] }), MAX_SIDE, 1)).toThrow(/too long/);
  });

  it('accepts text, shape and group layers with their own fields', () => {
    const text = layer({ id: 't', type: 'text', text: 'Hello', fontSize: 24, textWidth: null, width: undefined, height: undefined, pixelDataIndex: -1 });
    const group = layer({ id: 'g', type: 'group', children: ['l1', 't'], adjustments: [], pixelDataIndex: -1 });
    expect(validateManifest(manifest({ layers: [layer(), text, group] }), MAX_SIDE, 1).layers).toHaveLength(3);
  });
});

describe('checkU16Blob', () => {
  it('accepts the old raw format of exactly the crop size', () => {
    const raw = new Uint8Array(24 + 2 * 2 * 8);
    const view = new DataView(raw.buffer);
    [0, 0, 2, 2, 2, 2].forEach((v, i) => view.setInt32(i * 4, v, true));
    expect(() => checkU16Blob(raw, 2, 2, 'x')).not.toThrow();
  });

  it('refuses a crop outside the layer', () => {
    expect(() => checkU16Blob(u16Blob([3, 0, 4, 2], [4, 2], 4 * 2 * 8), 4, 2, 'x')).toThrow(/crop/);
  });
});

describe('inflateExact', () => {
  it('inflates to exactly the expected size', async () => {
    const data = new Uint8Array(64).map((_, i) => i);
    expect(Array.from(await inflateExact(await gzip(data), 64))).toEqual(Array.from(data));
  });

  it('stops a gzip bomb at the cap', async () => {
    const bomb = await gzip(new Uint8Array(32 * 1024 * 1024));
    expect(bomb.length).toBeLessThan(100_000);
    await expect(inflateExact(bomb, 1024)).rejects.toThrow(/more than the 1024 bytes/);
  });

  it('refuses output shorter than expected, and data that is not gzip', async () => {
    await expect(inflateExact(await gzip(new Uint8Array(10)), 64)).rejects.toThrow(/not 64/);
    await expect(inflateExact(new Uint8Array([1, 2, 3, 4]), 64)).rejects.toThrow(ProjectFormatError);
  });
});
