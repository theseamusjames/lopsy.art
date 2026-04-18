import { filterSolarize } from '../engine-wasm/wasm-bridge';
import type { FilterDefinition } from './filter-types';

export const solarize: FilterDefinition = {
  id: 'solarize',
  title: 'Solarize',
  params: [{ key: 'threshold', label: 'Threshold', min: 0, max: 255, step: 1, defaultValue: 128 }],
  applyGpu: (engine, layerId, values) => filterSolarize(engine, layerId, values['threshold'] ?? 128),
};
