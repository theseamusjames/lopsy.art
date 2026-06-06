/**
 * Project Save — serializes the full Lopsy document state to a .lopsy file
 * and triggers a browser download.
 *
 * File format (binary):
 *   [4 bytes: manifest JSON byte length (uint32 LE)]
 *   [N bytes: manifest JSON (UTF-8)]
 *   [for each layer with pixel data: gzip-compressed raw RGBA bytes]
 *   [for each layer with mask data: raw mask bytes]
 *
 * The manifest contains enough metadata to reconstruct the full layer stack.
 * Pixel data blobs are referenced by index in the manifest's pixelDataIndex.
 */

import { useEditorStore } from '../app/editor-store';
import { getEngine } from '../engine-wasm/engine-state';
import { readLayerAsImageData } from '../engine-wasm/gpu-pixel-access';
import { finalizePendingStrokeGlobal } from '../app/interactions/pending-stroke';
import { flushLayerSync } from '../engine-wasm/engine-sync';
import { notifyError, describeError } from '../app/notifications-store';
import type { Layer } from '../types/layers';

const LOPSY_MAGIC = new Uint8Array([0x4c, 0x4f, 0x50, 0x53, 0x59, 0x00]); // "LOPSY\0"
const FORMAT_VERSION = 1;

export interface LopsyManifest {
  readonly version: number;
  readonly documentName: string;
  readonly documentWidth: number;
  readonly documentHeight: number;
  readonly backgroundColor: { r: number; g: number; b: number; a: number };
  readonly layers: readonly SerializedLayer[];
  readonly layerOrder: readonly string[];
  readonly rootGroupId: string | null;
  readonly activeLayerId: string | null;
}

// Serialized layer — all layer fields except pixel data (which is stored as blobs)
export interface SerializedLayer {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly visible: boolean;
  readonly locked: boolean;
  readonly opacity: number;
  readonly blendMode: string;
  readonly x: number;
  readonly y: number;
  readonly clipToBelow: boolean;
  readonly effects: unknown;
  // raster
  readonly width?: number;
  readonly height?: number;
  // text
  readonly text?: string;
  readonly fontFamily?: string;
  readonly fontSize?: number;
  readonly fontWeight?: number;
  readonly fontStyle?: string;
  readonly color?: unknown;
  readonly lineHeight?: number;
  readonly letterSpacing?: number;
  readonly textAlign?: string;
  readonly textWidth?: number | null;
  readonly underline?: boolean;
  readonly strikethrough?: boolean;
  // shape
  readonly shapeType?: string;
  readonly fill?: unknown;
  readonly stroke?: unknown;
  readonly strokeWidth?: number;
  readonly points?: unknown[];
  readonly cornerRadius?: number;
  // group
  readonly children?: readonly string[];
  readonly collapsed?: boolean;
  readonly adjustments?: unknown;
  readonly adjustmentsEnabled?: boolean;
  // mask
  readonly maskEnabled?: boolean;
  readonly maskWidth?: number;
  readonly maskHeight?: number;
  /** Index into the pixel data blobs list (-1 = no pixel data) */
  readonly pixelDataIndex: number;
  /** Index into the mask data blobs list (-1 = no mask data) */
  readonly maskDataIndex: number;
  /** True dimensions of the pixel blob (the rendered bitmap), independent of
   * the layer's logical width/height. Absent in pre-fix v1 files. */
  readonly pixelWidth?: number;
  readonly pixelHeight?: number;
}

function serializeLayer(
  layer: Layer,
  pixelDataIndex: number,
  maskDataIndex: number,
  pixelWidth: number,
  pixelHeight: number,
): SerializedLayer {
  const base = {
    id: layer.id,
    name: layer.name,
    type: layer.type,
    visible: layer.visible,
    locked: layer.locked,
    opacity: layer.opacity,
    blendMode: layer.blendMode,
    x: layer.x,
    y: layer.y,
    clipToBelow: layer.clipToBelow,
    effects: layer.effects,
    pixelDataIndex,
    maskDataIndex,
    pixelWidth,
    pixelHeight,
    maskEnabled: layer.mask?.enabled,
    maskWidth: layer.mask?.width,
    maskHeight: layer.mask?.height,
  };

  if (layer.type === 'raster') {
    return { ...base, width: layer.width, height: layer.height };
  }
  if (layer.type === 'text') {
    return {
      ...base,
      text: layer.text,
      fontFamily: layer.fontFamily,
      fontSize: layer.fontSize,
      fontWeight: layer.fontWeight,
      fontStyle: layer.fontStyle,
      color: layer.color,
      lineHeight: layer.lineHeight,
      letterSpacing: layer.letterSpacing,
      textAlign: layer.textAlign,
      textWidth: layer.width,
      underline: layer.underline,
      strikethrough: layer.strikethrough,
    };
  }
  if (layer.type === 'shape') {
    return {
      ...base,
      shapeType: layer.shapeType,
      fill: layer.fill,
      stroke: layer.stroke,
      strokeWidth: layer.strokeWidth,
      points: [...layer.points],
      width: layer.width,
      height: layer.height,
      cornerRadius: layer.cornerRadius,
    };
  }
  if (layer.type === 'group') {
    return {
      ...base,
      children: layer.children,
      collapsed: layer.collapsed,
      adjustments: layer.adjustments,
      adjustmentsEnabled: layer.adjustmentsEnabled,
    };
  }
  return base;
}

async function compressBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new CompressionStream('gzip');
  const writer = stream.writable.getWriter();
  // Copy to a plain ArrayBuffer to satisfy the WritableStreamDefaultWriter
  // overloads which require ArrayBufferView<ArrayBuffer> (not SharedArrayBuffer).
  const copyBuf = new Uint8Array(bytes.length);
  copyBuf.set(bytes);
  writer.write(copyBuf);
  writer.close();

  const chunks: Uint8Array[] = [];
  const reader = stream.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const totalLen = chunks.reduce((s, c) => s + c.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/**
 * Save the current project to a .lopsy file and trigger a download.
 */
export async function saveProject(): Promise<void> {
  const engine = getEngine();
  if (!engine) {
    notifyError('Cannot save: engine not ready.');
    return;
  }

  try {
    finalizePendingStrokeGlobal();
    const state = useEditorStore.getState();
    flushLayerSync(state);

    const { document: doc } = state;

    const pixelBlobs: Uint8Array[] = [];
    const maskBlobs: Uint8Array[] = [];

    const serializedLayers: SerializedLayer[] = [];
    for (const layer of doc.layers) {
      let pixelDataIndex = -1;
      let maskDataIndex = -1;
      let pixelWidth = 0;
      let pixelHeight = 0;

      // Read pixel data for raster layers (not groups — they have no texture)
      if (layer.type !== 'group') {
        const imageData = readLayerAsImageData(layer.id);
        if (imageData) {
          const raw = new Uint8Array(imageData.data.buffer, imageData.data.byteOffset, imageData.data.byteLength);
          const compressed = await compressBytes(raw);
          pixelDataIndex = pixelBlobs.length;
          pixelBlobs.push(compressed);
          // Record the blob's true dimensions. For text/shape layers these
          // differ from the layer's logical width/height (e.g. text width is
          // the box width, not the rendered bitmap), so the load path can't
          // infer them and must read them back from here.
          pixelWidth = imageData.width;
          pixelHeight = imageData.height;
        }
      }

      // Read mask data if present
      if (layer.mask && layer.mask.data.length > 0) {
        const maskBytes = new Uint8Array(layer.mask.data.buffer, layer.mask.data.byteOffset, layer.mask.data.byteLength);
        maskDataIndex = maskBlobs.length;
        maskBlobs.push(maskBytes);
      }

      serializedLayers.push(serializeLayer(layer, pixelDataIndex, maskDataIndex, pixelWidth, pixelHeight));
    }

    const manifest: LopsyManifest = {
      version: FORMAT_VERSION,
      documentName: doc.name,
      documentWidth: doc.width,
      documentHeight: doc.height,
      backgroundColor: doc.backgroundColor,
      layers: serializedLayers,
      layerOrder: doc.layerOrder,
      rootGroupId: doc.rootGroupId ?? null,
      activeLayerId: doc.activeLayerId ?? null,
    };

    const manifestJson = JSON.stringify(manifest);
    const manifestBytes = new TextEncoder().encode(manifestJson);

    // Build the pixel-blob size table: [count: u32 LE][size0: u32 LE][size1: u32 LE]...
    const allBlobs = [...pixelBlobs, ...maskBlobs];
    const blobSizeTableLen = (1 + allBlobs.length) * 4;
    const blobSizeTable = new Uint8Array(blobSizeTableLen);
    const blobSizeView = new DataView(blobSizeTable.buffer);
    blobSizeView.setUint32(0, allBlobs.length, true);
    let offset = 4;
    for (const blob of allBlobs) {
      blobSizeView.setUint32(offset, blob.length, true);
      offset += 4;
    }

    // Header: magic(6) + version(2) + manifest length(4)
    const header = new Uint8Array(12);
    header.set(LOPSY_MAGIC, 0);
    const headerView = new DataView(header.buffer);
    headerView.setUint16(6, FORMAT_VERSION, true);
    headerView.setUint32(8, manifestBytes.length, true);

    // Copy each Uint8Array into a plain ArrayBuffer for Blob compatibility.
    // Slice alone can return SharedArrayBuffer, so we copy into a fresh ArrayBuffer.
    const toArrayBuffer = (u: Uint8Array): ArrayBuffer => {
      const out = new ArrayBuffer(u.length);
      new Uint8Array(out).set(u);
      return out;
    };
    const parts: BlobPart[] = [
      toArrayBuffer(header),
      toArrayBuffer(manifestBytes),
      toArrayBuffer(blobSizeTable),
      ...allBlobs.map(toArrayBuffer),
    ];

    const blob = new Blob(parts, { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${doc.name || 'lopsy'}.lopsy`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    useEditorStore.getState().markClean();
  } catch (err) {
    notifyError(`Failed to save project: ${describeError(err)}`);
  }
}
