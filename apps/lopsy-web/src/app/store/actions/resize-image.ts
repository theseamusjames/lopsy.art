import type { DocumentState, Layer, Point, TextLayer } from '../../../types';
import type { RasterLayer } from '../../../types/layers';
import type { StoredPath } from '../../../types/paths';
import type { Guide } from '../../ui-store';
import type { ActionResult } from '../types';
import { resampleLayerTexture } from '../../../engine-wasm/wasm-bridge';
import { mapLayersForTransform, scaleLayerEffects, scaleTextLayerForResize } from './_helpers/layer-transform';
import { remapDocumentMasks } from './_helpers/remap-layer-masks';
import { getEngine } from '../../../engine-wasm/engine-state';
import { scaling } from '../../../layers/mask-remap';

/** One axis of a raster layer's box through Image Size. */
export interface ResampledSpan {
  /** New box origin in the new document, whole pixels. */
  origin: number;
  /** New box size, whole pixels, at least 1. */
  size: number;
  /** Source UV = destination UV * uvScale + uvOffset. */
  uvScale: number;
  uvOffset: number;
}

// Scaled edges within this of a whole pixel count as on it, so float error
// (10 / 3 * 3) does not add an empty row.
const EDGE_EPSILON = 1e-6;

/**
 * Raster layers are stored cropped to their content, at `start` with
 * `length` pixels. The layer's content must land exactly on
 * `[start * scale, (start + length) * scale)` in the new document, the same
 * map every other layer gets, so layers in register stay in register
 * (#1821). That span is rarely whole pixels, so the box snaps outward to
 * the pixels it touches and the texture is resampled over the box with the
 * content's sub-pixel origin kept, rather than stretched to a rounded size.
 */
export function planResampledSpan(start: number, length: number, scale: number): ResampledSpan {
  const from = start * scale;
  const to = (start + length) * scale;
  const origin = Math.floor(from + EDGE_EPSILON);
  const end = Math.max(origin + 1, Math.ceil(to - EDGE_EPSILON));
  const size = end - origin;
  return {
    origin,
    size,
    uvScale: size / (scale * length),
    uvOffset: (origin / scale - start) / length,
  };
}

export function computeResizeImage(
  doc: DocumentState,
  renderVersion: number,
  newWidth: number,
  newHeight: number,
): ActionResult {
  const scaleX = newWidth / doc.width;
  const scaleY = newHeight / doc.height;

  const scaledLayers = mapLayersForTransform(doc.layers, {
    onText: (layer) => scaleTextLayerForResize(layer as TextLayer, scaleX, scaleY) as Layer,
    onRaster: (layer, engine) => {
      const raster = layer as RasterLayer;
      const spanX = planResampledSpan(layer.x, raster.width, scaleX);
      const spanY = planResampledSpan(layer.y, raster.height, scaleY);
      if (engine) {
        resampleLayerTexture(
          engine, layer.id, spanX.size, spanY.size,
          spanX.uvScale, spanY.uvScale, spanX.uvOffset, spanY.uvOffset,
        );
      }
      return {
        ...layer,
        x: spanX.origin,
        y: spanY.origin,
        width: spanX.size,
        height: spanY.size,
        effects: scaleLayerEffects(layer.effects, scaleX, scaleY),
      } as Layer;
    },
  });
  const newLayers = remapDocumentMasks(getEngine(), doc.layers, scaledLayers, scaling(scaleX, scaleY), newWidth, newHeight);

  return {
    document: { ...doc, width: newWidth, height: newHeight, layers: newLayers },
    layerPixelData: new Map(),
    renderVersion: renderVersion + 1,
  };
}

/**
 * Paths and guides live in document coordinates, so Image Size scales them
 * with the pixels — otherwise path-bound text re-lays on the old geometry the
 * next time anything re-renders it (#1363).
 */
export function scalePathsForResize(
  paths: readonly StoredPath[],
  scaleX: number,
  scaleY: number,
): StoredPath[] {
  const scalePoint = (p: Point): Point => ({ x: p.x * scaleX, y: p.y * scaleY });
  return paths.map((path) => ({
    ...path,
    anchors: path.anchors.map((a) => ({
      point: scalePoint(a.point),
      handleIn: a.handleIn ? scalePoint(a.handleIn) : null,
      handleOut: a.handleOut ? scalePoint(a.handleOut) : null,
    })),
  }));
}

export function scaleGuidesForResize(guides: readonly Guide[], scaleX: number, scaleY: number): Guide[] {
  return guides.map((g) => ({
    ...g,
    position: g.position * (g.orientation === 'vertical' ? scaleX : scaleY),
  }));
}
