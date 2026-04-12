import { filterChromaticAberration } from '../../../engine-wasm/wasm-bridge';
import type { FilterDefinition } from './types';

export const chromaticAberration: FilterDefinition = {
  id: 'chromatic-aberration',
  title: 'Chromatic Aberration',
  params: [
    { key: 'offsetR', label: 'Red Offset', min: 0, max: 50, step: 0.5, defaultValue: 5 },
    { key: 'offsetB', label: 'Blue Offset', min: 0, max: 50, step: 0.5, defaultValue: 5 },
    { key: 'angle', label: 'Angle', min: 0, max: 360, step: 1, defaultValue: 0 },
  ],
  applyGpu: (engine, layerId, values) =>
    filterChromaticAberration(
      engine,
      layerId,
      values['offsetR'] ?? 5,
      values['offsetB'] ?? 5,
      values['angle'] ?? 0,
    ),
};
