/**
 * Project Load — parses a .lopsy file and restores the full document state.
 *
 * See project-save.ts for the file format specification.
 */

import { useEditorStore } from '../app/editor-store';
import { useUIStore } from '../app/ui-store';
import { getEngine } from '../engine-wasm/engine-state';
import { initWasm, uploadLayerPixels, uploadLayerMask } from '../engine-wasm/wasm-bridge';
import { resetTrackedState, flushLayerSync, syncDocumentSize } from '../engine-wasm/engine-sync';
import { pixelDataManager } from '../engine/pixel-data-manager';
import { notifyError, describeError } from '../app/notifications-store';
import type { Layer, RasterLayer, TextLayer, ShapeLayer, GroupLayer } from '../types/layers';
import type { LayerEffects } from '../types/effects';
import type { Color } from '../types/color';
import type { AdjustmentNode } from '../types/adjustment-nodes';
import { DEFAULT_EFFECTS } from '../layers/layer-model';
import type { LopsyManifest, SerializedLayer } from './project-save';

const LOPSY_MAGIC = new Uint8Array([0x4c, 0x4f, 0x50, 0x53, 0x59, 0x00]); // "LOPSY\0"
const SUPPORTED_VERSION = 1;

function parseMagicAndVersion(view: DataView): { version: number } | null {
  if (view.byteLength < 12) return null;
  for (let i = 0; i < LOPSY_MAGIC.length; i++) {
    if (view.getUint8(i) !== LOPSY_MAGIC[i]) return null;
  }
  const version = view.getUint16(6, true);
  return { version };
}

async function decompressBytes(compressed: Uint8Array): Promise<Uint8Array> {
  const stream = new DecompressionStream('gzip');
  const writer = stream.writable.getWriter();
  // Copy to plain ArrayBuffer to satisfy WritableStreamDefaultWriter overloads
  // which require ArrayBufferView<ArrayBuffer> (not SharedArrayBuffer).
  const copyBuf = new Uint8Array(compressed.length);
  copyBuf.set(compressed);
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

function parseEffects(raw: unknown): LayerEffects {
  if (!raw || typeof raw !== 'object') return DEFAULT_EFFECTS;
  const e = raw as Partial<LayerEffects>;
  return {
    stroke: e.stroke ?? DEFAULT_EFFECTS.stroke,
    dropShadow: e.dropShadow ?? DEFAULT_EFFECTS.dropShadow,
    outerGlow: e.outerGlow ?? DEFAULT_EFFECTS.outerGlow,
    innerGlow: e.innerGlow ?? DEFAULT_EFFECTS.innerGlow,
    colorOverlay: e.colorOverlay ?? DEFAULT_EFFECTS.colorOverlay,
  };
}

function deserializeLayer(s: SerializedLayer): Layer {
  const base = {
    id: s.id,
    name: s.name,
    visible: s.visible,
    locked: s.locked,
    opacity: s.opacity,
    blendMode: s.blendMode as Layer['blendMode'],
    x: s.x,
    y: s.y,
    clipToBelow: s.clipToBelow,
    effects: parseEffects(s.effects),
    mask: null as null | {
      id: string;
      enabled: boolean;
      data: Uint8ClampedArray;
      width: number;
      height: number;
    },
  };

  if (s.type === 'raster') {
    const layer: RasterLayer = {
      ...base,
      type: 'raster',
      width: s.width ?? 0,
      height: s.height ?? 0,
    };
    return layer;
  }
  if (s.type === 'text') {
    const layer: TextLayer = {
      ...base,
      type: 'text',
      text: s.text ?? '',
      fontFamily: s.fontFamily ?? 'Inter',
      fontSize: s.fontSize ?? 24,
      fontWeight: s.fontWeight ?? 400,
      fontStyle: (s.fontStyle as TextLayer['fontStyle']) ?? 'normal',
      color: (s.color as Color) ?? { r: 0, g: 0, b: 0, a: 1 },
      lineHeight: s.lineHeight ?? 1.4,
      letterSpacing: s.letterSpacing ?? 0,
      textAlign: (s.textAlign as TextLayer['textAlign']) ?? 'left',
      width: s.textWidth ?? null,
      underline: s.underline ?? false,
      strikethrough: s.strikethrough ?? false,
    };
    return layer;
  }
  if (s.type === 'shape') {
    const layer: ShapeLayer = {
      ...base,
      type: 'shape',
      shapeType: (s.shapeType as ShapeLayer['shapeType']) ?? 'rectangle',
      fill: (s.fill as Color | null) ?? null,
      stroke: (s.stroke as Color | null) ?? null,
      strokeWidth: s.strokeWidth ?? 1,
      points: (s.points as ShapeLayer['points']) ?? [],
      width: s.width ?? 0,
      height: s.height ?? 0,
      cornerRadius: s.cornerRadius ?? 0,
    };
    return layer;
  }
  if (s.type === 'group') {
    const layer: GroupLayer = {
      ...base,
      type: 'group',
      children: (s.children as readonly string[]) ?? [],
      collapsed: s.collapsed ?? false,
      adjustments: Array.isArray(s.adjustments) ? (s.adjustments as readonly AdjustmentNode[]) : [],
      adjustmentsEnabled: s.adjustmentsEnabled ?? true,
    };
    return layer;
  }
  // Fallback — unknown type, treat as empty raster
  const fallback: RasterLayer = { ...base, type: 'raster', width: 0, height: 0 };
  return fallback;
}

async function waitForEngine(maxFrames = 60): Promise<ReturnType<typeof getEngine>> {
  for (let i = 0; i < maxFrames; i++) {
    const eng = getEngine();
    if (eng) return eng;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
  return getEngine();
}

/**
 * Load a .lopsy file and restore the document state.
 */
export async function loadProject(file: File): Promise<void> {
  useUIStore.getState().openModal({ kind: 'loading', message: 'Opening project…' });

  try {
    await initWasm();

    const arrayBuffer = await file.arrayBuffer();
    const view = new DataView(arrayBuffer);

    const header = parseMagicAndVersion(view);
    if (!header) {
      throw new Error('Not a valid .lopsy file — missing magic bytes.');
    }
    if (header.version > SUPPORTED_VERSION) {
      throw new Error(`This .lopsy file was saved with a newer version of Lopsy (format v${header.version}). Please update the app.`);
    }

    const manifestByteLen = view.getUint32(8, true);
    const manifestStart = 12;
    const manifestBytes = new Uint8Array(arrayBuffer, manifestStart, manifestByteLen);
    const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as LopsyManifest;

    // Parse the blob size table
    const blobTableStart = manifestStart + manifestByteLen;
    const blobTableView = new DataView(arrayBuffer, blobTableStart);
    const blobCount = blobTableView.getUint32(0, true);
    const blobSizes: number[] = [];
    for (let i = 0; i < blobCount; i++) {
      blobSizes.push(blobTableView.getUint32(4 + i * 4, true));
    }

    // Slice out the individual blobs
    let blobDataOffset = blobTableStart + 4 + blobCount * 4;
    const blobs: Uint8Array[] = [];
    for (const size of blobSizes) {
      blobs.push(new Uint8Array(arrayBuffer, blobDataOffset, size));
      blobDataOffset += size;
    }

    // Count pixel blobs vs mask blobs from the manifest
    const pixelBlobCount = manifest.layers.filter((l) => l.pixelDataIndex >= 0).length;

    // Create fresh document with correct dimensions
    useEditorStore.getState().createDocument(manifest.documentWidth, manifest.documentHeight, true);

    const edState = useEditorStore.getState();

    // Deserialize layers — mask data (raw bytes) needs to be attached now so
    // the layer model is complete before we push to the store.
    const newLayers: Layer[] = [];
    for (const s of manifest.layers) {
      const layer = deserializeLayer(s);

      if (s.maskDataIndex >= 0 && s.maskWidth != null && s.maskHeight != null) {
        const maskBlob = blobs[pixelBlobCount + s.maskDataIndex];
        if (maskBlob) {
          const maskData = new Uint8ClampedArray(maskBlob.buffer, maskBlob.byteOffset, maskBlob.byteLength);
          (layer as { mask: unknown }).mask = {
            id: crypto.randomUUID(),
            enabled: s.maskEnabled ?? true,
            data: maskData,
            width: s.maskWidth,
            height: s.maskHeight,
          };
        }
      }

      newLayers.push(layer);
    }

    // Push layer and document state to the store
    pixelDataManager.replace(new Map(), new Map());
    useEditorStore.setState({
      document: {
        ...edState.document,
        name: manifest.documentName,
        width: manifest.documentWidth,
        height: manifest.documentHeight,
        layers: newLayers,
        layerOrder: [...manifest.layerOrder],
        activeLayerId: manifest.activeLayerId,
        backgroundColor: manifest.backgroundColor,
        rootGroupId: manifest.rootGroupId,
      },
      dirtyLayerIds: new Set<string>(),
      isDirty: false,
      renderVersion: edState.renderVersion + 1,
    });

    // Wait for the engine (it may be initializing after createDocument)
    const engine = await waitForEngine();
    if (engine) {
      resetTrackedState(engine);
      // Sync the document dimensions to the engine before any rAF-triggered
      // expand/crop operations can run. Without this, the engine still has
      // doc_width=1,doc_height=1 (the freshly-created engine default) and
      // expand_layer_to_doc_size would return a 1x1 texture for offset layers.
      syncDocumentSize(engine, manifest.documentWidth, manifest.documentHeight);
      flushLayerSync(useEditorStore.getState());

      // Upload decompressed pixel data for each raster layer
      for (const s of manifest.layers) {
        if (s.pixelDataIndex < 0) continue;

        const layer = newLayers.find((l) => l.id === s.id);
        if (!layer || layer.type === 'group') continue;

        const blob = blobs[s.pixelDataIndex];
        if (!blob) continue;

        const decompressed = await decompressBytes(blob);
        const w = s.width ?? 0;
        const h = s.height ?? 0;
        if (w > 0 && h > 0) {
          uploadLayerPixels(engine, s.id, decompressed, w, h, s.x, s.y);
        }
      }

      // Upload mask data
      for (const s of manifest.layers) {
        if (s.maskDataIndex < 0) continue;

        const layer = newLayers.find((l) => l.id === s.id);
        if (!layer || !layer.mask) continue;

        const maskBytes = new Uint8Array(
          layer.mask.data.buffer,
          layer.mask.data.byteOffset,
          layer.mask.data.byteLength,
        );
        uploadLayerMask(engine, s.id, maskBytes, layer.mask.width, layer.mask.height);
      }
    }

    useEditorStore.getState().fitToView();
    useUIStore.getState().closeModalOfKind('loading');
  } catch (err) {
    useUIStore.getState().closeModalOfKind('loading');
    notifyError(`Failed to load project: ${describeError(err)}`);
  }
}
