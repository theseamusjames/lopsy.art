import { filterVoronoi } from '../engine-wasm/wasm-bridge';
import type { FilterDefinition } from './filter-types';

export const voronoiFilter: FilterDefinition = {
  id: 'voronoi',
  title: 'Voronoi',
  params: [
    { key: 'cellCount', label: 'Cells', min: 2, max: 200, step: 1, defaultValue: 20 },
    { key: 'edgeWidth', label: 'Edge Width', min: 0, max: 20, step: 0.5, defaultValue: 3 },
    { key: 'seed', label: 'Seed', min: 0, max: 999, step: 1, defaultValue: 0 },
  ],
  applyGpu: (engine, layerId, values) =>
    filterVoronoi(
      engine,
      layerId,
      values['cellCount'] ?? 20,
      values['edgeWidth'] ?? 3,
      0, 0, 0,
      values['seed'] ?? 0,
    ),
};
