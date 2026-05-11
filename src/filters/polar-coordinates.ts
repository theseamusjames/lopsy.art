import { filterPolarCoordinates } from '../engine-wasm/wasm-bridge';
import type { FilterDefinition } from './filter-types';

export const polarCoordinates: FilterDefinition = {
  id: 'polar-coordinates',
  title: 'Polar Coordinates',
  params: [
    { key: 'mode', label: 'Mode (0=Rect→Polar, 1=Polar→Rect)', min: 0, max: 1, step: 1, defaultValue: 0 },
  ],
  applyGpu: (engine, layerId, values) =>
    filterPolarCoordinates(
      engine,
      layerId,
      values['mode'] ?? 0,
    ),
};
