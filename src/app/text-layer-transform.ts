import type { Point, TextLayer } from '../types';
import { useEditorStore } from './editor-store';
import { getEngine } from '../engine-wasm/engine-state';
import { measureTextFrame, placeTextLayerAtAnchor } from '../engine-wasm/engine-sync';
import { clearJsPixelData } from './store/clear-js-pixel-data';
import { captureLayerGpu, releaseLayerGpu } from './store/layer-gpu-capture';
import {
  applyDocumentLinear,
  frameCentre,
  isUsableTextMatrix,
  placementProps,
  textTransformFor,
  type TextMatrix,
} from '../tools/text/text-transform';

/** A text layer's placement: its anchor in the document and its matrix. */
export interface TextPlacementTarget {
  readonly anchor: Point;
  readonly matrix: TextMatrix;
}

/**
 * Re-render `layer` from its text props at `placement` and store where the
 * texture landed. The glyphs are laid out afresh every time, so repeated
 * transforms never compound. Returns false when nothing could be drawn
 * (degenerate matrix, empty text, no engine) and leaves the layer alone.
 */
export function renderTextLayerPlacement(layer: TextLayer, placement: TextPlacementTarget): boolean {
  const engine = getEngine();
  if (!engine || !isUsableTextMatrix(placement.matrix)) return false;
  const next: TextLayer = {
    ...layer,
    transform: textTransformFor(placement.matrix, placement.anchor, layer.x, layer.y),
  };
  const pos = placeTextLayerAtAnchor(engine, next, placement.anchor.x, placement.anchor.y);
  if (!pos) return false;
  useEditorStore.getState().updateTextLayerProperties(layer.id, placementProps(pos));
  return true;
}

/** The text layer with `layerId` when it can take a live transform (not path text, not empty). */
export function transformableTextLayer(layerId: string | null): TextLayer | null {
  if (!layerId) return null;
  const layer = useEditorStore.getState().document.layers.find((l) => l.id === layerId);
  if (!layer || layer.type !== 'text' || layer.pathId) return null;
  return layer;
}

/**
 * Apply a document-space linear map (a flip or a quarter turn) to a text
 * layer, about `pivot` or the centre of its layout box, as one history step.
 * The text stays live. Returns false when the layer can't be transformed.
 */
export function transformTextLayerInDocument(
  layerId: string,
  f: TextMatrix,
  label: string,
  pivot?: Point,
): boolean {
  const engine = getEngine();
  const layer = transformableTextLayer(layerId);
  if (!engine || !layer) return false;
  const frame = measureTextFrame(engine, layer);
  if (!frame) return false;

  // Any cached JS copy of the old glyphs would be re-uploaded over the render.
  clearJsPixelData(layerId);
  const before = { layer, gpuHandle: captureLayerGpu(layerId) };
  const placement = applyDocumentLinear(frame, f, pivot ?? frameCentre(frame));
  if (!renderTextLayerPlacement(layer, placement)) {
    releaseLayerGpu(before.gpuHandle);
    return false;
  }
  const editor = useEditorStore.getState();
  editor.pushHistory(label, before);
  editor.notifyRender();
  return true;
}
