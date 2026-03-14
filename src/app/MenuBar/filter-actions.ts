import { useEditorStore } from '../editor-store';
import { PixelBuffer } from '../../engine/pixel-data';
import { getSelectionMaskValue } from '../../selection/selection';
import { invert, desaturate } from '../../filters/adjustments';
import { filterRegistry } from './filters';
import type { FilterDefinition } from './filters';

export type FilterDialogId =
  | 'gaussian-blur'
  | 'box-blur'
  | 'unsharp-mask'
  | 'add-noise'
  | 'fill-noise'
  | 'brightness-contrast'
  | 'hue-saturation'
  | 'posterize'
  | 'threshold';

export function getActiveLayerBuffer(): { buf: PixelBuffer; activeId: string } | null {
  const state = useEditorStore.getState();
  const activeId = state.document.activeLayerId;
  if (!activeId) return null;
  const imageData = state.getOrCreateLayerPixelData(activeId);
  const buf = PixelBuffer.fromImageData(imageData);
  return { buf, activeId };
}

export function applyFilterResult(activeId: string, result: PixelBuffer): void {
  const state = useEditorStore.getState();
  const sel = state.selection;

  if (sel.active && sel.mask) {
    const imageData = state.getOrCreateLayerPixelData(activeId);
    const original = PixelBuffer.fromImageData(imageData);
    const blended = original.clone();
    const { width, height } = original;
    const layer = state.document.layers.find((l) => l.id === activeId);
    const ox = layer?.x ?? 0;
    const oy = layer?.y ?? 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const maskValue = getSelectionMaskValue(sel, x + ox, y + oy) / 255;
        if (maskValue <= 0) continue;

        const origPixel = original.getPixel(x, y);
        const filtPixel = result.getPixel(x, y);

        if (maskValue >= 1) {
          blended.setPixel(x, y, filtPixel);
        } else {
          blended.setPixel(x, y, {
            r: Math.round(origPixel.r + (filtPixel.r - origPixel.r) * maskValue),
            g: Math.round(origPixel.g + (filtPixel.g - origPixel.g) * maskValue),
            b: Math.round(origPixel.b + (filtPixel.b - origPixel.b) * maskValue),
            a: origPixel.a + (filtPixel.a - origPixel.a) * maskValue,
          });
        }
      }
    }

    state.updateLayerPixelData(activeId, blended.toImageData());
  } else {
    state.updateLayerPixelData(activeId, result.toImageData());
  }
}

export function getFilterDialogConfig(id: FilterDialogId): FilterDefinition | null {
  return filterRegistry[id] ?? null;
}

export async function applyGenericFilter(id: FilterDialogId, values: Record<string, number>): Promise<void> {
  const filter = filterRegistry[id];
  if (!filter) return;

  const layerData = getActiveLayerBuffer();
  if (!layerData) return;
  const { buf, activeId } = layerData;

  useEditorStore.getState().pushHistory();
  const result = await filter.apply(buf, values);
  applyFilterResult(activeId, result);
}

export function applyInvert(): void {
  const layerData = getActiveLayerBuffer();
  if (!layerData) return;
  const { buf, activeId } = layerData;
  useEditorStore.getState().pushHistory();
  const result = invert(buf);
  applyFilterResult(activeId, result);
}

export function applyDesaturate(): void {
  const layerData = getActiveLayerBuffer();
  if (!layerData) return;
  const { buf, activeId } = layerData;
  useEditorStore.getState().pushHistory();
  const result = desaturate(buf);
  applyFilterResult(activeId, result);
}
