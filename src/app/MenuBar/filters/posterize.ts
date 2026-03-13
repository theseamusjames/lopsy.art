import { posterize as posterizeFilter } from '../../../filters/adjustments';
import type { FilterDefinition } from './types';

export const posterize: FilterDefinition = {
  id: 'posterize',
  title: 'Posterize',
  params: [{ key: 'levels', label: 'Levels', min: 2, max: 32, step: 1, defaultValue: 4 }],
  apply: (buf, values) => posterizeFilter(buf, values['levels'] ?? 4),
};
