import { useEditorStore } from '../editor-store';
import { PixelBuffer } from '../../engine/pixel-data';
import {
  invert,
  desaturate,
  posterize,
  threshold,
} from '../../filters/adjustments';
import { filterRunner } from '../../filters/filter-runner';
import type { FilterParam } from '../../components/FilterDialog/FilterDialog';

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

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const maskValue = (sel.mask[y * sel.maskWidth + x] ?? 0) / 255;
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

export function getFilterDialogConfig(id: FilterDialogId): { title: string; params: FilterParam[] } | null {
  switch (id) {
    case 'gaussian-blur':
      return {
        title: 'Gaussian Blur',
        params: [{ key: 'radius', label: 'Radius', min: 1, max: 100, step: 1, defaultValue: 5 }],
      };
    case 'box-blur':
      return {
        title: 'Box Blur',
        params: [{ key: 'radius', label: 'Radius', min: 1, max: 100, step: 1, defaultValue: 5 }],
      };
    case 'unsharp-mask':
      return {
        title: 'Unsharp Mask',
        params: [
          { key: 'radius', label: 'Radius', min: 1, max: 50, step: 1, defaultValue: 3 },
          { key: 'amount', label: 'Amount', min: 0.1, max: 5, step: 0.1, defaultValue: 1 },
          { key: 'threshold', label: 'Threshold', min: 0, max: 255, step: 1, defaultValue: 0 },
        ],
      };
    case 'brightness-contrast':
      return {
        title: 'Brightness/Contrast',
        params: [
          { key: 'brightness', label: 'Brightness', min: -100, max: 100, step: 1, defaultValue: 0 },
          { key: 'contrast', label: 'Contrast', min: -100, max: 100, step: 1, defaultValue: 0 },
        ],
      };
    case 'hue-saturation':
      return {
        title: 'Hue/Saturation',
        params: [
          { key: 'hue', label: 'Hue', min: -180, max: 180, step: 1, defaultValue: 0 },
          { key: 'saturation', label: 'Saturation', min: -100, max: 100, step: 1, defaultValue: 0 },
          { key: 'lightness', label: 'Lightness', min: -100, max: 100, step: 1, defaultValue: 0 },
        ],
      };
    case 'posterize':
      return {
        title: 'Posterize',
        params: [{ key: 'levels', label: 'Levels', min: 2, max: 32, step: 1, defaultValue: 4 }],
      };
    case 'threshold':
      return {
        title: 'Threshold',
        params: [{ key: 'level', label: 'Level', min: 0, max: 255, step: 1, defaultValue: 128 }],
      };
    default:
      return null;
  }
}

// Heavy filters use web worker via FilterRunner; lightweight ones run on main thread
export async function applyGenericFilter(id: FilterDialogId, values: Record<string, number>): Promise<void> {
  const layerData = getActiveLayerBuffer();
  if (!layerData) return;
  const { buf, activeId } = layerData;

  useEditorStore.getState().pushHistory();

  let result: PixelBuffer;
  switch (id) {
    case 'gaussian-blur':
      result = await filterRunner.blur(buf, values['radius'] ?? 5);
      break;
    case 'box-blur':
      result = await filterRunner.boxBlur(buf, values['radius'] ?? 5);
      break;
    case 'unsharp-mask':
      result = await filterRunner.unsharpMask(buf, values['radius'] ?? 3, values['amount'] ?? 1, values['threshold'] ?? 0);
      break;
    case 'brightness-contrast':
      result = await filterRunner.brightnessContrast(buf, values['brightness'] ?? 0, values['contrast'] ?? 0);
      break;
    case 'hue-saturation':
      result = await filterRunner.hueSaturation(buf, values['hue'] ?? 0, values['saturation'] ?? 0, values['lightness'] ?? 0);
      break;
    case 'posterize':
      result = posterize(buf, values['levels'] ?? 4);
      break;
    case 'threshold':
      result = threshold(buf, values['level'] ?? 128);
      break;
    default:
      return;
  }

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
