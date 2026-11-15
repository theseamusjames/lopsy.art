import type { DocumentState, Layer, LayerMask } from '../../../types';
import type { ActionResult, SelectionData } from '../types';
import { getMaskDocOrigin, getNewMaskSize } from '../../../layers/mask-origin';

/**
 * Builds a new layer mask. With an active selection the mask reveals the
 * selection and hides everything else (Photoshop's Reveal Selection);
 * otherwise it reveals the whole layer.
 */
export function computeAddLayerMask(
  doc: DocumentState,
  renderVersion: number,
  id: string,
  selection?: SelectionData,
): ActionResult | undefined {
  const layer = doc.layers.find((l) => l.id === id);
  if (!layer) return undefined;

  const { width, height } = getNewMaskSize(layer, doc.width, doc.height);
  const maskData = new Uint8ClampedArray(width * height);
  if (selection?.active && selection.mask) {
    fillFromSelection(maskData, width, height, getMaskDocOrigin(layer), selection);
  } else {
    maskData.fill(255);
  }
  const layerMask: LayerMask = {
    id: crypto.randomUUID(),
    enabled: true,
    data: maskData,
    width,
    height,
  };

  return {
    document: {
      ...doc,
      layers: doc.layers.map((l) =>
        l.id === id ? ({ ...l, mask: layerMask } as Layer) : l,
      ),
    },
    renderVersion: renderVersion + 1,
  };
}

function fillFromSelection(
  out: Uint8ClampedArray,
  width: number,
  height: number,
  origin: { x: number; y: number },
  selection: Extract<SelectionData, { active: true }>,
): void {
  const { mask, maskWidth, maskHeight } = selection;
  for (let my = 0; my < height; my++) {
    const sy = my + origin.y;
    if (sy < 0 || sy >= maskHeight) continue;
    const outRow = my * width;
    const selRow = sy * maskWidth;
    for (let mx = 0; mx < width; mx++) {
      const sx = mx + origin.x;
      if (sx < 0 || sx >= maskWidth) continue;
      out[outRow + mx] = mask[selRow + sx] ?? 0;
    }
  }
}
