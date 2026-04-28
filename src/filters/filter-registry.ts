import type { FilterDefinition } from './filter-types';
import { gaussianBlur } from './gaussian-blur';
import { boxBlur } from './box-blur';
import { unsharpMask } from './unsharp-mask';
import { brightnessContrast } from './brightness-contrast';
import { hueSaturation } from './hue-saturation';
import { posterize } from './posterize';
import { threshold } from './threshold';
import { motionBlur } from './motion-blur';
import { radialBlur } from './radial-blur';
import { findEdges } from './find-edges';
import { celShading } from './cel-shading';
import { clouds } from './clouds';
import { smoke } from './smoke';
import { pixelate } from './pixelate';
import { halftone } from './halftone';
import { solarize } from './solarize';
import { kaleidoscope } from './kaleidoscope';
import { oilPaint } from './oil-paint';
import { chromaticAberration } from './chromatic-aberration';
import { pixelStretch } from './pixel-stretch';
import { lensDistortion } from './lens-distortion';
import { tiltShiftBlur } from './tilt-shift-blur';

export type { FilterDefinition };

const allFilters: FilterDefinition[] = [
  gaussianBlur,
  boxBlur,
  unsharpMask,
  brightnessContrast,
  hueSaturation,
  posterize,
  threshold,
  motionBlur,
  radialBlur,
  findEdges,
  celShading,
  clouds,
  smoke,
  pixelate,
  halftone,
  solarize,
  kaleidoscope,
  oilPaint,
  chromaticAberration,
  pixelStretch,
  lensDistortion,
  tiltShiftBlur,
];

export const filterRegistry: Record<string, FilterDefinition> = Object.fromEntries(
  allFilters.map((f) => [f.id, f]),
);
