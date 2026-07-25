import type { Layer, DocumentColorMode } from '../../../types';
import type { SelectionData, ActionResult } from '../types';
import { createRasterLayer, createGroupLayer } from '../../../layers/layer-model';
import { createImageData } from '../../../engine/color-space';
import { createDefaultAdjustments } from '../../../filters/adjustment-node-utils';
import { convertColorToDocMode, encodeColorForEngine } from '../../../utils/color-mode';
import { getColorModeCapabilities, isAdjustmentAllowedInMode } from '../../../utils/color-mode-capabilities';

const WHITE = { r: 255, g: 255, b: 255, a: 1 } as const;
const TRANSPARENT = { r: 0, g: 0, b: 0, a: 0 } as const;

/**
 * The bytes a blank canvas needs in this mode's value space.
 *
 * A new document is created before the canvas mounts, so there is no engine to
 * bake through — the initial pixels have to be written already encoded. Left as
 * literal white, a CMYK document would read as full ink (solid black) and a Lab
 * one as maximum chroma.
 */
function initialFillBytes(
  colorMode: DocumentColorMode,
  transparentBg: boolean,
): [number, number, number, number] {
  // CMYK spends the alpha channel on black ink, so it has no transparency to
  // offer — an empty ink document is white paper. Encoding transparent black
  // here would instead read as 100% K, i.e. a solid black canvas.
  const wantsTransparent = transparentBg && colorMode !== 'cmyk';
  const base = wantsTransparent ? TRANSPARENT : WHITE;
  const encoded = encodeColorForEngine(convertColorToDocMode(base, colorMode), colorMode);
  return [encoded.r, encoded.g, encoded.b, Math.round(encoded.a * 255)];
}

export function computeCreateDocument(
  width: number,
  height: number,
  transparentBg: boolean,
  colorMode: DocumentColorMode = 'rgb',
): ActionResult {
  const bgLayer = createRasterLayer({ name: 'Background', width, height });
  const pixelData = new Map<string, ImageData>();
  const imgData = createImageData(width, height);

  const [fr, fg, fb, fa] = initialFillBytes(colorMode, transparentBg);
  // An all-zero buffer is already correct, so skip the fill when nothing differs.
  if (fr !== 0 || fg !== 0 || fb !== 0 || fa !== 0) {
    for (let i = 0; i < imgData.data.length; i += 4) {
      imgData.data[i] = fr;
      imgData.data[i + 1] = fg;
      imgData.data[i + 2] = fb;
      imgData.data[i + 3] = fa;
    }
  }
  pixelData.set(bgLayer.id, imgData);

  const childIds = [bgLayer.id];
  const layers: Layer[] = [bgLayer];
  const layerOrder = [bgLayer.id];
  let activeLayerId = bgLayer.id;

  // Flat modes (Indexed, CMYK) are a single surface — converting an existing
  // document flattens it, so creating one must not start with a second layer.
  if (!transparentBg && getColorModeCapabilities(colorMode).canAddLayers) {
    const drawLayer = createRasterLayer({ name: 'Layer 1', width, height });
    layers.push(drawLayer);
    layerOrder.push(drawLayer.id);
    childIds.push(drawLayer.id);
    activeLayerId = drawLayer.id;
  }

  // The default node set includes chroma adjustments, which a non-RGB document
  // must not ship with — they would reintroduce the color the mode excludes.
  const adjustments = createDefaultAdjustments().filter((n) =>
    isAdjustmentAllowedInMode(n.type, colorMode),
  );
  const rootGroup = createGroupLayer({ name: 'Project', children: childIds, adjustments });
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
