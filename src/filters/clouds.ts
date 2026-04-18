import { filterClouds } from '../engine-wasm/wasm-bridge';
import type { FilterDefinition } from './filter-types';

export const clouds: FilterDefinition = {
  id: 'clouds',
  title: 'Clouds',
  params: [
    { key: 'scale', label: 'Scale', min: 1, max: 20, step: 1, defaultValue: 5 },
  ],
  applyGpu: (engine, layerId, values) => {
    const seed = Math.random() * 1000;
    filterClouds(engine, layerId, values['scale'] ?? 5, seed);
  },
};
