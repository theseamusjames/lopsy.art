import { filterFibers } from '../engine-wasm/wasm-bridge';
import type { FilterDefinition } from './filter-types';

export const fibers: FilterDefinition = {
  id: 'fibers',
  title: 'Fibers',
  params: [
    { key: 'variance', label: 'Variance', min: 1, max: 64, step: 1, defaultValue: 16 },
    { key: 'strength', label: 'Strength', min: 1, max: 64, step: 1, defaultValue: 16 },
  ],
  randomized: true,
  applyGpu: (engine, layerId, values) => {
    const seed = Math.random() * 1000;
    filterFibers(
      engine,
      layerId,
      values['variance'] ?? 16,
      values['strength'] ?? 16,
      seed,
    );
  },
};
