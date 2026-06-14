import type { DodgeMode } from './dodge';

/**
 * Per-tool settings slice for the Dodge/Burn tool.
 *
 * Authoritative settings type for dodge. The slice lives under
 * `settings.dodge` on the global ToolSettings store (see #453).
 * Same pattern as `wand-settings.ts` / `fill-settings.ts` /
 * `marquee-settings.ts` / `smudge-settings.ts` / `pencil-settings.ts` /
 * `sponge-settings.ts` / `eraser-settings.ts` / `path-settings.ts` /
 * `stamp-settings.ts` / `magnetic-lasso-settings.ts`:
 * `<Tool>Settings` interface + `DEFAULT_<TOOL>_SETTINGS` + a
 * `clamp<Tool>Setting` helper, then registered in
 * `tool-settings-slices.ts`. Two fields — exposure (a 1–100 percent
 * applied as ÷100 to the dab) and mode (dodge | burn).
 */
export interface DodgeSettings {
  mode: DodgeMode;
  exposure: number;
}

export const DEFAULT_DODGE_SETTINGS: DodgeSettings = {
  mode: 'dodge',
  exposure: 50,
};

export function clampDodgeSetting<K extends keyof DodgeSettings>(
  key: K,
  value: DodgeSettings[K],
): DodgeSettings[K] {
  if (key === 'exposure') {
    const n = value as number;
    return Math.max(1, Math.min(100, n)) as DodgeSettings[K];
  }
  return value;
}
