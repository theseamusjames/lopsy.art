import { filterMotionBlur } from '../../../engine-wasm/wasm-bridge';
import type { FilterDefinition } from './types';

export const motionBlur: FilterDefinition = {
  id: 'motion-blur',
  title: 'Motion Blur',
  params: [
    { key: 'angle', label: 'Angle', min: 0, max: 360, step: 1, defaultValue: 0 },
    { key: 'distance', label: 'Distance', min: 1, max: 100, step: 1, defaultValue: 10 },
  ],
  applyGpu: (engine, layerId, values) => {
    const angleRad = ((values['angle'] ?? 0) * Math.PI) / 180;
    filterMotionBlur(engine, layerId, angleRad, values['distance'] ?? 10);
  },
};
