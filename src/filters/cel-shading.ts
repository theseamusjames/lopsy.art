import { filterCelShading } from '../engine-wasm/wasm-bridge';
import type { FilterDefinition } from './filter-types';

export const celShading: FilterDefinition = {
  id: 'cel-shading',
  title: 'Cel Shading',
  params: [
    { key: 'levels', label: 'Color Levels', min: 2, max: 10, step: 1, defaultValue: 5 },
    { key: 'edgeStrength', label: 'Edge Strength', min: 0, max: 100, step: 1, defaultValue: 80 },
  ],
  applyGpu: (engine, layerId, values) => {
    filterCelShading(
      engine,
      layerId,
      values['levels'] ?? 5,
      (values['edgeStrength'] ?? 80) / 100,
    );
  },
};
