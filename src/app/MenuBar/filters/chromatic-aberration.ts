import { filterChromaticAberration } from '../../../engine-wasm/wasm-bridge';
import type { FilterDefinition } from './types';

export const chromaticAberration: FilterDefinition = {
  id: 'chromatic-aberration',
  title: 'Chromatic Aberration',
  params: [
    { key: 'amount', label: 'Amount', min: 0.5, max: 50, step: 0.5, defaultValue: 5 },
    { key: 'angle', label: 'Angle', min: 0, max: 360, step: 1, defaultValue: 0 },
  ],
  applyGpu: (engine, layerId, values) => {
    const angleRad = ((values['angle'] ?? 0) * Math.PI) / 180;
    filterChromaticAberration(engine, layerId, values['amount'] ?? 5, angleRad);
  },
};
