/**
 * Per-tool settings slice for the Spray tool.
 *
 * Authoritative settings type for spray. The slice lives under
 * `settings.spray` on the global ToolSettings store (see #453).
 * Future per-tool slices follow the same pattern: a `<Tool>Settings`
 * interface + `DEFAULT_<TOOL>_SETTINGS` + a `clamp<Tool>Setting`
 * helper, then registered in `tool-settings-slices.ts`.
 */
export interface SpraySettings {
  readonly size: number;
  readonly density: number;
  readonly opacity: number;
  readonly hardness: number;
}

export const DEFAULT_SPRAY_SETTINGS: SpraySettings = {
  size: 40,
  density: 20,
  opacity: 60,
  hardness: 30,
};

export function clampSpraySetting<K extends keyof SpraySettings>(
  key: K,
  value: SpraySettings[K],
): SpraySettings[K] {
  if (key === 'size') {
    const n = value as number;
    return Math.max(1, Math.min(5000, n)) as SpraySettings[K];
  }
  if (key === 'density') {
    const n = value as number;
    return Math.max(1, Math.min(100, n)) as SpraySettings[K];
  }
  if (key === 'opacity') {
    const n = value as number;
    return Math.max(1, Math.min(100, n)) as SpraySettings[K];
  }
  if (key === 'hardness') {
    const n = value as number;
    return Math.max(0, Math.min(100, n)) as SpraySettings[K];
  }
  return value;
}
