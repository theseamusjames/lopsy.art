import { filterSmoke } from '../engine-wasm/wasm-bridge';
import type { FilterDefinition } from './filter-types';

export const smoke: FilterDefinition = {
  id: 'smoke',
  title: 'Smoke',
  params: [
    { key: 'scale', label: 'Scale', min: 1, max: 20, step: 1, defaultValue: 4 },
    { key: 'turbulence', label: 'Turbulence', min: 0, max: 100, step: 1, defaultValue: 50 },
  ],
  applyGpu: (engine, layerId, values) => {
    const seed = Math.random() * 1000;
    filterSmoke(
      engine,
      layerId,
      values['scale'] ?? 4,
      seed,
      (values['turbulence'] ?? 50) / 100,
    );
  },
};
