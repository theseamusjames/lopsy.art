import type { EditorState, SelectionData } from '../types';
import { createRasterLayer } from '../../../layers/layer-model';

export function computeCreateDocument(
  width: number,
  height: number,
  transparentBg: boolean,
): Partial<EditorState> {
  const bgLayer = createRasterLayer({ name: 'Background', width, height });
  const bgColor = transparentBg
    ? { r: 0, g: 0, b: 0, a: 0 }
    : { r: 255, g: 255, b: 255, a: 1 };
  const pixelData = new Map<string, ImageData>();
  const imgData = new ImageData(width, height);
  if (!transparentBg) {
    for (let i = 0; i < imgData.data.length; i += 4) {
      imgData.data[i] = 255;
      imgData.data[i + 1] = 255;
      imgData.data[i + 2] = 255;
      imgData.data[i + 3] = 255;
    }
  }
  pixelData.set(bgLayer.id, imgData);
  const selection: SelectionData = { active: false, bounds: null, mask: null, maskWidth: 0, maskHeight: 0 };
  return {
    document: {
      id: crypto.randomUUID(),
      name: 'Untitled',
      width,
      height,
      layers: [bgLayer],
      layerOrder: [bgLayer.id],
      activeLayerId: bgLayer.id,
      backgroundColor: bgColor,
    },
    layerPixelData: pixelData,
    undoStack: [],
    redoStack: [],
    renderVersion: 0,
    selection,
    documentReady: true,
    isDirty: false,
  };
}
