import { filterPixelStretch } from '../engine-wasm/wasm-bridge';
import type { FilterDefinition } from './filter-types';

export const pixelStretch: FilterDefinition = {
  id: 'pixel-stretch',
  title: 'Pixel Stretch',
  params: [
    { key: 'amount', label: 'Amount', min: 1, max: 200, step: 1, defaultValue: 40 },
    { key: 'bands', label: 'Bands', min: 2, max: 50, step: 1, defaultValue: 12 },
    { key: 'seed', label: 'Seed', min: 0, max: 999, step: 1, defaultValue: 0 },
    { key: 'rgbSplit', label: 'RGB Split', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
  ],
  applyGpu: (engine, layerId, values) =>
    filterPixelStretch(
      engine,
      layerId,
      values['amount'] ?? 40,
      values['bands'] ?? 12,
      values['seed'] ?? 0,
      values['rgbSplit'] ?? 0.5,
    ),
};
