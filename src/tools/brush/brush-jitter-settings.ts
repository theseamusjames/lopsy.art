/**
 * Per-tool settings slice for the Brush's jitter sub-namespace.
 *
 * Authoritative settings type for the brush's randomisation jitter —
 * a follow-up slice to the `brush` dab-dynamics slice. Same pattern as
 * `wand-settings.ts` / `fill-settings.ts` / `marquee-settings.ts` /
 * `smudge-settings.ts` / `pencil-settings.ts` / `sponge-settings.ts` /
 * `eraser-settings.ts` / `path-settings.ts` / `stamp-settings.ts` /
 * `magnetic-lasso-settings.ts` / `text-settings.ts` /
 * `spray-settings.ts` / `healing-settings.ts` / `brush-settings.ts`:
 * `<Tool>Settings` interface + `DEFAULT_<TOOL>_SETTINGS` + a
 * `clamp<Tool>Setting` helper, then registered in
 * `tool-settings-slices.ts`.
 *
 * The `brush` dab-dynamics slice intentionally excludes jitter — see
 * the JSDoc on `brush-settings.ts`: jitter, speed and tip move in
 * their own follow-up slices because they're a distinct namespace
 * with their own option-bar panel (the Brush modal's Dynamics tab)
 * and their own clamp range (0–100, percent-of-base).
 *
 * Every field is a percent-of-base 0–100 value that the paint
 * handlers divide by 100 before feeding the brush kernel.
 */
export interface BrushJitterSettings {
  size: number;
  hardness: number;
  angle: number;
  opacity: number;
}

export const DEFAULT_BRUSH_JITTER_SETTINGS: BrushJitterSettings = {
  size: 0,
  hardness: 0,
  angle: 0,
  opacity: 0,
};

export function clampBrushJitterSetting<K extends keyof BrushJitterSettings>(
  key: K,
  value: BrushJitterSettings[K],
): BrushJitterSettings[K] {
  // Every jitter field is the same percent-of-base 0–100 range, so
  // the switch is degenerate today. Keeping the per-key shape (vs. a
  // single `Math.max(0, Math.min(100, n))`) so future fields with a
  // different range can land without restructuring callers.
  if (key === 'size' || key === 'hardness' || key === 'angle' || key === 'opacity') {
    const n = value as number;
    return Math.max(0, Math.min(100, n)) as BrushJitterSettings[K];
  }
  return value;
}
