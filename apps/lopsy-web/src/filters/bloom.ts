import { filterBloom } from '../engine-wasm/wasm-bridge';
import type { FilterDefinition } from './filter-types';

export const bloom: FilterDefinition = {
  id: 'bloom',
  title: 'Bloom',
  params: [
    { key: 'threshold', label: 'Threshold', min: 0, max: 100, step: 1, defaultValue: 50 },
    { key: 'softKnee', label: 'Soft Knee', min: 0, max: 100, step: 1, defaultValue: 50 },
    { key: 'radius', label: 'Radius', min: 1, max: 64, step: 1, defaultValue: 15 },
    { key: 'intensity', label: 'Intensity', min: 0, max: 200, step: 1, defaultValue: 100 },
  ],
  applyGpu: (engine, layerId, values) =>
    filterBloom(
      engine,
      layerId,
      (values['threshold'] ?? 50) / 100,
      (values['softKnee'] ?? 50) / 100,
      values['radius'] ?? 15,
      (values['intensity'] ?? 100) / 100,
    ),
};
