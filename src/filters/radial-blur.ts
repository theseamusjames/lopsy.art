import { filterRadialBlur } from '../engine-wasm/wasm-bridge';
import type { FilterDefinition } from './filter-types';

export const radialBlur: FilterDefinition = {
  id: 'radial-blur',
  title: 'Radial Blur',
  params: [
    { key: 'amount', label: 'Amount', min: 1, max: 100, step: 1, defaultValue: 20 },
  ],
  applyGpu: (engine, layerId, values) => filterRadialBlur(engine, layerId, values['amount'] ?? 20),
};
