/**
 * Per-tool settings slice for the Brush tool.
 *
 * Authoritative settings type for the brush's per-stroke dab dynamics.
 * The slice lives under `settings.brush` on the global ToolSettings
 * store (see #453). Same pattern as `wand-settings.ts` /
 * `fill-settings.ts` / `marquee-settings.ts` / `smudge-settings.ts` /
 * `pencil-settings.ts` / `sponge-settings.ts` / `eraser-settings.ts` /
 * `path-settings.ts` / `stamp-settings.ts` /
 * `magnetic-lasso-settings.ts` / `text-settings.ts` /
 * `spray-settings.ts` / `healing-settings.ts`: `<Tool>Settings`
 * interface + `DEFAULT_<TOOL>_SETTINGS` + a `clamp<Tool>Setting`
 * helper, then registered in `tool-settings-slices.ts`.
 *
 * Scope is the eight core dab-dynamics fields shared across every
 * brush stroke (size, opacity, hardness, spacing, scatter, angle,
 * fade, taper). The brush's jitter / speed / texture / tip /
 * presets / sub-brushes still live as flat fields on the store —
 * presets and texture lists are cross-tool infrastructure and
 * stay at the root by design (per the issue body's "cross-tool
 * state stays at root" note), while jitter / speed / tip move in
 * follow-up slices.
 *
 * `opacity` clamps to `[1, 100]` (not `[0, 100]`) so callers can't
 * silently get a no-op stroke — same shape as eraser / healing /
 * spray, gated by the percent-vs-normalised warn-once dedupe in the
 * store.
 */
export interface BrushSettings {
  size: number;
  opacity: number;
  hardness: number;
  spacing: number;
  scatter: number;
  angle: number;
  fade: number;
  taper: number;
}

export const DEFAULT_BRUSH_SETTINGS: BrushSettings = {
  size: 10,
  opacity: 100,
  hardness: 80,
  spacing: 0,
  scatter: 0,
  angle: 0,
  fade: 0,
  taper: 0,
};

export function clampBrushSetting<K extends keyof BrushSettings>(
  key: K,
  value: BrushSettings[K],
): BrushSettings[K] {
  if (key === 'size') {
    const n = value as number;
    return Math.max(1, Math.min(5000, n)) as BrushSettings[K];
  }
  if (key === 'opacity') {
    const n = value as number;
    return Math.max(1, Math.min(100, n)) as BrushSettings[K];
  }
  if (key === 'hardness') {
    const n = value as number;
    return Math.max(0, Math.min(100, n)) as BrushSettings[K];
  }
  if (key === 'spacing') {
    const n = value as number;
    return Math.max(0, Math.min(200, n)) as BrushSettings[K];
  }
  if (key === 'scatter') {
    const n = value as number;
    return Math.max(0, Math.min(100, n)) as BrushSettings[K];
  }
  if (key === 'angle') {
    const n = value as number;
    return (((n % 360) + 360) % 360) as BrushSettings[K];
  }
  if (key === 'fade') {
    const n = value as number;
    return Math.max(0, Math.min(5000, n)) as BrushSettings[K];
  }
  if (key === 'taper') {
    const n = value as number;
    return Math.max(0, Math.min(5000, n)) as BrushSettings[K];
  }
  return value;
}
