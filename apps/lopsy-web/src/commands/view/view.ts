import { CommandError } from '../command';
import { defineCommand } from '../registry';
import { colorHex, coordinateSpec, encodeBase64, layerRefSpec, requireDocument, requireEngine, resolveLayer } from '../context';
import { encodeCompositeImage, encodeImageData, type EncodedImage } from '../../io/export-image';
import { getLayerTextureDimensions, readCompositeThumbnail, sampleColor, type Engine } from '../../engine-wasm/wasm-bridge';
import { readLayerAsImageData, readLayerThumbnail } from '../../engine-wasm/gpu-pixel-access';
import { createImageData } from '../../engine/color-space';
import { colorFromSample, EYEDROPPER_SAMPLE_SIZE } from '../../tools/eyedropper/eyedropper-interaction';

/**
 * The longest side a render returns. 4096 x 4096 is 64 MiB of RGBA read back
 * and, as base64 PNG, tens of megabytes of JSON: more than an agent needs to
 * look at its work, and bigger reads stall the page. Larger documents are
 * scaled down to it.
 */
export const MAX_RENDER_SIDE = 4096;

/** A thumbnail readback opens with [width u32 LE, height u32 LE]. */
const THUMBNAIL_HEADER_BYTES = 8;

export interface RenderResult {
  mime: string;
  width: number;
  height: number;
  base64: string;
}

export interface LayerRenderResult extends RenderResult {
  /** Where the image's top-left corner sits in the document, in pixels. */
  x: number;
  y: number;
}

const maxSizeSpec = {
  type: 'number',
  integer: true,
  min: 1,
  max: MAX_RENDER_SIDE,
  optional: true,
  description: `The longest side of the returned image in pixels; the aspect ratio is kept and nothing is scaled up. Omitted means full size, up to ${MAX_RENDER_SIDE}.`,
} as const;

const formatSpec = { type: 'string', enum: ['png'], default: 'png' } as const;

function renderResult(image: EncodedImage | null, what: string): RenderResult {
  if (!image) throw new CommandError('unavailable', `${what} could not be encoded: it is empty, or the page has no 2D canvas.`);
  return { mime: image.mime, width: image.width, height: image.height, base64: encodeBase64(image.bytes) };
}

function renderLimit(maxSize: number | undefined): number {
  return Math.min(maxSize ?? MAX_RENDER_SIDE, MAX_RENDER_SIDE);
}

/** RGBA bytes as ImageData in the working colour space, as the export composite is. */
function workingImageData(bytes: Uint8Array | Uint8ClampedArray, width: number, height: number): ImageData {
  const imageData = createImageData(width, height);
  imageData.data.set(bytes.subarray(0, width * height * 4));
  return imageData;
}

async function compositeThumbnail(engine: Engine, maxSize: number): Promise<ImageData | null> {
  const data = await readCompositeThumbnail(engine, maxSize);
  if (data.length < THUMBNAIL_HEADER_BYTES) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const width = view.getUint32(0, true);
  const height = view.getUint32(4, true);
  if (width === 0 || height === 0 || data.length < THUMBNAIL_HEADER_BYTES + width * height * 4) return null;
  return workingImageData(data.subarray(THUMBNAIL_HEADER_BYTES), width, height);
}

async function renderComposite(engine: Engine, limit: number, longest: number): Promise<EncodedImage | null> {
  if (limit >= longest) return encodeCompositeImage(engine, { format: 'png', quality: 100, highQuality: false });
  const thumbnail = await compositeThumbnail(engine, limit);
  return thumbnail ? encodeImageData(thumbnail, 'png', 100) : null;
}

export const viewRender = defineCommand({
  id: 'view.render',
  summary:
    'Renders the flattened document (every visible layer with its effects, masks and adjustments; no workspace, rulers, selection outline or handles) as a PNG for looking at the result. Waits for pending work first and changes nothing. Returns the image as base64 with its size.',
  surface: 'document',
  settles: 'before',
  check: requireDocument,
  params: { maxSize: maxSizeSpec, format: formatSpec },
  run({ maxSize }): Promise<RenderResult> {
    const doc = requireDocument();
    const engine = requireEngine();
    const pending = renderComposite(engine, renderLimit(maxSize), Math.max(doc.width, doc.height));
    return pending.then((image) => renderResult(image, 'The document'));
  },
});

function textureSize(engine: Engine, layerId: string): { width: number; height: number } {
  const dims = getLayerTextureDimensions(engine, layerId);
  return { width: dims[0] ?? 0, height: dims[1] ?? 0 };
}

async function layerPixels(layerId: string, longest: number, limit: number): Promise<ImageData | null> {
  const imageData = limit >= longest ? await readLayerAsImageData(layerId) : await readLayerThumbnail(layerId, limit);
  return imageData ? workingImageData(imageData.data, imageData.width, imageData.height) : null;
}

export const viewRenderLayer = defineCommand({
  id: 'view.render-layer',
  summary:
    'Renders one layer\'s own pixels (no effects, mask or adjustments; transparent where it is empty) as a PNG of its texture, with x and y giving where that texture sits in the document. Waits for pending work first and changes nothing. Refused for a group.',
  surface: 'document',
  settles: 'before',
  check: requireDocument,
  params: { layer: layerRefSpec, maxSize: maxSizeSpec, format: formatSpec },
  async run({ layer: ref, maxSize }): Promise<LayerRenderResult> {
    requireDocument();
    const layer = resolveLayer(ref);
    const engine = requireEngine();
    if (layer.type === 'group') throw new CommandError('refused', `"${layer.name}" is a group: it has no pixels of its own.`);
    const { width, height } = textureSize(engine, layer.id);
    if (width === 0 || height === 0) throw new CommandError('refused', `"${layer.name}" has no pixels.`);
    const pixels = await layerPixels(layer.id, Math.max(width, height), renderLimit(maxSize));
    if (!pixels) throw new CommandError('unavailable', `"${layer.name}"'s pixels could not be read back.`);
    const image = await encodeImageData(pixels, 'png', 100);
    return { ...renderResult(image, `"${layer.name}"`), x: layer.x, y: layer.y };
  },
});

export interface SampleResult {
  /** "#rrggbb". */
  hex: string;
  /** Opacity, 0-1, as the foreground colour holds it. */
  alpha: number;
}

const sampleCoordinateSpec = (axis: string) =>
  coordinateSpec(`${axis} in document pixels; (0,0) is the top-left of the document.`, { integer: true });

export const viewSample = defineCommand({
  id: 'view.sample',
  summary:
    'Reads the colour the Eyedropper would pick at a document point: one pixel of the flattened document, in the document\'s colour mode decoded to RGB. Unlike the Eyedropper it leaves the foreground colour alone. Returns the colour as hex and its opacity 0-1.',
  surface: 'document',
  settles: 'before',
  check: requireDocument,
  params: { x: sampleCoordinateSpec('Column'), y: sampleCoordinateSpec('Row') },
  async run({ x, y }): Promise<SampleResult> {
    requireDocument();
    const engine = requireEngine();
    const color = colorFromSample(await sampleColor(engine, x, y, EYEDROPPER_SAMPLE_SIZE));
    if (!color) throw new CommandError('unavailable', 'The engine did not answer the sample.');
    return { hex: colorHex({ ...color, a: 1 }), alpha: color.a };
  },
});
