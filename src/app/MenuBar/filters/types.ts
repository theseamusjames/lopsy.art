import type { PixelBuffer } from '../../../engine/pixel-data';
import type { FilterParam } from '../../../components/FilterDialog/FilterDialog';

export interface FilterDefinition {
  id: string;
  title: string;
  params: FilterParam[];
  apply: (buf: PixelBuffer, values: Record<string, number>) => PixelBuffer | Promise<PixelBuffer>;
}
