import type { Layer } from '../../../types';
import type { SelectionData, ActionResult } from '../types';
import { createRasterLayer, createGroupLayer } from '../../../layers/layer-model';
import { createImageData } from '../../../engine/color-space';
import { createDefaultAdjustments } from '../../../filters/adjustment-node-utils';

export function computeCreateDocument(
  width: number,
  height: number,
  transparentBg: boolean,
): ActionResult {
  const bgLayer = createRasterLayer({ name: 'Background', width, height });
  const pixelData = new Map<string, ImageData>();
  // #667 — Only allocate + upload pixel data when it's actually non-zero.
  // A fresh transparent Background layer used to be handed an 80MB all-
  // zero ImageData that got pushed straight to the GPU, promoting the
  // layer's texture from lazy 1x1 to doc-sized and forcing the paint-
  // bucket's slow path (readback → CPU flood → upload) on the very
  // first fill. Leaving it lazy keeps the fast path viable.
  if (!transparentBg) {
    const imgData = createImageData(width, height);
    for (let i = 0; i < imgData.data.length; i += 4) {
      imgData.data[i] = 255;
      imgData.data[i + 1] = 255;
      imgData.data[i + 2] = 255;
      imgData.data[i + 3] = 255;
    }
    pixelData.set(bgLayer.id, imgData);
  }

  const childIds = [bgLayer.id];
  const layers: Layer[] = [bgLayer];
  const layerOrder = [bgLayer.id];
  let activeLayerId = bgLayer.id;

  if (!transparentBg) {
    // Layer 1 is empty (transparent) — don't allocate zero-filled pixel
    // data for it. See the note above on the Background layer.
    const drawLayer = createRasterLayer({ name: 'Layer 1', width, height });
    layers.push(drawLayer);
    layerOrder.push(drawLayer.id);
    childIds.push(drawLayer.id);
    activeLayerId = drawLayer.id;
  }

  const rootGroup = createGroupLayer({ name: 'Project', children: childIds, adjustments: createDefaultAdjustments() });
  layers.push(rootGroup);
  layerOrder.push(rootGroup.id);

  const selection: SelectionData = { active: false, bounds: null, mask: null, maskWidth: 0, maskHeight: 0 };
  return {
    document: {
      id: crypto.randomUUID(),
      name: 'lopsy',
      width,
      height,
      layers,
      layerOrder,
      activeLayerId,
      selectedLayerIds: [activeLayerId],
      backgroundColor: { r: 0, g: 0, b: 0, a: 0 },
      rootGroupId: rootGroup.id,
    },
    layerPixelData: pixelData,
    sparseLayerData: new Map(),
    undoStack: [],
    redoStack: [],
    renderVersion: 0,
    selection,
    documentReady: true,
    isDirty: false,
  };
}
