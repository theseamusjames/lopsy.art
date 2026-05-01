import { filterTileOffset } from '../engine-wasm/wasm-bridge';
import type { FilterDefinition } from './filter-types';

export const tileOffset: FilterDefinition = {
  id: 'tile-offset',
  title: 'Tile / Offset',
  params: [
    { key: 'offsetX', label: 'Offset X', min: -100, max: 100, step: 1, defaultValue: 50 },
    { key: 'offsetY', label: 'Offset Y', min: -100, max: 100, step: 1, defaultValue: 50 },
  ],
  applyGpu: (engine, layerId, values) =>
    filterTileOffset(
      engine,
      layerId,
      (values['offsetX'] ?? 50) / 100,
      (values['offsetY'] ?? 50) / 100,
    ),
};
