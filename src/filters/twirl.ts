import { filterTwirl } from '../engine-wasm/wasm-bridge';
import type { FilterDefinition } from './filter-types';

export const twirl: FilterDefinition = {
  id: 'twirl',
  title: 'Twirl',
  params: [
    { key: 'angle', label: 'Angle', min: -720, max: 720, step: 1, defaultValue: 180 },
    { key: 'radius', label: 'Radius', min: 1, max: 100, step: 1, defaultValue: 50 },
    { key: 'falloff', label: 'Falloff', min: 50, max: 400, step: 1, defaultValue: 200 },
  ],
  applyGpu: (engine, layerId, values) =>
    filterTwirl(
      engine,
      layerId,
      ((values['angle'] ?? 180) * Math.PI) / 180,
      (values['radius'] ?? 50) / 100,
      (values['falloff'] ?? 200) / 100,
    ),
};
