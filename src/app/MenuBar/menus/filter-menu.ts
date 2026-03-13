import { applyInvert, applyDesaturate } from '../filter-actions';
import type { FilterDialogId } from '../filter-actions';
import type { MenuDef } from './types';

export function createFilterMenu(showFilterDialog: (id: FilterDialogId) => void): MenuDef {
  return {
    label: 'Filter',
    items: [
      { label: 'Gaussian Blur...', action: () => showFilterDialog('gaussian-blur') },
      { label: 'Box Blur...', action: () => showFilterDialog('box-blur') },
      { label: 'Unsharp Mask...', action: () => showFilterDialog('unsharp-mask') },
      { separator: true, label: '' },
      { label: 'Add Noise...', action: () => showFilterDialog('add-noise') },
      { label: 'Fill with Noise...', action: () => showFilterDialog('fill-noise') },
      { separator: true, label: '' },
      { label: 'Brightness/Contrast...', action: () => showFilterDialog('brightness-contrast') },
      { label: 'Hue/Saturation...', action: () => showFilterDialog('hue-saturation') },
      { separator: true, label: '' },
      { label: 'Invert', action: () => applyInvert() },
      { label: 'Desaturate', action: () => applyDesaturate() },
      { label: 'Posterize...', action: () => showFilterDialog('posterize') },
      { label: 'Threshold...', action: () => showFilterDialog('threshold') },
    ],
  };
}
