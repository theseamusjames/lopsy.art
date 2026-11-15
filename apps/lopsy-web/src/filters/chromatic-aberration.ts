import { filterChromaticAberration } from '../engine-wasm/wasm-bridge';
import type { FilterDefinition } from './filter-types';

export const chromaticAberration: FilterDefinition = {
  id: 'chromatic-aberration',
  title: 'Chromatic Aberration',
  params: [
    { key: 'amount', label: 'Amount', min: 1, max: 50, step: 1, defaultValue: 8 },
    { key: 'angle', label: 'Direction', min: 0, max: 360, step: 1, defaultValue: 0 },
  ],
  applyGpu: (engine, layerId, values) =>
    filterChromaticAberration(
      engine,
      layerId,
      values['amount'] ?? 8,
      values['angle'] ?? 0,
    ),
};
