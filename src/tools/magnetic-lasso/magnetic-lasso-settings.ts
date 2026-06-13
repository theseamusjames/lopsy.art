/**
 * Per-tool settings slice for the Magnetic Lasso tool.
 *
 * Authoritative settings type for magnetic-lasso. The slice lives under
 * `settings.magneticLasso` on the global ToolSettings store (see #453).
 * Same pattern as `wand-settings.ts` / `fill-settings.ts` /
 * `marquee-settings.ts` / `smudge-settings.ts` / `pencil-settings.ts` /
 * `sponge-settings.ts` / `eraser-settings.ts` / `path-settings.ts` /
 * `stamp-settings.ts`: `<Tool>Settings` interface +
 * `DEFAULT_<TOOL>_SETTINGS` + a `clamp<Tool>Setting` helper, then
 * registered in `tool-settings-slices.ts`. Three numeric fields, all
 * rounded integers with different clamp ranges — the first slice with
 * a pure round-and-clamp shape across every field.
 */
export interface MagneticLassoSettings {
  width: number;
  contrast: number;
  frequency: number;
}

export const DEFAULT_MAGNETIC_LASSO_SETTINGS: MagneticLassoSettings = {
  width: 10,
  contrast: 40,
  frequency: 40,
};

export function clampMagneticLassoSetting<K extends keyof MagneticLassoSettings>(
  key: K,
  value: MagneticLassoSettings[K],
): MagneticLassoSettings[K] {
  if (key === 'width') {
    const n = value as number;
    return Math.max(1, Math.min(40, Math.round(n))) as MagneticLassoSettings[K];
  }
  if (key === 'contrast') {
    const n = value as number;
    return Math.max(1, Math.min(100, Math.round(n))) as MagneticLassoSettings[K];
  }
  if (key === 'frequency') {
    const n = value as number;
    return Math.max(0, Math.min(200, Math.round(n))) as MagneticLassoSettings[K];
  }
  return value;
}
