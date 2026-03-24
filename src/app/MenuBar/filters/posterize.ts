import { filterPosterize } from '../../../engine-wasm/wasm-bridge';
import type { FilterDefinition } from './types';

export const posterize: FilterDefinition = {
  id: 'posterize',
  title: 'Posterize',
  params: [{ key: 'levels', label: 'Levels', min: 2, max: 32, step: 1, defaultValue: 4 }],
  applyGpu: (engine, layerId, values) => filterPosterize(engine, layerId, values['levels'] ?? 4),
};
