import { filterBrightnessContrast } from '../../../engine-wasm/wasm-bridge';
import type { FilterDefinition } from './types';

export const brightnessContrast: FilterDefinition = {
  id: 'brightness-contrast',
  title: 'Brightness/Contrast',
  params: [
    { key: 'brightness', label: 'Brightness', min: -100, max: 100, step: 1, defaultValue: 0 },
    { key: 'contrast', label: 'Contrast', min: -100, max: 100, step: 1, defaultValue: 0 },
  ],
  applyGpu: (engine, layerId, values) =>
    filterBrightnessContrast(engine, layerId, values['brightness'] ?? 0, values['contrast'] ?? 0),
};
