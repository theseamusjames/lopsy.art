import { filterHueSaturation } from '../engine-wasm/wasm-bridge';
import type { FilterDefinition } from './filter-types';

export const hueSaturation: FilterDefinition = {
  id: 'hue-saturation',
  title: 'Hue/Saturation',
  params: [
    { key: 'hue', label: 'Hue', min: -180, max: 180, step: 1, defaultValue: 0 },
    { key: 'saturation', label: 'Saturation', min: -100, max: 100, step: 1, defaultValue: 0 },
    { key: 'lightness', label: 'Lightness', min: -100, max: 100, step: 1, defaultValue: 0 },
  ],
  applyGpu: (engine, layerId, values) =>
    filterHueSaturation(engine, layerId, values['hue'] ?? 0, values['saturation'] ?? 0, values['lightness'] ?? 0),
};
