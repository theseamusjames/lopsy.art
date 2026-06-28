import type { Color } from '../../types';
import type { ShapeMode, ShapeOutput } from './shape';

/**
 * Per-tool settings slice for the Shape tool.
 *
 * Authoritative settings type for shape. The slice lives under
 * `settings.shape` on the global ToolSettings store (see #453).
 * Same pattern as `wand-settings.ts` / `fill-settings.ts` /
 * `marquee-settings.ts` / `smudge-settings.ts` / `pencil-settings.ts` /
 * `sponge-settings.ts` / `eraser-settings.ts` / `path-settings.ts` /
 * `stamp-settings.ts` / `magnetic-lasso-settings.ts` /
 * `text-settings.ts` / `spray-settings.ts` / `healing-settings.ts`:
 * `<Tool>Settings` interface + `DEFAULT_<TOOL>_SETTINGS` + a
 * `clamp<Tool>Setting` helper, then registered in
 * `tool-settings-slices.ts`. Seven fields covering geometry (mode,
 * output, polygonSides, cornerRadius) and appearance (fillColor,
 * strokeColor, strokeWidth) — the largest slice by field count so
 * far, and the first slice to mix three rectangular numeric clamps
 * with two nullable-color fields and two tagged-union enums in one
 * shape.
 *
 * The `mode` field rejects invalid strings (`'rectangle'`, `'line'`,
 * etc.) by falling back to `'ellipse'` rather than letting a
 * `@ts-ignore` bypass leave the GPU shader rendering a polygon with
 * stale `sides` — the same guard the legacy `setShapeMode` carried
 * (issue #236). `output` collapses unknown values to `'pixels'` for
 * the same reason.
 */
export interface ShapeSettings {
  mode: ShapeMode;
  output: ShapeOutput;
  fillColor: Color | null;
  strokeColor: Color | null;
  strokeWidth: number;
  polygonSides: number;
  cornerRadius: number;
}

export const DEFAULT_SHAPE_SETTINGS: ShapeSettings = {
  mode: 'ellipse',
  output: 'pixels',
  fillColor: { r: 255, g: 255, b: 255, a: 1 },
  strokeColor: null,
  strokeWidth: 2,
  polygonSides: 6,
  cornerRadius: 0,
};

export function clampShapeSetting<K extends keyof ShapeSettings>(
  key: K,
  value: ShapeSettings[K],
): ShapeSettings[K] {
  if (key === 'mode') {
    const m = value as string;
    if (m !== 'ellipse' && m !== 'polygon') return 'ellipse' as ShapeSettings[K];
    return value;
  }
  if (key === 'output') {
    const o = value as string;
    if (o !== 'pixels' && o !== 'path') return 'pixels' as ShapeSettings[K];
    return value;
  }
  if (key === 'strokeWidth') {
    const n = value as number;
    return Math.max(1, Math.min(50, n)) as ShapeSettings[K];
  }
  if (key === 'polygonSides') {
    const n = value as number;
    return Math.max(3, Math.min(64, Math.round(n))) as ShapeSettings[K];
  }
  if (key === 'cornerRadius') {
    const n = value as number;
    return Math.max(0, Math.min(200, n)) as ShapeSettings[K];
  }
  return value;
}
