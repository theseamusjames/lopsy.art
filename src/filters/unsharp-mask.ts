import { filterUnsharpMask } from '../engine-wasm/wasm-bridge';
import type { FilterDefinition } from './filter-types';

export const unsharpMask: FilterDefinition = {
  id: 'unsharp-mask',
  title: 'Unsharp Mask',
  params: [
    { key: 'radius', label: 'Radius', min: 1, max: 50, step: 1, defaultValue: 3 },
    { key: 'amount', label: 'Amount', min: 0.1, max: 5, step: 0.1, defaultValue: 1 },
    { key: 'threshold', label: 'Threshold', min: 0, max: 255, step: 1, defaultValue: 0 },
  ],
  applyGpu: (engine, layerId, values) =>
    filterUnsharpMask(engine, layerId, values['radius'] ?? 3, values['amount'] ?? 1, values['threshold'] ?? 0),
};
