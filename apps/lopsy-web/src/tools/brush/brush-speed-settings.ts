/**
 * Per-tool settings slice for the Brush "speed dynamics" sub-tool.
 *
 * Carved out of the flat `brushSpeed*` fields on the ToolSettings store
 * as the brush's first sub-slice (see #453). The remaining brush
 * sub-slices — jitter, texture, tip / presets / sub-brushes — land in
 * follow-up PRs. The slice lives under `settings.brushSpeed` on the
 * global store; reads go through `s.settings.brushSpeed.<field>` and
 * writes through the typed `setBrushSpeedSetting(key, value)` setter.
 *
 * `sensitivity` is an enum, not a number: the brush-stroke hot path
 * maps it to a moving-average window (low → 6, med → 3, high → 2)
 * inside `brush-stroke.ts`. Unknown enum strings collapse to the
 * documented default ('med') here rather than no-op silently, so a
 * `@ts-ignore` bypass can't leave the stroke loop staring at a stale
 * enum.
 */
export type BrushSpeedSensitivity = 'low' | 'med' | 'high';

export interface BrushSpeedSettings {
  size: number;
  sizeInvert: boolean;
  sensitivity: BrushSpeedSensitivity;
}

export const DEFAULT_BRUSH_SPEED_SETTINGS: BrushSpeedSettings = {
  size: 0,
  sizeInvert: false,
  sensitivity: 'med',
};

const SENSITIVITIES: readonly BrushSpeedSensitivity[] = ['low', 'med', 'high'];

export function clampBrushSpeedSetting<K extends keyof BrushSpeedSettings>(
  key: K,
  value: BrushSpeedSettings[K],
): BrushSpeedSettings[K] {
  if (key === 'size') {
    const n = value as number;
    return Math.max(0, Math.min(300, n)) as BrushSpeedSettings[K];
  }
  if (key === 'sizeInvert') {
    return Boolean(value) as BrushSpeedSettings[K];
  }
  if (key === 'sensitivity') {
    const s = value as BrushSpeedSensitivity;
    return (SENSITIVITIES.includes(s) ? s : 'med') as BrushSpeedSettings[K];
  }
  return value;
}
