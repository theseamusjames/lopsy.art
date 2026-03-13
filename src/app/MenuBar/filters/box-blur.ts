import { filterRunner } from '../../../filters/filter-runner';
import type { FilterDefinition } from './types';

export const boxBlur: FilterDefinition = {
  id: 'box-blur',
  title: 'Box Blur',
  params: [{ key: 'radius', label: 'Radius', min: 1, max: 100, step: 1, defaultValue: 5 }],
  apply: (buf, values) => filterRunner.boxBlur(buf, values['radius'] ?? 5),
};
