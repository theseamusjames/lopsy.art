/**
 * Project Load — parses a .lopsy file and restores the full document state.
 *
 * See project-save.ts for the file format specification.
 */

import { useEditorStore } from '../app/editor-store';
import { useUIStore } from '../app/ui-store';
import { getEngine } from '../engine-wasm/engine-state';
import { initWasm, uploadLayerPixels, uploadLayerMask, uploadLayerPixelsCompressedU16 } from '../engine-wasm/wasm-bridge';
import { resetTrackedState, flushLayerSync, syncDocumentSize, forgetTextLayerLayout } from '../engine-wasm/engine-sync';
import { extractFamilyName } from '../utils/font-loader';
import { pixelDataManager } from '../engine/pixel-data-manager';
import { notifyError, describeError } from '../app/notifications-store';
import { loadDocumentFonts } from '../app/load-document-fonts';
import type { Layer, RasterLayer, TextLayer, ShapeLayer, GroupLayer } from '../types/layers';
import type { Color } from '../types/color';
import type { AdjustmentNode } from '../types/adjustment-nodes';
import { FORMAT_VERSION, PIXEL_FORMAT_RGBA16_LZ4, type SerializedLayer } from './project-save';
import { inflateExact, pixelBlobSize, readProjectContainer } from './project-format';
import { getMaxDocumentSide } from '../engine-wasm/gpu-limits';
import { effectsForFormatVersion, parseStoredEffects } from './layer-effects-format';
import { parseStoredColorSpans } from '../tools/text/text-color-spans';

const SUPPORTED_VERSION = FORMAT_VERSION;

/**
 * Rebuild a layer from its manifest entry. `formatVersion` is the file's
 * header version; effects from files older than the stroked-silhouette
 * change are migrated so they keep their look.
 */
export function deserializeLayer(s: SerializedLayer, formatVersion: number = SUPPORTED_VERSION): Layer {
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
    effects: effectsForFormatVersion(parseStoredEffects(s.effects), formatVersion),
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
    const colorSpans = parseStoredColorSpans(s.colorSpans);
    const layer: TextLayer = {
      ...base,
      type: 'text',
      text: s.text ?? '',
      fontFamily: s.fontFamily ?? 'Inter',
      fontSize: s.fontSize ?? 24,
      fontWeight: s.fontWeight ?? 400,
      fontStyle: (s.fontStyle as TextLayer['fontStyle']) ?? 'normal',
      color: (s.color as Color) ?? { r: 0, g: 0, b: 0, a: 1 },
      ...(colorSpans && { colorSpans }),
      lineHeight: s.lineHeight ?? 1.4,
      letterSpacing: s.letterSpacing ?? 0,
      paragraphSpacing: s.paragraphSpacing ?? 0,
      textAlign: (s.textAlign as TextLayer['textAlign']) ?? 'left',
      width: s.textWidth ?? null,
      underline: s.underline ?? false,
      strikethrough: s.strikethrough ?? false,
      vertical: s.vertical ?? false,
      ...(s.pathId !== undefined && { pathId: s.pathId }),
      ...(s.prePathX !== undefined && { prePathX: s.prePathX }),
      ...(s.prePathY !== undefined && { prePathY: s.prePathY }),
      ...(s.pathAnchorX !== undefined && { pathAnchorX: s.pathAnchorX }),
      ...(s.pathAnchorY !== undefined && { pathAnchorY: s.pathAnchorY }),
      ...(s.textTransform !== undefined && { transform: s.textTransform }),
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
/**
 * A reopened document's font arrives after the overlay may already have laid
 * its text out with the fallback face; drop those layouts so the next
 * measurement matches the saved pixels (#1213).
 */
function forgetFamilyLayouts(family: string): void {
  const engine = getEngine();
  if (!engine) return;
  for (const layer of useEditorStore.getState().document.layers) {
    if (layer.type !== 'text') continue;
    if (extractFamilyName((layer as TextLayer).fontFamily) !== family) continue;
    forgetTextLayerLayout(engine, layer as TextLayer);
  }
}

export async function loadProject(file: File): Promise<void> {
  useUIStore.getState().openModal({ kind: 'loading', message: 'Opening project…' });

  try {
    await initWasm();

    const arrayBuffer = await file.arrayBuffer();
    // Everything in the file is checked before the open document is replaced.
    const { version, manifest, blobs, pixelBlobCount } = readProjectContainer(arrayBuffer, {
      maxSide: getMaxDocumentSide(),
      supportedVersion: SUPPORTED_VERSION,
    });
    const header = { version };

    // Create fresh document with correct dimensions
    useEditorStore.getState().createDocument(manifest.documentWidth, manifest.documentHeight, true);

    const edState = useEditorStore.getState();

    // Deserialize layers — mask data (raw bytes) needs to be attached now so
    // the layer model is complete before we push to the store.
    const newLayers: Layer[] = [];
    for (const s of manifest.layers) {
      const layer = deserializeLayer(s, header.version);

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
        colorMode: manifest.colorMode ?? 'rgb',
        indexedPalette: manifest.indexedPalette,
        dpi: manifest.dpi,
        rootGroupId: manifest.rootGroupId,
      },
      dirtyLayerIds: new Set<string>(),
      isDirty: false,
      renderVersion: edState.renderVersion + 1,
      paths: [...(manifest.paths ?? [])],
      selectedPathId: null,
    });
    useUIStore.setState({ guides: [...(manifest.guides ?? [])], selectedGuideId: null });

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

        if (s.pixelFormat === PIXEL_FORMAT_RGBA16_LZ4) {
          // The blob carries its own geometry; the layer's position comes
          // from the descriptor flushLayerSync pushed above.
          uploadLayerPixelsCompressedU16(engine, s.id, blob);
          continue;
        }

        // Prefer the recorded blob dimensions; fall back to the layer's logical
        // size for older files. Text/shape layers must use the blob dimensions
        // because their logical width/height don't describe the bitmap.
        const { width: w, height: h } = pixelBlobSize(s);
        if (w > 0 && h > 0) {
          // Inflated with a cap of exactly the layer's size, so a small blob
          // can never unpack into more memory than the layer needs.
          const decompressed = await inflateExact(blob, w * h * 4);
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

      void loadDocumentFonts(newLayers, forgetFamilyLayouts);
    }

    useEditorStore.getState().fitToView();
    useUIStore.getState().closeModalOfKind('loading');
  } catch (err) {
    useUIStore.getState().closeModalOfKind('loading');
    notifyError(`Failed to load project: ${describeError(err)}`);
  }
}
