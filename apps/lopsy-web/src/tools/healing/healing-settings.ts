/**
 * Per-tool settings slice for the Healing Brush tool.
 *
 * Authoritative settings type for healing. The slice lives under
 * `settings.healing` on the global ToolSettings store (see #453).
 * Same pattern as `wand-settings.ts` / `fill-settings.ts` /
 * `marquee-settings.ts` / `smudge-settings.ts` / `pencil-settings.ts` /
 * `sponge-settings.ts` / `eraser-settings.ts` / `path-settings.ts` /
 * `stamp-settings.ts` / `magnetic-lasso-settings.ts` /
 * `text-settings.ts` / `spray-settings.ts`: `<Tool>Settings` interface
 * + `DEFAULT_<TOOL>_SETTINGS` + a `clamp<Tool>Setting` helper, then
 * registered in `tool-settings-slices.ts`. Two numeric fields: `size`
 * and `opacity`. Mirrors the eraser-slice shape — opacity clamps to
 * `[1, 100]` (not `[0, 100]`) so callers can't silently get a no-op
 * stroke, the same percent-vs-normalised footgun guarded by the
 * warn-once dedupe in the store.
 */
export interface HealingSettings {
  size: number;
  opacity: number;
}

export const DEFAULT_HEALING_SETTINGS: HealingSettings = {
  size: 20,
  opacity: 100,
};

export function clampHealingSetting<K extends keyof HealingSettings>(
  key: K,
  value: HealingSettings[K],
): HealingSettings[K] {
  if (key === 'size') {
    const n = value as number;
    return Math.max(1, Math.min(5000, n)) as HealingSettings[K];
  }
  if (key === 'opacity') {
    const n = value as number;
    return Math.max(1, Math.min(100, n)) as HealingSettings[K];
  }
  return value;
}
