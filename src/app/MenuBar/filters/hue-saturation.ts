import { filterRunner } from '../../../filters/filter-runner';
import type { FilterDefinition } from './types';

export const hueSaturation: FilterDefinition = {
  id: 'hue-saturation',
  title: 'Hue/Saturation',
  params: [
    { key: 'hue', label: 'Hue', min: -180, max: 180, step: 1, defaultValue: 0 },
    { key: 'saturation', label: 'Saturation', min: -100, max: 100, step: 1, defaultValue: 0 },
    { key: 'lightness', label: 'Lightness', min: -100, max: 100, step: 1, defaultValue: 0 },
  ],
  apply: (buf, values) =>
    filterRunner.hueSaturation(buf, values['hue'] ?? 0, values['saturation'] ?? 0, values['lightness'] ?? 0),
};
