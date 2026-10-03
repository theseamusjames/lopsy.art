import type { Color } from '../../types';
import type { TextColorSpan } from '../../types/layers';

/**
 * Per-range text colours (#1154). A text layer has a base `color`; spans
 * override it over UTF-16 ranges of the text. Spans are kept normalized:
 * sorted, non-overlapping, non-empty, inside the text, adjacent equal colours
 * merged, and never equal to the base colour.
 *
 * The helpers work on a per-UTF-16-unit colour array (`null` = base), which
 * keeps edits, overlaps and merges trivially correct; text layers are short
 * enough that the O(length) cost is irrelevant.
 */

export function sameColor(a: Color, b: Color): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
}

type UnitColors = (Color | null)[];

function expand(spans: readonly TextColorSpan[] | undefined, length: number): UnitColors {
  const units: UnitColors = new Array<Color | null>(length).fill(null);
  if (!spans) return units;
  for (const span of spans) {
    const start = Math.max(0, Math.min(length, span.start));
    const end = Math.max(start, Math.min(length, span.end));
    for (let i = start; i < end; i++) units[i] = span.color;
  }
  return units;
}

function compress(units: UnitColors, base: Color | null): TextColorSpan[] {
  const spans: TextColorSpan[] = [];
  let i = 0;
  while (i < units.length) {
    const color = units[i];
    if (!color || (base && sameColor(color, base))) {
      i++;
      continue;
    }
    let end = i + 1;
    while (end < units.length) {
      const next = units[end];
      if (!next || !sameColor(next, color)) break;
      end++;
    }
    spans.push({ start: i, end, color });
    i = end;
  }
  return spans;
}

/** Bring arbitrary spans into normal form for a text of `length` UTF-16 units. */
export function normalizeColorSpans(
  spans: readonly TextColorSpan[] | undefined,
  length: number,
  base: Color,
): TextColorSpan[] {
  return compress(expand(spans, length), base);
}

/** Colour the range `[start, end)` with `color`, returning normalized spans. */
export function setColorForRange(
  spans: readonly TextColorSpan[] | undefined,
  length: number,
  base: Color,
  start: number,
  end: number,
  color: Color,
): TextColorSpan[] {
  const units = expand(spans, length);
  const from = Math.max(0, Math.min(length, Math.min(start, end)));
  const to = Math.max(from, Math.min(length, Math.max(start, end)));
  for (let i = from; i < to; i++) units[i] = color;
  return compress(units, base);
}

/**
 * Carry spans across a text edit from `oldText` to `newText`. The edit is
 * found as the single replaced region between their common prefix and
 * suffix; deleted units drop their colour and inserted units take the colour
 * of the character before the insertion (or after it, at the very start), so
 * typing continues the colour you are typing in. Pass `base: null` when the
 * base colour isn't known yet (spans equal to it are then kept).
 */
export function remapColorSpansForEdit(
  spans: readonly TextColorSpan[] | undefined,
  oldText: string,
  newText: string,
  base: Color | null,
): TextColorSpan[] {
  if (!spans || spans.length === 0) return [];
  if (oldText === newText) return compress(expand(spans, newText.length), base);

  const maxShared = Math.min(oldText.length, newText.length);
  let prefix = 0;
  while (prefix < maxShared && oldText.charCodeAt(prefix) === newText.charCodeAt(prefix)) prefix++;
  let suffix = 0;
  while (
    suffix < maxShared - prefix
    && oldText.charCodeAt(oldText.length - 1 - suffix) === newText.charCodeAt(newText.length - 1 - suffix)
  ) suffix++;

  const units = expand(spans, oldText.length);
  const inserted = newText.length - prefix - suffix;
  const inherit = (prefix > 0 ? units[prefix - 1] : units[oldText.length - suffix]) ?? null;
  const next: UnitColors = [
    ...units.slice(0, prefix),
    ...new Array<Color | null>(inserted).fill(inherit),
    ...units.slice(oldText.length - suffix),
  ];
  return compress(next, base);
}

/**
 * The single colour shown for the range `[start, end)`, or `null` when the
 * range holds more than one colour (the control's mixed "–" state). An empty
 * range reports the colour of the whole text, since a pick then recolours it
 * all.
 */
export function colorOfRange(
  base: Color,
  spans: readonly TextColorSpan[] | undefined,
  length: number,
  start: number,
  end: number,
): Color | null {
  let from = Math.max(0, Math.min(length, Math.min(start, end)));
  let to = Math.max(from, Math.min(length, Math.max(start, end)));
  if (from === to) {
    from = 0;
    to = length;
  }
  if (from === to) return base;
  const units = expand(spans, length);
  const first = units[from] ?? base;
  for (let i = from + 1; i < to; i++) {
    if (!sameColor(units[i] ?? base, first)) return null;
  }
  return first;
}

/** Colour of every UTF-16 unit of a text of `length` units (path text draws per unit index). */
export function unitColors(
  length: number,
  base: Color,
  spans: readonly TextColorSpan[] | undefined,
): Color[] {
  return expand(spans, length).map((c) => c ?? base);
}

function isStoredColor(value: unknown): value is Color {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  return ['r', 'g', 'b', 'a'].every((k) => typeof c[k] === 'number' && Number.isFinite(c[k]));
}

/** Read spans from a saved project, dropping malformed entries. Undefined when none survive. */
export function parseStoredColorSpans(value: unknown): TextColorSpan[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const spans: TextColorSpan[] = [];
  for (const entry of value as unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { start, end, color } = entry as Record<string, unknown>;
    if (typeof start !== 'number' || typeof end !== 'number' || !(end > start) || !isStoredColor(color)) continue;
    spans.push({ start, end, color: { r: color.r, g: color.g, b: color.b, a: color.a } });
  }
  return spans.length > 0 ? spans : undefined;
}

/**
 * The engine's `colorSpans` props field: `[start, end, r, g, b, a]` per span,
 * offsets in UTF-16 units and channels in 0..1 (the engine maps offsets to
 * its UTF-8 layout).
 */
export function colorSpansProp(spans: readonly TextColorSpan[] | undefined): number[][] {
  if (!spans) return [];
  return spans.map((s) => [s.start, s.end, s.color.r / 255, s.color.g / 255, s.color.b / 255, s.color.a]);
}
