import { filterLensDistortion } from '../engine-wasm/wasm-bridge';
import type { FilterDefinition } from './filter-types';

export const lensDistortion: FilterDefinition = {
  id: 'lens-distortion',
  title: 'Lens Distortion',
  params: [
    { key: 'strength', label: 'Strength', min: -100, max: 100, step: 1, defaultValue: 50 },
    { key: 'zoom', label: 'Zoom', min: 50, max: 200, step: 1, defaultValue: 100 },
    { key: 'fringing', label: 'Chromatic Fringing', min: 0, max: 100, step: 1, defaultValue: 0 },
  ],
  applyGpu: (engine, layerId, values) =>
    filterLensDistortion(
      engine,
      layerId,
      (values['strength'] ?? 50) / 100,
      (values['zoom'] ?? 100) / 100,
      (values['fringing'] ?? 0) / 100,
    ),
};
