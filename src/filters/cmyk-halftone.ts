import { filterCmykHalftone } from '../engine-wasm/wasm-bridge';
import type { FilterDefinition } from './filter-types';

export const cmykHalftone: FilterDefinition = {
  id: 'cmyk-halftone',
  title: 'CMYK Color Halftone',
  params: [
    { key: 'dotSize', label: 'Dot Size', min: 2, max: 32, step: 1, defaultValue: 8 },
    { key: 'cyanAngle', label: 'Cyan Angle', min: 0, max: 180, step: 1, defaultValue: 15 },
    { key: 'magentaAngle', label: 'Magenta Angle', min: 0, max: 180, step: 1, defaultValue: 75 },
    { key: 'yellowAngle', label: 'Yellow Angle', min: 0, max: 180, step: 1, defaultValue: 0 },
    { key: 'blackAngle', label: 'Black Angle', min: 0, max: 180, step: 1, defaultValue: 45 },
    { key: 'softness', label: 'Softness', min: 0, max: 4, step: 0.1, defaultValue: 1.0 },
  ],
  applyGpu: (engine, layerId, values) =>
    filterCmykHalftone(
      engine,
      layerId,
      values['dotSize'] ?? 8,
      values['cyanAngle'] ?? 15,
      values['magentaAngle'] ?? 75,
      values['yellowAngle'] ?? 0,
      values['blackAngle'] ?? 45,
      values['softness'] ?? 1.0,
    ),
};
