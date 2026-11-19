import { CommandError } from '../command';
import { defineCommand } from '../registry';
import { refusalError } from '../refusal';
import { requireDocument, requireEngine, resolveLayer } from '../context';
import { fillSelection } from '../../app/fill-selection';
import { useUIStore } from '../../app/ui-store';
import { pixelWriteRefusal } from '../../layers/paint-target';
import type { Layer } from '../../types';

export interface FillResult {
  layer: string;
  target: 'pixels' | 'mask';
}

function fillTarget(layer: Layer): FillResult['target'] {
  return useUIStore.getState().maskMode === 'layerMask' && layer.mask ? 'mask' : 'pixels';
}

export const paintFill = defineCommand({
  id: 'paint.fill',
  summary:
    'Fills the selection, or the whole active layer when nothing is selected, with the current foreground colour, as Edit > Fill does ("Fill"); in layer-mask edit mode it fills the active layer\'s mask instead ("Mask Fill"), with the foreground\'s grey value. Set the colour first with color.set. Refused on a locked layer, and on a text or group layer outside mask edit mode. Returns the layer id and whether its pixels or its mask were filled.',
  surface: 'document',
  params: {},
  run(): FillResult {
    requireDocument();
    const layer = resolveLayer();
    if (layer.locked) throw new CommandError('refused', `"${layer.name}" is locked: unlock it to fill it.`);
    requireEngine();
    const target = fillTarget(layer);
    if (target === 'pixels') {
      const refusal = pixelWriteRefusal(layer);
      if (refusal) throw refusalError(refusal);
    }
    fillSelection();
    return { layer: layer.id, target };
  },
});
