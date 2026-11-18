/**
 * Reading a `.lopsy` container safely. A project file is untrusted input:
 * it can come from a URL (`?open=`), from Lopsy Photos, or from disk. Before
 * anything replaces the open document, this module checks the header, the
 * manifest's shape and every size in it, and every blob against what the
 * manifest says it holds. Pixel blobs are inflated with a cap of exactly the
 * size their layer needs, so a small file cannot expand into gigabytes.
 *
 * See project-save.ts for the format itself.
 */

import { PIXEL_FORMAT_RGBA16_LZ4, type LopsyManifest, type SerializedLayer } from './project-save';

const LOPSY_MAGIC = [0x4c, 0x4f, 0x50, 0x53, 0x59, 0x00]; // "LOPSY\0"
const HEADER_BYTES = 12;

/** Largest manifest accepted. Real ones are kilobytes; paths with many anchors reach a few MB. */
export const MAX_MANIFEST_BYTES = 64 * 1024 * 1024;
export const MAX_LAYERS = 2000;
/** Sum of every layer's pixel area. 32 layers the size of the largest document. */
export const MAX_TOTAL_PIXELS = 32 * 16384 * 16384;
const MAX_NAME_LENGTH = 4096;
const MAX_TEXT_LENGTH = 1_000_000;
/** Layer positions may sit off the canvas, but not absurdly far. */
const MAX_OFFSET = 1_000_000;
const MAX_LIST_LENGTH = 100_000;

export class ProjectFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectFormatError';
  }
}

function fail(message: string): never {
  throw new ProjectFormatError(`Corrupt .lopsy file: ${message}`);
}

type Fields = Record<string, unknown>;

function isRecord(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function checkSide(value: unknown, what: string, maxSide: number, minimum = 1): number {
  if (!isInt(value) || value < minimum || value > maxSide) {
    fail(`${what} must be a whole number from ${minimum} to ${maxSide}, got ${String(value)}.`);
  }
  return value;
}

function checkOptional(fields: Fields, key: string, type: 'string' | 'boolean' | 'number', where: string, maxLength = MAX_NAME_LENGTH): void {
  const value = fields[key];
  if (value === undefined || value === null) return;
  if (typeof value !== type) fail(`${where}: ${key} must be a ${type}.`);
  if (type === 'number' && !Number.isFinite(value)) fail(`${where}: ${key} must be finite.`);
  if (type === 'string' && (value as string).length > maxLength) fail(`${where}: ${key} is too long.`);
}

function checkColor(value: unknown, what: string): void {
  if (!isRecord(value)) fail(`${what} must be a colour.`);
  for (const channel of ['r', 'g', 'b', 'a']) {
    const v = value[channel];
    if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${what}.${channel} must be a finite number.`);
  }
}

function checkIndex(value: unknown, what: string, count: number): void {
  if (value === undefined) return;
  if (!isInt(value) || value < -1 || value >= count) fail(`${what} ${String(value)} is not a blob in this file.`);
}

/**
 * Checks one layer entry's shape: the fields the loader uses directly, every
 * number finite, sizes within `maxSide`. Fields it does not know pass.
 */
function checkLayer(value: unknown, i: number, maxSide: number, pixelCount: number, maskCount: number): void {
  const where = `layer ${i}`;
  if (!isRecord(value)) fail(`${where} is not an object.`);
  if (typeof value.id !== 'string' || value.id.length === 0 || value.id.length > 256) fail(`${where} has no valid id.`);
  if (typeof value.type !== 'string' || value.type.length > 32) fail(`${where} has no valid type.`);
  for (const [key, v] of Object.entries(value)) {
    if (typeof v === 'number' && !Number.isFinite(v)) fail(`${where}: ${key} must be finite.`);
  }
  checkOptional(value, 'name', 'string', where);
  checkOptional(value, 'text', 'string', where, MAX_TEXT_LENGTH);
  checkOptional(value, 'blendMode', 'string', where, 64);
  checkOptional(value, 'visible', 'boolean', where);
  checkOptional(value, 'locked', 'boolean', where);
  checkOptional(value, 'clipToBelow', 'boolean', where);
  checkOptional(value, 'opacity', 'number', where);
  for (const key of ['x', 'y'] as const) {
    const v = value[key];
    if (v !== undefined && (typeof v !== 'number' || Math.abs(v) > MAX_OFFSET)) fail(`${where}: ${key} is out of range.`);
  }
  if (value.type === 'raster') {
    for (const key of ['width', 'height'] as const) {
      if (value[key] !== undefined) checkSide(value[key], `${where} ${key}`, maxSide, 0);
    }
  }
  for (const key of ['pixelWidth', 'pixelHeight', 'maskWidth', 'maskHeight'] as const) {
    if (value[key] !== undefined) checkSide(value[key], `${where} ${key}`, maxSide, 0);
  }
  checkIndex(value.pixelDataIndex, `${where} pixel data`, pixelCount);
  checkIndex(value.maskDataIndex, `${where} mask data`, maskCount);
  if (value.pixelFormat !== undefined && value.pixelFormat !== PIXEL_FORMAT_RGBA16_LZ4) {
    fail(`${where} has an unknown pixel format.`);
  }
  if (value.children !== undefined) {
    if (!Array.isArray(value.children) || value.children.length > MAX_LAYERS || value.children.some((c) => typeof c !== 'string')) {
      fail(`${where} has invalid children.`);
    }
  }
}

/**
 * The manifest, checked. `pixelBlobCount` and `maskBlobCount` are how many
 * blobs of each kind the blob table holds, so every index can be checked.
 */
export function validateManifest(value: unknown, maxSide: number, blobCount: number): LopsyManifest {
  if (!isRecord(value)) fail('the manifest is not an object.');
  checkOptional(value, 'documentName', 'string', 'the document');
  checkSide(value.documentWidth, 'the document width', maxSide);
  checkSide(value.documentHeight, 'the document height', maxSide);
  if (value.backgroundColor !== undefined) checkColor(value.backgroundColor, 'the background colour');
  if (!Array.isArray(value.layers)) fail('the manifest has no layer list.');
  if (value.layers.length > MAX_LAYERS) fail(`the file has ${value.layers.length} layers; at most ${MAX_LAYERS} are allowed.`);
  if (!Array.isArray(value.layerOrder) || value.layerOrder.length > MAX_LAYERS || value.layerOrder.some((id) => typeof id !== 'string')) {
    fail('the layer order is invalid.');
  }
  for (const key of ['rootGroupId', 'activeLayerId'] as const) {
    const v = value[key];
    if (v !== undefined && v !== null && typeof v !== 'string') fail(`${key} must be a string.`);
  }
  for (const key of ['paths', 'guides', 'indexedPalette'] as const) {
    const v = value[key];
    if (v !== undefined && (!Array.isArray(v) || v.length > MAX_LIST_LENGTH)) fail(`${key} must be a list.`);
  }
  checkOptional(value, 'dpi', 'number', 'the document');
  checkOptional(value, 'colorMode', 'string', 'the document', 32);

  const layers = value.layers as unknown[];
  const pixelCount = layers.filter((l) => isRecord(l) && isInt(l.pixelDataIndex) && l.pixelDataIndex >= 0).length;
  const maskCount = blobCount - pixelCount;
  if (maskCount < 0) fail('the blob table holds fewer blobs than the layers use.');
  layers.forEach((layer, i) => checkLayer(layer, i, maxSide, pixelCount, maskCount));

  let totalPixels = 0;
  for (const layer of layers as SerializedLayer[]) {
    const { width, height } = pixelBlobSize(layer);
    totalPixels += width * height;
  }
  if (totalPixels > MAX_TOTAL_PIXELS) fail('its layers hold more pixels than Lopsy can open.');
  return value as unknown as LopsyManifest;
}

/** The size of a layer's pixel blob: the recorded dimensions, else (older files) the layer's own size. */
export function pixelBlobSize(layer: SerializedLayer): { width: number; height: number } {
  if (layer.pixelDataIndex < 0) return { width: 0, height: 0 };
  return { width: layer.pixelWidth ?? layer.width ?? 0, height: layer.pixelHeight ?? layer.height ?? 0 };
}

export interface ProjectContainer {
  readonly version: number;
  readonly manifest: LopsyManifest;
  /** Every blob, in table order: pixel blobs first, then mask blobs. */
  readonly blobs: readonly Uint8Array[];
  readonly pixelBlobCount: number;
}

/**
 * Parses and checks a whole `.lopsy` file without decompressing anything.
 * Throws `ProjectFormatError` (or the newer-version error) with a message
 * for the "Failed to load project" toast.
 */
export function readProjectContainer(buffer: ArrayBuffer, options: { maxSide: number; supportedVersion: number }): ProjectContainer {
  const view = new DataView(buffer);
  if (view.byteLength < HEADER_BYTES || LOPSY_MAGIC.some((b, i) => view.getUint8(i) !== b)) {
    throw new ProjectFormatError('Not a valid .lopsy file — missing magic bytes.');
  }
  const version = view.getUint16(6, true);
  if (version > options.supportedVersion) {
    throw new ProjectFormatError(`This .lopsy file was saved with a newer version of Lopsy (format v${version}). Please update the app.`);
  }
  const manifestLength = view.getUint32(8, true);
  if (manifestLength > MAX_MANIFEST_BYTES || HEADER_BYTES + manifestLength + 4 > buffer.byteLength) {
    fail('the manifest does not fit in the file.');
  }
  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(buffer, HEADER_BYTES, manifestLength)));
  } catch {
    fail('the manifest is not valid JSON.');
  }

  const tableStart = HEADER_BYTES + manifestLength;
  const blobCount = view.getUint32(tableStart, true);
  // The table itself must fit in the file — rejects corrupt counts before
  // the read loop walks off the end of the buffer.
  if (blobCount > 2 * MAX_LAYERS || tableStart + 4 + blobCount * 4 > buffer.byteLength) {
    fail(`blob table claims ${blobCount} entries but the file is too small`);
  }
  const blobs: Uint8Array[] = [];
  let offset = tableStart + 4 + blobCount * 4;
  for (let i = 0; i < blobCount; i++) {
    const size = view.getUint32(tableStart + 4 + i * 4, true);
    if (offset + size > buffer.byteLength) fail(`blob ${i} runs past the end of the file.`);
    blobs.push(new Uint8Array(buffer, offset, size));
    offset += size;
  }

  const manifest = validateManifest(manifestJson, options.maxSide, blobCount);
  const pixelBlobCount = manifest.layers.filter((l) => l.pixelDataIndex >= 0).length;
  for (const layer of manifest.layers) checkLayerBlobs(layer, blobs, pixelBlobCount);
  return { version, manifest, blobs, pixelBlobCount };
}

/** Checks a layer's blobs against its manifest entry: mask sizes exactly, 16-bit headers exactly. */
function checkLayerBlobs(layer: SerializedLayer, blobs: readonly Uint8Array[], pixelBlobCount: number): void {
  if (layer.maskDataIndex >= 0 && layer.maskWidth != null && layer.maskHeight != null) {
    const mask = blobs[pixelBlobCount + layer.maskDataIndex];
    if (!mask || mask.byteLength !== layer.maskWidth * layer.maskHeight) {
      fail(`the mask of layer "${layer.name}" is not ${layer.maskWidth} × ${layer.maskHeight}.`);
    }
  }
  if (layer.pixelDataIndex < 0) return;
  const blob = blobs[layer.pixelDataIndex];
  if (!blob) fail(`layer "${layer.name}" has no pixel data.`);
  const { width, height } = pixelBlobSize(layer);
  if (layer.pixelFormat === PIXEL_FORMAT_RGBA16_LZ4) checkU16Blob(blob, width, height, layer.name);
}

/**
 * Checks a 16-bit blob's header against the layer: the full size is the
 * layer's pixel size, the crop lies inside it, and the stated uncompressed
 * size is exactly the crop's (the engine allocates what the header says).
 */
export function checkU16Blob(blob: Uint8Array, width: number, height: number, name: string): void {
  if (blob.byteLength < 24) fail(`the pixels of layer "${name}" are truncated.`);
  const header = new DataView(blob.buffer, blob.byteOffset, Math.min(blob.byteLength, 32));
  const [cropX, cropY, cropW, cropH, fullW, fullH] = [0, 4, 8, 12, 16, 20].map((at) => header.getInt32(at, true)) as [
    number, number, number, number, number, number,
  ];
  if (fullW !== width || fullH !== height) fail(`the pixels of layer "${name}" are ${fullW} × ${fullH}, not ${width} × ${height}.`);
  if (cropW <= 0 || cropH <= 0 || cropX < 0 || cropY < 0 || cropX + cropW > fullW || cropY + cropH > fullH) {
    fail(`the pixels of layer "${name}" have an invalid crop.`);
  }
  const rawBytes = cropW * cropH * 4 * 2;
  if (blob.byteLength === 24 + rawBytes) return;
  if (blob.byteLength < 32) fail(`the pixels of layer "${name}" are truncated.`);
  const flags = header.getInt32(24, true);
  const uncompressed = header.getUint32(28, true);
  if (flags < 0 || flags > 2 || uncompressed !== rawBytes) fail(`the pixels of layer "${name}" do not match their size.`);
  if (flags === 0 && blob.byteLength !== 32 + rawBytes) fail(`the pixels of layer "${name}" do not match their size.`);
}

/**
 * Gunzips `compressed` into a buffer of exactly `expectedBytes`, stopping as
 * soon as the output would be larger. Rejects when it is larger or smaller.
 */
export async function inflateExact(compressed: Uint8Array, expectedBytes: number): Promise<Uint8Array> {
  const out = new Uint8Array(expectedBytes);
  const stream = new DecompressionStream('gzip');
  const writer = stream.writable.getWriter();
  const input = new Uint8Array(compressed.byteLength);
  input.set(compressed);
  writer.write(input).catch(() => {});
  writer.close().catch(() => {});
  const reader = stream.readable.getReader();
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (length + value.byteLength > expectedBytes) {
        await reader.cancel().catch(() => {});
        fail(`a layer's pixels unpack to more than the ${expectedBytes} bytes its size allows.`);
      }
      out.set(value, length);
      length += value.byteLength;
    }
  } catch (err) {
    if (err instanceof ProjectFormatError) throw err;
    fail('a layer’s pixels could not be unpacked.');
  }
  if (length !== expectedBytes) fail(`a layer's pixels unpack to ${length} bytes, not ${expectedBytes}.`);
  return out;
}
