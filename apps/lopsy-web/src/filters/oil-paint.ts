import { filterOilPaint } from '../engine-wasm/wasm-bridge';
import type { FilterDefinition } from './filter-types';

export const oilPaint: FilterDefinition = {
  id: 'oil-paint',
  title: 'Oil Paint',
  params: [
    { key: 'radius', label: 'Radius', min: 1, max: 10, step: 1, defaultValue: 4 },
    { key: 'sharpness', label: 'Sharpness', min: 0.1, max: 5, step: 0.1, defaultValue: 1.5 },
  ],
  applyGpu: (engine, layerId, values) =>
    filterOilPaint(
      engine,
      layerId,
      values['radius'] ?? 4,
      values['sharpness'] ?? 1.5,
    ),
};
