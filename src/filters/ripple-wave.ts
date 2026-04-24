import { filterRippleWave } from '../engine-wasm/wasm-bridge';
import type { FilterDefinition } from './filter-types';

export const rippleWave: FilterDefinition = {
  id: 'ripple-wave',
  title: 'Ripple / Wave',
  params: [
    { key: 'amplitude', label: 'Amplitude', min: 1, max: 200, step: 1, defaultValue: 20 },
    { key: 'wavelength', label: 'Wavelength', min: 5, max: 500, step: 1, defaultValue: 60 },
    { key: 'direction', label: 'Direction', min: 0, max: 360, step: 1, defaultValue: 0 },
    { key: 'phase', label: 'Phase', min: 0, max: 360, step: 1, defaultValue: 0 },
  ],
  applyGpu: (engine, layerId, values) =>
    filterRippleWave(
      engine,
      layerId,
      values['amplitude'] ?? 20,
      values['wavelength'] ?? 60,
      ((values['direction'] ?? 0) * Math.PI) / 180,
      ((values['phase'] ?? 0) * Math.PI) / 180,
    ),
};
