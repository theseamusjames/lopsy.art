import type { Engine } from '../engine-wasm/wasm-bridge';
import type { FilterParam } from '../components/FilterDialog/FilterDialog';

export interface FilterDefinition {
  id: string;
  title: string;
  params: FilterParam[];
  applyGpu: (engine: Engine, layerId: string, values: Record<string, number>) => void;
}
