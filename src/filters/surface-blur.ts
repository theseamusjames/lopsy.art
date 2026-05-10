import { filterSurfaceBlur } from '../engine-wasm/wasm-bridge';
import type { FilterDefinition } from './filter-types';

export const surfaceBlur: FilterDefinition = {
  id: 'surface-blur',
  title: 'Surface Blur',
  params: [
    { key: 'radius', label: 'Radius', min: 1, max: 50, step: 1, defaultValue: 5, dynamicMax: 'doc' },
    { key: 'threshold', label: 'Threshold', min: 1, max: 255, step: 1, defaultValue: 15 },
  ],
  applyGpu: (engine, layerId, values) =>
    filterSurfaceBlur(engine, layerId, values['radius'] ?? 5, values['threshold'] ?? 15),
};
