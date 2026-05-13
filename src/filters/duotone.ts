import { filterDuotone } from '../engine-wasm/wasm-bridge';
import type { FilterDefinition } from './filter-types';

export const duotone: FilterDefinition = {
  id: 'duotone',
  title: 'Duotone',
  params: [],
  applyGpu: (engine, layerId, values) =>
    filterDuotone(
      engine,
      layerId,
      values['shadowR'] ?? 0,
      values['shadowG'] ?? 20,
      values['shadowB'] ?? 80,
      values['highlightR'] ?? 255,
      values['highlightG'] ?? 200,
      values['highlightB'] ?? 50,
      values['contrast'] ?? 1.0,
    ),
};
