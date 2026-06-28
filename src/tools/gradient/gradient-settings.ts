import type { Color } from '../../types';
import type { GradientStop, GradientType } from './gradient';

/**
 * Per-tool settings slice for the Gradient tool.
 *
 * Authoritative settings type for gradient. The slice lives under
 * `settings.gradient` on the global ToolSettings store (see #453).
 * Same pattern as `wand-settings.ts` / `fill-settings.ts` /
 * `marquee-settings.ts` / `smudge-settings.ts` / `pencil-settings.ts` /
 * `sponge-settings.ts` / `eraser-settings.ts` / `path-settings.ts` /
 * `stamp-settings.ts` / `magnetic-lasso-settings.ts` /
 * `text-settings.ts` / `spray-settings.ts` / `healing-settings.ts`:
 * `<Tool>Settings` interface + `DEFAULT_<TOOL>_SETTINGS` + a
 * `clamp<Tool>Setting` helper, then registered in
 * `tool-settings-slices.ts`. Three fields: the `type` enum, the `stops`
 * list (length and per-stop position both clamped), and a `reverse`
 * boolean.
 *
 * `type` collapses unknown strings to `'linear'` rather than no-opping
 * silently — same shape as the `shape` slice (#623) where the legacy
 * setter early-returned on invalid input. A typed-string `@ts-ignore`
 * bypass can't leave the GPU dispatch staring at a stale enum.
 *
 * `stops` clamps:
 *   - Below 2 stops: pad with `{ position: i, color: opaque black }` —
 *     the gradient shaders require at least two stops to interpolate.
 *   - Above 16 stops: slice. 16 matches `MAX_GRADIENT_STOPS` in the
 *     GPU dispatch — beyond that the uniform buffer overflows.
 *   - Per-stop position into `[0, 1]`.
 *   - Sorted by position so consumers can binary-search the interval
 *     without re-sorting.
 */
export const MIN_GRADIENT_STOPS = 2;
export const MAX_GRADIENT_STOPS = 16;

export interface GradientSettings {
  readonly type: GradientType;
  readonly stops: readonly GradientStop[];
  readonly reverse: boolean;
}

export const DEFAULT_GRADIENT_SETTINGS: GradientSettings = {
  type: 'linear',
  stops: [
    { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
    { position: 1, color: { r: 255, g: 255, b: 255, a: 1 } },
  ],
  reverse: false,
};

function clampStops(stops: readonly GradientStop[]): readonly GradientStop[] {
  const padded: GradientStop[] = stops.length < MIN_GRADIENT_STOPS
    ? [
        ...stops,
        ...Array.from(
          { length: MIN_GRADIENT_STOPS - stops.length },
          (_, i): GradientStop => ({
            position: stops.length + i,
            color: { r: 0, g: 0, b: 0, a: 1 },
          }),
        ),
      ]
    : stops.slice(0, MAX_GRADIENT_STOPS);
  const clamped: GradientStop[] = padded.map((s) => ({
    position: Math.max(0, Math.min(1, s.position)),
    color: s.color,
  }));
  clamped.sort((a, b) => a.position - b.position);
  return clamped;
}

export function clampGradientSetting<K extends keyof GradientSettings>(
  key: K,
  value: GradientSettings[K],
): GradientSettings[K] {
  if (key === 'type') {
    const t = value as GradientType;
    if (t !== 'linear' && t !== 'radial') {
      return 'linear' as GradientSettings[K];
    }
    return value;
  }
  if (key === 'stops') {
    return clampStops(value as readonly GradientStop[]) as GradientSettings[K];
  }
  return value;
}

/**
 * Append a stop to an existing stop list. Used by the gradient editor's
 * "add stop" affordances. Rejects if the list is already at the max —
 * the GPU dispatch has a fixed-size stop uniform — and clamps the new
 * stop's position into `[0, 1]`. The result is re-sorted so consumers
 * can binary-search the interval without re-sorting.
 */
export function appendGradientStop(
  stops: readonly GradientStop[],
  position: number,
  color: Color,
): readonly GradientStop[] {
  if (stops.length >= MAX_GRADIENT_STOPS) return stops;
  const newStop: GradientStop = {
    position: Math.max(0, Math.min(1, position)),
    color,
  };
  const next = [...stops, newStop];
  next.sort((a, b) => a.position - b.position);
  return next;
}

/**
 * Remove the stop at `index`. Rejects if removing would drop the list
 * below the minimum — the gradient shaders require at least two stops.
 */
export function removeGradientStopAt(
  stops: readonly GradientStop[],
  index: number,
): readonly GradientStop[] {
  if (stops.length <= MIN_GRADIENT_STOPS) return stops;
  return stops.filter((_, i) => i !== index);
}

/**
 * Patch the stop at `index` with a partial. Position is clamped into
 * `[0, 1]`; color (if present) overwrites. Re-sorts so moving a stop
 * past its neighbour reorders the list rather than producing a
 * non-monotonic gradient (which would render with a flat band).
 */
export function updateGradientStopAt(
  stops: readonly GradientStop[],
  index: number,
  partial: Partial<GradientStop>,
): readonly GradientStop[] {
  const next = stops.map((stop, i) => {
    if (i !== index) return stop;
    return {
      position: partial.position !== undefined
        ? Math.max(0, Math.min(1, partial.position))
        : stop.position,
      color: partial.color ?? stop.color,
    };
  });
  return [...next].sort((a, b) => a.position - b.position);
}
