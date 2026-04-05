import { filterFindEdges } from '../../../engine-wasm/wasm-bridge';
import type { FilterDefinition } from './types';

export const findEdges: FilterDefinition = {
  id: 'find-edges',
  title: 'Find Edges',
  params: [],
  applyGpu: (engine, layerId) => filterFindEdges(engine, layerId),
};
