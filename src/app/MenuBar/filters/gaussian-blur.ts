import { filterRunner } from '../../../filters/filter-runner';
import type { FilterDefinition } from './types';

export const gaussianBlur: FilterDefinition = {
  id: 'gaussian-blur',
  title: 'Gaussian Blur',
  params: [{ key: 'radius', label: 'Radius', min: 1, max: 100, step: 1, defaultValue: 5 }],
  apply: (buf, values) => filterRunner.blur(buf, values['radius'] ?? 5),
};
