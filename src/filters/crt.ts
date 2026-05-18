import { filterCrt } from '../engine-wasm/wasm-bridge';
import type { FilterDefinition } from './filter-types';

export const crt: FilterDefinition = {
  id: 'crt',
  title: 'CRT / Scanline',
  params: [
    { key: 'scanlineIntensity', label: 'Scanline Intensity', min: 0, max: 100, step: 1, defaultValue: 50 },
    { key: 'scanlineSpacing', label: 'Scanline Spacing', min: 1, max: 8, step: 0.5, defaultValue: 3 },
    { key: 'curvature', label: 'Curvature', min: 0, max: 100, step: 1, defaultValue: 20 },
    { key: 'phosphor', label: 'Phosphor Glow', min: 0, max: 100, step: 1, defaultValue: 30 },
    { key: 'vignette', label: 'Vignette', min: 0, max: 100, step: 1, defaultValue: 40 },
  ],
  applyGpu: (engine, layerId, values) =>
    filterCrt(
      engine,
      layerId,
      (values['scanlineIntensity'] ?? 50) / 100,
      values['scanlineSpacing'] ?? 3,
      (values['curvature'] ?? 20) / 100,
      (values['phosphor'] ?? 30) / 100,
      (values['vignette'] ?? 40) / 100,
    ),
};
