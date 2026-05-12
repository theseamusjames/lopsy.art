import { filterHighPass } from '../engine-wasm/wasm-bridge';
import type { FilterDefinition } from './filter-types';

export const highPass: FilterDefinition = {
  id: 'high-pass',
  title: 'High Pass',
  params: [
    { key: 'radius', label: 'Radius', min: 1, max: 100, step: 1, defaultValue: 10, dynamicMax: 'doc' },
    { key: 'strength', label: 'Strength', min: 0.1, max: 5, step: 0.1, defaultValue: 1 },
  ],
  applyGpu: (engine, layerId, values) =>
    filterHighPass(engine, layerId, values['radius'] ?? 10, values['strength'] ?? 1),
};
