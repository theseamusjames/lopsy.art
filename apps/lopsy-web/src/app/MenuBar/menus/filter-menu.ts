import type { FilterDialogId } from '../filter-actions';
import { commandItem } from './command-item';
import type { MenuDef, MenuItem } from './types';

function dialogItem(label: string, dialog: FilterDialogId): MenuItem {
  return commandItem(label, 'ui.dialog.filter', { dialog });
}

export function createFilterMenu(): MenuDef {
  return {
    label: 'Filter',
    items: [
      commandItem('Liquify...', 'ui.filter.liquify', undefined, '⌘⇧X'),
      { separator: true, label: '' },
      dialogItem('Gaussian Blur...', 'gaussian-blur'),
      dialogItem('Box Blur...', 'box-blur'),
      dialogItem('Surface Blur...', 'surface-blur'),
      dialogItem('Motion Blur...', 'motion-blur'),
      dialogItem('Radial Blur...', 'radial-blur'),
      commandItem('Tilt-Shift Blur...', 'ui.filter.tilt-shift'),
      dialogItem('Unsharp Mask...', 'unsharp-mask'),
      { separator: true, label: '' },
      commandItem('Find Edges', 'filter.find-edges'),
      dialogItem('Cel Shading...', 'cel-shading'),
      dialogItem('Pixelate...', 'pixelate'),
      dialogItem('Halftone...', 'halftone'),
      dialogItem('Kaleidoscope...', 'kaleidoscope'),
      dialogItem('Oil Paint...', 'oil-paint'),
      dialogItem('Chromatic Aberration...', 'chromatic-aberration'),
      dialogItem('Pixel Stretch...', 'pixel-stretch'),
      dialogItem('Lens Distortion...', 'lens-distortion'),
      { separator: true, label: '' },
      dialogItem('Bloom...', 'bloom'),
      dialogItem('Voronoi...', 'voronoi'),
      { separator: true, label: '' },
      dialogItem('Add Noise...', 'add-noise'),
      dialogItem('Texture...', 'texture'),
      { separator: true, label: '' },
      dialogItem('Clouds...', 'clouds'),
      dialogItem('Fibers...', 'fibers'),
      dialogItem('Smoke...', 'smoke'),
      dialogItem('Sunburst...', 'sunburst'),
      { separator: true, label: '' },
      dialogItem('Brightness/Contrast...', 'brightness-contrast'),
      dialogItem('Hue/Saturation...', 'hue-saturation'),
      dialogItem('Color LUT...', 'color-lut'),
      { separator: true, label: '' },
      commandItem('Invert', 'filter.invert'),
      commandItem('Desaturate', 'filter.desaturate'),
      dialogItem('Posterize...', 'posterize'),
      dialogItem('Threshold...', 'threshold'),
      dialogItem('Solarize...', 'solarize'),
      dialogItem('Emboss...', 'emboss'),
    ],
  };
}
