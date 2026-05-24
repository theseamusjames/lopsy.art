import { filterEmboss } from '../engine-wasm/wasm-bridge';
import type { FilterDefinition } from './filter-types';

export const emboss: FilterDefinition = {
  id: 'emboss',
  title: 'Emboss',
  params: [
    { key: 'angle', label: 'Angle', min: 0, max: 360, step: 1, defaultValue: 135 },
    { key: 'strength', label: 'Strength', min: 1, max: 100, step: 1, defaultValue: 50 },
    { key: 'type', label: 'Type', min: 0, max: 1, step: 1, defaultValue: 0, options: [{ value: 0, label: 'Emboss' }, { value: 1, label: 'Pillow Emboss' }] },
  ],
  applyGpu: (engine, layerId, values) =>
    filterEmboss(
      engine,
      layerId,
      values['angle'] ?? 135,
      (values['strength'] ?? 50) / 100,
      values['type'] ?? 0,
    ),
};
