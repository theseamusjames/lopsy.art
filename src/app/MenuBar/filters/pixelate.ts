import { filterPixelate } from '../../../engine-wasm/wasm-bridge';
import type { FilterDefinition } from './types';

export const pixelate: FilterDefinition = {
  id: 'pixelate',
  title: 'Pixelate',
  params: [{ key: 'blockSize', label: 'Block Size', min: 2, max: 64, step: 1, defaultValue: 8 }],
  applyGpu: (engine, layerId, values) => filterPixelate(engine, layerId, values['blockSize'] ?? 8),
};
