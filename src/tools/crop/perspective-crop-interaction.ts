/**
 * Perspective crop interaction — handles the 4-corner quadrilateral drag UI.
 *
 * On first activation, the quad is seeded from the full document rect.
 * The user drags individual corner handles. On commit the warp is applied
 * and the document is resized.
 */

import type { InteractionContext, InteractionState } from '../../app/interactions/interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from '../../app/interactions/interaction-types';
import type { Point } from '../../types';
import { useUIStore } from '../../app/ui-store';
import { useEditorStore } from '../../app/editor-store';
import { computePerspectiveTransform, applyPerspectiveWarp, inferOutputSize } from './perspective-crop';
import type { Quad } from './perspective-crop';
import { readLayerAsImageData } from '../../engine-wasm/gpu-pixel-access';
import { getEngine } from '../../engine-wasm/engine-state';
import { uploadLayerPixels } from '../../engine-wasm/wasm-bridge';

const HANDLE_RADIUS_DOC = 8; // hit-test radius in document space

type CornerIdx = 0 | 1 | 2 | 3;

/** Returns the default quad for a brand-new perspective crop (full doc). */
function defaultQuad(docWidth: number, docHeight: number): Quad {
  return {
    topLeft:     { x: 0,        y: 0 },
    topRight:    { x: docWidth, y: 0 },
    bottomRight: { x: docWidth, y: docHeight },
    bottomLeft:  { x: 0,        y: docHeight },
  };
}

/**
 * Hit-test which corner handle is under `pos` (doc-space), or null.
 * Uses a radius in doc-space that is scaled by zoom for comfortable interaction.
 */
function hitTestCorner(quad: Quad, pos: Point, zoom: number): CornerIdx | null {
  const r = HANDLE_RADIUS_DOC / zoom;
  const corners: [number, number][] = [
    [quad.topLeft.x,     quad.topLeft.y],
    [quad.topRight.x,    quad.topRight.y],
    [quad.bottomRight.x, quad.bottomRight.y],
    [quad.bottomLeft.x,  quad.bottomLeft.y],
  ];
  for (let i = 0; i < 4; i++) {
    const [cx, cy] = corners[i]!;
    const dx = pos.x - cx;
    const dy = pos.y - cy;
    if (dx * dx + dy * dy <= r * r) return i as CornerIdx;
  }
  return null;
}

/** Move one corner of the quad to a new position. */
function moveCorner(quad: Quad, idx: CornerIdx, pos: Point): Quad {
  switch (idx) {
    case 0: return { ...quad, topLeft:     { x: pos.x, y: pos.y } };
    case 1: return { ...quad, topRight:    { x: pos.x, y: pos.y } };
    case 2: return { ...quad, bottomRight: { x: pos.x, y: pos.y } };
    case 3: return { ...quad, bottomLeft:  { x: pos.x, y: pos.y } };
  }
}

export function handlePerspectiveCropDown(ctx: InteractionContext): InteractionState {
  const { canvasPos, activeLayerId } = ctx;
  const uiState = useUIStore.getState();
  const doc = useEditorStore.getState().document;
  const viewport = useEditorStore.getState().viewport;

  let quad = uiState.perspectiveCropQuad;
  if (!quad) {
    quad = defaultQuad(doc.width, doc.height);
    useUIStore.getState().setPerspectiveCropQuad(quad);
  }

  const hitIdx = hitTestCorner(quad, canvasPos, viewport.zoom);
  if (hitIdx !== null) {
    useUIStore.getState().setPerspectiveCropDragging(hitIdx);
  }

  return {
    drawing: true,
    lastPoint: canvasPos,
    layerId: activeLayerId,
    tool: 'crop',
    startPoint: canvasPos,
    layerStartX: 0,
    layerStartY: 0,
    ...DEFAULT_TRANSFORM_FIELDS,
  };
}

export function handlePerspectiveCropMove(state: InteractionState, canvasPos: Point): void {
  if (!state.drawing) return;
  const uiState = useUIStore.getState();
  const dragging = uiState.perspectiveCropDragging;
  if (dragging === null) return;

  const quad = uiState.perspectiveCropQuad;
  if (!quad) return;

  const updated = moveCorner(quad, dragging, canvasPos);
  useUIStore.getState().setPerspectiveCropQuad(updated);
  useEditorStore.getState().notifyRender();
}

export function handlePerspectiveCropUp(_state: InteractionState): void {
  useUIStore.getState().setPerspectiveCropDragging(null);
}

/**
 * Commit the perspective crop: warp pixels and resize the document.
 * Called from the options bar "Apply" button.
 */
export function commitPerspectiveCrop(): void {
  const uiState = useUIStore.getState();
  const editorState = useEditorStore.getState();
  const quad = uiState.perspectiveCropQuad;
  if (!quad) return;

  const engine = getEngine();
  if (!engine) return;

  const doc = editorState.document;
  const { width: outWidth, height: outHeight } = inferOutputSize(quad);

  editorState.pushHistory('Perspective Crop');

  // Warp every raster layer
  const updatedLayers = doc.layers.map((layer) => {
    if (layer.type !== 'raster') {
      return layer;
    }

    // Read current layer pixels from GPU
    const srcImageData = readLayerAsImageData(layer.id);
    if (!srcImageData) return layer;

    // Build the warp matrix: maps [0,outW]×[0,outH] → quad corners in doc-space.
    // We need to account for the layer's offset (x, y) — translate the quad into
    // layer-local coordinates first.
    const layerQuad: Quad = {
      topLeft:     { x: quad.topLeft.x     - layer.x, y: quad.topLeft.y     - layer.y },
      topRight:    { x: quad.topRight.x    - layer.x, y: quad.topRight.y    - layer.y },
      bottomRight: { x: quad.bottomRight.x - layer.x, y: quad.bottomRight.y - layer.y },
      bottomLeft:  { x: quad.bottomLeft.x  - layer.x, y: quad.bottomLeft.y  - layer.y },
    };

    const matrix = computePerspectiveTransform(layerQuad, outWidth, outHeight);
    const warped = applyPerspectiveWarp(srcImageData, matrix, outWidth, outHeight);

    // Upload warped pixels back to GPU — output is always positioned at (0,0)
    uploadLayerPixels(engine, layer.id, new Uint8Array(warped.data.buffer), warped.width, warped.height, 0, 0);

    return { ...layer, x: 0, y: 0, width: outWidth, height: outHeight };
  });

  // Resize the document and update layers
  useEditorStore.setState((s) => ({
    document: {
      ...s.document,
      width: outWidth,
      height: outHeight,
      layers: updatedLayers,
    },
    renderVersion: s.renderVersion + 1,
  }));

  // Fit viewport to new size
  editorState.fitToView();

  // Clear the quad
  useUIStore.getState().setPerspectiveCropQuad(null);
  useUIStore.getState().setPerspectiveCropDragging(null);
}
