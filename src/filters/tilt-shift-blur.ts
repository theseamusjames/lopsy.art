import { filterTiltShiftBlur } from '../engine-wasm/wasm-bridge';
import type { FilterDefinition } from './filter-types';

export const tiltShiftBlur: FilterDefinition = {
  id: 'tilt-shift-blur',
  title: 'Tilt-Shift Blur',
  params: [
    { key: 'focusPosition', label: 'Focus Position', min: 0, max: 100, step: 1, defaultValue: 50 },
    { key: 'focusWidth', label: 'Focus Width', min: 0, max: 100, step: 1, defaultValue: 20 },
    { key: 'blurRadius', label: 'Blur Radius', min: 1, max: 32, step: 1, defaultValue: 12 },
    { key: 'angle', label: 'Angle', min: 0, max: 360, step: 1, defaultValue: 0 },
  ],
  applyGpu: (engine, layerId, values) => {
    const focusPosition = (values['focusPosition'] ?? 50) / 100;
    const focusWidth = (values['focusWidth'] ?? 20) / 100;
    const blurRadius = values['blurRadius'] ?? 12;
    const angleRad = ((values['angle'] ?? 0) * Math.PI) / 180;
    filterTiltShiftBlur(engine, layerId, focusPosition, focusWidth, blurRadius, angleRad);
  },
};
