import { applyInvert, applyDesaturate, applyFindEdges } from '../filter-actions';
import type { FilterDialogId } from '../filter-actions';
import type { MenuDef } from './types';

export function createFilterMenu(showFilterDialog: (id: FilterDialogId) => void): MenuDef {
  return {
    label: 'Filter',
    items: [
      { label: 'Gaussian Blur...', action: () => showFilterDialog('gaussian-blur') },
      { label: 'Box Blur...', action: () => showFilterDialog('box-blur') },
      { label: 'Motion Blur...', action: () => showFilterDialog('motion-blur') },
      { label: 'Radial Blur...', action: () => showFilterDialog('radial-blur') },
      { label: 'Unsharp Mask...', action: () => showFilterDialog('unsharp-mask') },
      { separator: true, label: '' },
      { label: 'Find Edges', action: () => applyFindEdges() },
      { label: 'Cel Shading...', action: () => showFilterDialog('cel-shading') },
      { label: 'Pixelate...', action: () => showFilterDialog('pixelate') },
      { label: 'Halftone...', action: () => showFilterDialog('halftone') },
      { label: 'Kaleidoscope...', action: () => showFilterDialog('kaleidoscope') },
      { label: 'Oil Paint...', action: () => showFilterDialog('oil-paint') },
      { label: 'Chromatic Aberration...', action: () => showFilterDialog('chromatic-aberration') },
      { label: 'Pixel Stretch...', action: () => showFilterDialog('pixel-stretch') },
      { label: 'Lens Distortion...', action: () => showFilterDialog('lens-distortion') },
      { separator: true, label: '' },
      { label: 'Add Noise...', action: () => showFilterDialog('add-noise') },
      { label: 'Fill with Noise...', action: () => showFilterDialog('fill-noise') },
      { separator: true, label: '' },
      { label: 'Clouds...', action: () => showFilterDialog('clouds') },
      { label: 'Smoke...', action: () => showFilterDialog('smoke') },
      { label: 'Pattern Fill...', action: () => showFilterDialog('pattern-fill') },
      { separator: true, label: '' },
      { label: 'Brightness/Contrast...', action: () => showFilterDialog('brightness-contrast') },
      { label: 'Hue/Saturation...', action: () => showFilterDialog('hue-saturation') },
      { separator: true, label: '' },
      { label: 'Invert', action: () => applyInvert() },
      { label: 'Desaturate', action: () => applyDesaturate() },
      { label: 'Posterize...', action: () => showFilterDialog('posterize') },
      { label: 'Threshold...', action: () => showFilterDialog('threshold') },
      { label: 'Solarize...', action: () => showFilterDialog('solarize') },
    ],
  };
}
