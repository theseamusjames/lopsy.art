import { filterSunburst } from '../engine-wasm/wasm-bridge';
import { useToolSettingsStore } from '../app/tool-settings-store';
import type { Color } from '../types/color';
import type { FilterDefinition } from './filter-types';

export interface SunburstArgs {
  rays: number;
  centerX: number;
  centerY: number;
  rotationDegrees: number;
  length: number;
  width: number;
  taper: number;
  fade: number;
  softness: number;
  jitter: number;
  seed: number;
  rayColor: readonly [number, number, number, number];
  shouldFillGaps: boolean;
  gapColor: readonly [number, number, number];
}

const percent = (value: number | undefined, fallback: number): number => (value ?? fallback) / 100;

export function sunburstArgs(
  values: Record<string, number>,
  rayColor: Color,
  gapColor: Color,
): SunburstArgs {
  return {
    rays: Math.max(3, Math.round(values['rays'] ?? 24)),
    centerX: percent(values['centerX'], 50),
    centerY: percent(values['centerY'], 50),
    rotationDegrees: values['rotation'] ?? 0,
    length: percent(values['length'], 100),
    width: percent(values['width'], 50),
    taper: percent(values['taper'], 0),
    fade: percent(values['fade'], 0),
    softness: percent(values['softness'], 0),
    jitter: percent(values['jitter'], 0),
    seed: values['seed'] ?? 0,
    rayColor: [
      rayColor.r / 255,
      rayColor.g / 255,
      rayColor.b / 255,
      rayColor.a * percent(values['opacity'], 100),
    ],
    shouldFillGaps: (values['gaps'] ?? 0) === 1,
    gapColor: [gapColor.r / 255, gapColor.g / 255, gapColor.b / 255],
  };
}

export const sunburst: FilterDefinition = {
  id: 'sunburst',
  title: 'Sunburst',
  params: [
    { key: 'rays', label: 'Rays', min: 3, max: 120, step: 1, defaultValue: 24 },
    { key: 'length', label: 'Length', min: 5, max: 150, step: 1, defaultValue: 100 },
    { key: 'width', label: 'Width', min: 5, max: 100, step: 1, defaultValue: 50 },
    { key: 'taper', label: 'Taper', min: 0, max: 100, step: 1, defaultValue: 0 },
    { key: 'fade', label: 'Fade', min: 0, max: 100, step: 1, defaultValue: 0 },
    { key: 'softness', label: 'Softness', min: 0, max: 100, step: 1, defaultValue: 0 },
    { key: 'rotation', label: 'Rotation', min: 0, max: 360, step: 1, defaultValue: 0 },
    { key: 'centerX', label: 'Center X', min: 0, max: 100, step: 1, defaultValue: 50 },
    { key: 'centerY', label: 'Center Y', min: 0, max: 100, step: 1, defaultValue: 50 },
    { key: 'jitter', label: 'Jitter', min: 0, max: 100, step: 1, defaultValue: 0 },
    { key: 'seed', label: 'Seed', min: 0, max: 999, step: 1, defaultValue: 0 },
    { key: 'opacity', label: 'Opacity', min: 1, max: 100, step: 1, defaultValue: 100 },
    {
      key: 'gaps',
      label: 'Gaps',
      min: 0,
      max: 1,
      defaultValue: 0,
      options: [
        { value: 0, label: 'Keep Layer' },
        { value: 1, label: 'Background Color' },
      ],
    },
  ],
  applyGpu: (engine, layerId, values) => {
    const { foregroundColor, backgroundColor } = useToolSettingsStore.getState();
    const a = sunburstArgs(values, foregroundColor, backgroundColor);
    filterSunburst(
      engine,
      layerId,
      a.rays,
      a.centerX,
      a.centerY,
      a.rotationDegrees,
      a.length,
      a.width,
      a.taper,
      a.fade,
      a.softness,
      a.jitter,
      a.seed,
      a.rayColor[0],
      a.rayColor[1],
      a.rayColor[2],
      a.rayColor[3],
      a.shouldFillGaps,
      a.gapColor[0],
      a.gapColor[1],
      a.gapColor[2],
    );
  },
};
