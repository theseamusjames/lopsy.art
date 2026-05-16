import { filterFilmGrain } from '../engine-wasm/wasm-bridge';
import type { FilterDefinition } from './filter-types';

export const filmGrain: FilterDefinition = {
  id: 'film-grain',
  title: 'Film Grain',
  params: [
    { key: 'amount', label: 'Amount', min: 1, max: 100, step: 1, defaultValue: 25 },
    { key: 'size', label: 'Grain Size', min: 1, max: 5, step: 0.1, defaultValue: 1.5 },
    { key: 'roughness', label: 'Roughness', min: 0, max: 100, step: 1, defaultValue: 50 },
  ],
  randomized: true,
  applyGpu: (engine, layerId, values) => {
    const seed = Math.random() * 1000;
    filterFilmGrain(
      engine,
      layerId,
      (values['amount'] ?? 25) / 100,
      values['size'] ?? 1.5,
      (values['roughness'] ?? 50) / 100,
      false,
      seed,
    );
  },
};

export const filmGrainMono: FilterDefinition = {
  id: 'film-grain-mono',
  title: 'Film Grain (Mono)',
  params: [
    { key: 'amount', label: 'Amount', min: 1, max: 100, step: 1, defaultValue: 25 },
    { key: 'size', label: 'Grain Size', min: 1, max: 5, step: 0.1, defaultValue: 1.5 },
    { key: 'roughness', label: 'Roughness', min: 0, max: 100, step: 1, defaultValue: 50 },
  ],
  randomized: true,
  applyGpu: (engine, layerId, values) => {
    const seed = Math.random() * 1000;
    filterFilmGrain(
      engine,
      layerId,
      (values['amount'] ?? 25) / 100,
      values['size'] ?? 1.5,
      (values['roughness'] ?? 50) / 100,
      true,
      seed,
    );
  },
};
