import { filterHalftone } from '../../../engine-wasm/wasm-bridge';
import type { FilterDefinition } from './types';

export const halftone: FilterDefinition = {
  id: 'halftone',
  title: 'Halftone',
  params: [
    { key: 'dotSize', label: 'Dot Size', min: 2, max: 32, step: 1, defaultValue: 8 },
    { key: 'angle', label: 'Angle', min: 0, max: 180, step: 1, defaultValue: 45 },
    { key: 'contrast', label: 'Softness', min: 0, max: 4, step: 0.1, defaultValue: 1.0 },
  ],
  applyGpu: (engine, layerId, values) =>
    filterHalftone(
      engine,
      layerId,
      values['dotSize'] ?? 8,
      values['angle'] ?? 45,
      values['contrast'] ?? 1.0,
    ),
};
