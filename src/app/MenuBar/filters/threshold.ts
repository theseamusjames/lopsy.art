import { filterThreshold } from '../../../engine-wasm/wasm-bridge';
import type { FilterDefinition } from './types';

export const threshold: FilterDefinition = {
  id: 'threshold',
  title: 'Threshold',
  params: [{ key: 'level', label: 'Level', min: 0, max: 255, step: 1, defaultValue: 128 }],
  applyGpu: (engine, layerId, values) => filterThreshold(engine, layerId, values['level'] ?? 128),
};
