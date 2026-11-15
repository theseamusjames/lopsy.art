import type { SpongeMode } from './sponge';

/**
 * Per-tool settings slice for the Sponge tool.
 *
 * Authoritative settings type for sponge. The slice lives under
 * `settings.sponge` on the global ToolSettings store (see #453).
 * Same pattern as `wand-settings.ts` / `fill-settings.ts` /
 * `marquee-settings.ts` / `smudge-settings.ts` / `pencil-settings.ts`:
 * `<Tool>Settings` interface + `DEFAULT_<TOOL>_SETTINGS` + a
 * `clamp<Tool>Setting` helper, then registered in
 * `tool-settings-slices.ts`. Three fields — first slice to carry a
 * three-field mixed shape (enum + two numeric clamps) on the paint
 * side, complementing the dodge slice's two-field number-plus-enum
 * shape.
 */
export interface SpongeSettings {
  mode: SpongeMode;
  strength: number;
  size: number;
}

export const DEFAULT_SPONGE_SETTINGS: SpongeSettings = {
  mode: 'desaturate',
  strength: 50,
  size: 30,
};

export function clampSpongeSetting<K extends keyof SpongeSettings>(
  key: K,
  value: SpongeSettings[K],
): SpongeSettings[K] {
  if (key === 'strength') {
    const n = value as number;
    return Math.max(1, Math.min(100, n)) as SpongeSettings[K];
  }
  if (key === 'size') {
    const n = value as number;
    return Math.max(1, Math.min(5000, n)) as SpongeSettings[K];
  }
  return value;
}
