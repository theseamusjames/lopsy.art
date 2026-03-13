import type { FilterDefinition } from './types';
import { gaussianBlur } from './gaussian-blur';
import { boxBlur } from './box-blur';
import { unsharpMask } from './unsharp-mask';
import { brightnessContrast } from './brightness-contrast';
import { hueSaturation } from './hue-saturation';
import { posterize } from './posterize';
import { threshold } from './threshold';

export type { FilterDefinition };

const allFilters: FilterDefinition[] = [
  gaussianBlur,
  boxBlur,
  unsharpMask,
  brightnessContrast,
  hueSaturation,
  posterize,
  threshold,
];

export const filterRegistry: Record<string, FilterDefinition> = Object.fromEntries(
  allFilters.map((f) => [f.id, f]),
);
