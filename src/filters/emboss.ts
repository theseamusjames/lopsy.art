import { filterEmboss } from '../engine-wasm/wasm-bridge';
import type { FilterDefinition } from './filter-types';

export const emboss: FilterDefinition = {
  id: 'emboss',
  title: 'Emboss',
  params: [
    { key: 'angle', label: 'Angle', min: 0, max: 360, step: 1, defaultValue: 45 },
    { key: 'amount', label: 'Amount', min: 1, max: 10, step: 1, defaultValue: 3 },
  ],
  applyGpu: (engine, layerId, values) =>
    filterEmboss(engine, layerId, values['angle'] ?? 45, values['amount'] ?? 3),
};
