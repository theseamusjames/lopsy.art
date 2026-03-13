import { threshold as thresholdFilter } from '../../../filters/adjustments';
import type { FilterDefinition } from './types';

export const threshold: FilterDefinition = {
  id: 'threshold',
  title: 'Threshold',
  params: [{ key: 'level', label: 'Level', min: 0, max: 255, step: 1, defaultValue: 128 }],
  apply: (buf, values) => thresholdFilter(buf, values['level'] ?? 128),
};
