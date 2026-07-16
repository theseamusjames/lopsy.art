import { filterAddNoise } from '../engine-wasm/wasm-bridge';
import type { FilterDefinition } from './filter-types';

export const addNoise: FilterDefinition = {
  id: 'add-noise',
  title: 'Add Noise',
  params: [
    { key: 'amount', label: 'Amount', min: 1, max: 100, step: 1, defaultValue: 25 },
    { key: 'monochromatic', label: 'Mode', min: 0, max: 1, defaultValue: 0, options: [{ value: 0, label: 'Color' }, { value: 1, label: 'Mono' }] },
    // #668 — Uniform is the previous behavior; Gaussian is film/sensor-like.
    { key: 'distribution', label: 'Distribution', min: 0, max: 1, defaultValue: 0, options: [{ value: 0, label: 'Uniform' }, { value: 1, label: 'Gaussian' }] },
  ],
  randomized: true,
  applyGpu: (engine, layerId, values) => {
    const seed = Math.random() * 1000;
    filterAddNoise(
      engine,
      layerId,
      values['amount'] ?? 25,
      (values['monochromatic'] ?? 0) === 1,
      (values['distribution'] ?? 0) === 1,
      seed,
    );
  },
};
