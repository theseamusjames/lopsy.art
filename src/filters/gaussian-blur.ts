import { filterGaussianBlur } from '../engine-wasm/wasm-bridge';
import type { FilterDefinition } from './filter-types';

export const gaussianBlur: FilterDefinition = {
  id: 'gaussian-blur',
  title: 'Gaussian Blur',
  params: [{ key: 'radius', label: 'Radius', min: 1, max: 100, step: 1, defaultValue: 5 }],
  applyGpu: (engine, layerId, values) => filterGaussianBlur(engine, layerId, values['radius'] ?? 5),
};
