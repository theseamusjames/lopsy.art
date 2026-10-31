import type { DocumentState, Layer, Point, TextLayer } from '../../../types';
import type { RasterLayer } from '../../../types/layers';
import type { StoredPath } from '../../../types/paths';
import type { Guide } from '../../ui-store';
import type { ActionResult } from '../types';
import { scaleLayerTexture } from '../../../engine-wasm/wasm-bridge';
import { mapLayersForTransform, scaleLayerEffects, scaleTextLayerForResize } from './_helpers/layer-transform';
import { remapDocumentMasks } from './_helpers/remap-layer-masks';
import { getEngine } from '../../../engine-wasm/engine-state';
import { scaling } from '../../../layers/mask-remap';

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
      // Raster layers are stored cropped to their content bounds, so their
      // texture is layer.width x layer.height positioned at (x, y) — not
      // necessarily the full document. Scale the layer's own dimensions and
      // position by the document scale factor; substituting the document size
      // here would stretch a small layer to fill the whole canvas.
      const raster = layer as RasterLayer;
      const scaledWidth = Math.max(1, Math.round(raster.width * scaleX));
      const scaledHeight = Math.max(1, Math.round(raster.height * scaleY));
      if (engine) {
        scaleLayerTexture(engine, layer.id, scaledWidth, scaledHeight);
      }
      return {
        ...layer,
        x: Math.round(layer.x * scaleX),
        y: Math.round(layer.y * scaleY),
        width: scaledWidth,
        height: scaledHeight,
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
