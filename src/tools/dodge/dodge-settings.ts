import type { DodgeMode } from './dodge';

/**
 * Per-tool settings slice for the Dodge / Burn tool.
 *
 * Authoritative settings type for dodge. The slice lives under
 * `settings.dodge` on the global ToolSettings store (see #453).
 * Same pattern as `wand-settings.ts` / `fill-settings.ts` /
 * `marquee-settings.ts`: `<Tool>Settings` interface +
 * `DEFAULT_<TOOL>_SETTINGS` + a `clamp<Tool>Setting` helper, then
 * registered in `tool-settings-slices.ts`. Two-field shape with a
 * typed enum (`mode`) — first slice to carry a discriminated string
 * union, confirming the slice infrastructure narrows enums cleanly.
 */
export interface DodgeSettings {
  exposure: number;
  mode: DodgeMode;
}

export const DEFAULT_DODGE_SETTINGS: DodgeSettings = {
  exposure: 50,
  mode: 'dodge',
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
