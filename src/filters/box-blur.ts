import { filterBoxBlur } from '../engine-wasm/wasm-bridge';
import type { FilterDefinition } from './filter-types';

export const boxBlur: FilterDefinition = {
  id: 'box-blur',
  title: 'Box Blur',
  params: [{ key: 'radius', label: 'Radius', min: 1, max: 100, step: 1, defaultValue: 5 }],
  applyGpu: (engine, layerId, values) => filterBoxBlur(engine, layerId, values['radius'] ?? 5),
};
