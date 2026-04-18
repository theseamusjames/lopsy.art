import { filterKaleidoscope } from '../engine-wasm/wasm-bridge';
import type { FilterDefinition } from './filter-types';

export const kaleidoscope: FilterDefinition = {
  id: 'kaleidoscope',
  title: 'Kaleidoscope',
  params: [
    { key: 'segments', label: 'Segments', min: 2, max: 32, step: 1, defaultValue: 6 },
    { key: 'rotation', label: 'Rotation', min: 0, max: 360, step: 1, defaultValue: 0 },
  ],
  applyGpu: (engine, layerId, values) =>
    filterKaleidoscope(engine, layerId, values['segments'] ?? 6, values['rotation'] ?? 0),
};
