import type { Layer, DocumentColorMode } from '../../../types';
import type { SelectionData, ActionResult } from '../types';
import { createRasterLayer, createGroupLayer } from '../../../layers/layer-model';
import { createImageData } from '../../../engine/color-space';
import { createDefaultAdjustments } from '../../../filters/adjustment-node-utils';

export function computeCreateDocument(
  width: number,
  height: number,
  transparentBg: boolean,
  colorMode: DocumentColorMode = 'rgb',
): ActionResult {
  const bgLayer = createRasterLayer({ name: 'Background', width, height });
  const pixelData = new Map<string, ImageData>();
  const imgData = createImageData(width, height);
  if (!transparentBg) {
    for (let i = 0; i < imgData.data.length; i += 4) {
      imgData.data[i] = 255;
      imgData.data[i + 1] = 255;
      imgData.data[i + 2] = 255;
      imgData.data[i + 3] = 255;
    }
  }
  pixelData.set(bgLayer.id, imgData);

  const childIds = [bgLayer.id];
  const layers: Layer[] = [bgLayer];
  const layerOrder = [bgLayer.id];
  let activeLayerId = bgLayer.id;

  if (!transparentBg) {
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
      colorMode,
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
