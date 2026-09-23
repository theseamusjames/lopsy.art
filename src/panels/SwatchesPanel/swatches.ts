import type { Color } from '../../types';

/** A saved palette entry. `name` is empty for unnamed swatches. */
export interface Swatch {
  readonly color: Color;
  readonly name: string;
}

export interface ParsedPalette {
  readonly name: string;
  readonly swatches: Swatch[];
}

/** Upper bound on saved swatches — matches the Indexed palette ceiling. */
export const MAX_SWATCHES = 256;

function opaque(r: number, g: number, b: number): Color {
  return { r, g, b, a: 1 };
}

export const DEFAULT_SWATCHES: readonly Swatch[] = [
  { color: opaque(0, 0, 0), name: 'Black' },
  { color: opaque(64, 64, 64), name: 'Charcoal' },
  { color: opaque(128, 128, 128), name: 'Gray' },
  { color: opaque(192, 192, 192), name: 'Silver' },
  { color: opaque(255, 255, 255), name: 'White' },
  { color: opaque(229, 57, 53), name: 'Red' },
  { color: opaque(251, 140, 0), name: 'Orange' },
  { color: opaque(253, 216, 53), name: 'Yellow' },
  { color: opaque(124, 179, 66), name: 'Leaf' },
  { color: opaque(0, 137, 123), name: 'Teal' },
  { color: opaque(30, 136, 229), name: 'Blue' },
  { color: opaque(57, 73, 171), name: 'Indigo' },
  { color: opaque(142, 36, 170), name: 'Purple' },
  { color: opaque(216, 27, 96), name: 'Magenta' },
  { color: opaque(255, 205, 210), name: 'Blush' },
  { color: opaque(255, 224, 178), name: 'Peach' },
  { color: opaque(200, 230, 201), name: 'Mint' },
  { color: opaque(187, 222, 251), name: 'Sky' },
  { color: opaque(225, 190, 231), name: 'Lavender' },
  { color: opaque(121, 85, 72), name: 'Umber' },
  { color: opaque(161, 136, 127), name: 'Taupe' },
  { color: opaque(188, 143, 91), name: 'Ochre' },
  { color: opaque(85, 107, 47), name: 'Olive' },
  { color: opaque(38, 50, 56), name: 'Slate' },
];

function colorKey(c: Color): string {
  return `${c.r},${c.g},${c.b},${Math.round(c.a * 255)}`;
}

function toHexByte(v: number): string {
  return v.toString(16).padStart(2, '0');
}

export function swatchHex(c: Color): string {
  return `#${toHexByte(c.r)}${toHexByte(c.g)}${toHexByte(c.b)}`;
}

/** Tooltip / accessible label: "Name (#rrggbb)" or just the hex. */
export function swatchLabel(s: Swatch): string {
  const hex = swatchHex(s.color);
  return s.name ? `${s.name} (${hex})` : hex;
}

/**
 * Append `incoming` to `list`, skipping exact RGBA duplicates (against both
 * the existing list and earlier incoming entries) and stopping at
 * MAX_SWATCHES. Returns the same array when nothing was added so callers can
 * cheaply detect a no-op.
 */
export function addSwatches(list: readonly Swatch[], incoming: readonly Swatch[]): readonly Swatch[] {
  const keys = new Set(list.map((s) => colorKey(s.color)));
  const added: Swatch[] = [];
  for (const s of incoming) {
    if (list.length + added.length >= MAX_SWATCHES) break;
    const key = colorKey(s.color);
    if (keys.has(key)) continue;
    keys.add(key);
    added.push(s);
  }
  return added.length === 0 ? list : [...list, ...added];
}

export function removeSwatchAt(list: readonly Swatch[], index: number): readonly Swatch[] {
  if (index < 0 || index >= list.length) return list;
  return [...list.slice(0, index), ...list.slice(index + 1)];
}

interface Hsl {
  h: number;
  s: number;
  l: number;
}

function rgbToHsl(c: Color): Hsl {
  const r = c.r / 255;
  const g = c.g / 255;
  const b = c.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

/** Below this saturation a color reads as a neutral and sorts with the grays. */
const NEUTRAL_SATURATION = 0.12;
const HUE_BUCKET_DEGREES = 30;

/**
 * Order colors the way a painter reads a palette: neutrals first from dark to
 * light, then chromatic colors around the hue wheel. Hue is bucketed so near
 * hues group by lightness instead of interleaving on tiny hue differences.
 */
export function sortColorsForPalette(colors: readonly Color[]): Color[] {
  const keyed = colors.map((color) => ({ color, hsl: rgbToHsl(color) }));
  keyed.sort((a, b) => {
    const aNeutral = a.hsl.s < NEUTRAL_SATURATION;
    const bNeutral = b.hsl.s < NEUTRAL_SATURATION;
    if (aNeutral !== bNeutral) return aNeutral ? -1 : 1;
    if (!aNeutral) {
      const bucketDiff =
        Math.floor(a.hsl.h / HUE_BUCKET_DEGREES) - Math.floor(b.hsl.h / HUE_BUCKET_DEGREES);
      if (bucketDiff !== 0) return bucketDiff;
    }
    return a.hsl.l - b.hsl.l;
  });
  return keyed.map((k) => k.color);
}

const GPL_HEADER = 'GIMP Palette';
const GPL_COLOR_LINE = /^\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})(?:\s+(.*))?$/;

function clampByte(v: number): number {
  return Math.min(255, Math.max(0, v));
}

/**
 * Parse a GIMP `.gpl` palette. GPL carries no alpha, so every entry is
 * opaque. Unrecognised lines are skipped rather than rejected — palettes in
 * the wild carry assorted extra headers — but a missing header or a file
 * with no colors at all is an error.
 */
export function parseGpl(text: string): ParsedPalette {
  const lines = text.split(/\r?\n/);
  const firstContent = lines.findIndex((l) => l.trim().length > 0);
  if (firstContent === -1 || lines[firstContent]?.trim() !== GPL_HEADER) {
    throw new Error('Not a GIMP palette (missing "GIMP Palette" header)');
  }
  let name = '';
  const swatches: Swatch[] = [];
  for (const raw of lines.slice(firstContent + 1)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const nameMatch = /^Name:\s*(.*)$/.exec(line);
    if (nameMatch) {
      name = (nameMatch[1] ?? '').trim();
      continue;
    }
    const m = GPL_COLOR_LINE.exec(line);
    if (!m) continue;
    const entryName = (m[4] ?? '').trim();
    swatches.push({
      color: opaque(clampByte(Number(m[1])), clampByte(Number(m[2])), clampByte(Number(m[3]))),
      name: /^untitled$/i.test(entryName) ? '' : entryName,
    });
  }
  if (swatches.length === 0) throw new Error('Palette contains no colors');
  return { name, swatches };
}

const GPL_COLUMNS = 8;

/** Serialize to GIMP `.gpl`. Alpha is dropped — the format has no channel for it. */
export function serializeGpl(swatches: readonly Swatch[], paletteName: string): string {
  const pad = (v: number) => String(v).padStart(3, ' ');
  const lines = [GPL_HEADER, `Name: ${paletteName}`, `Columns: ${GPL_COLUMNS}`, '#'];
  for (const s of swatches) {
    const { r, g, b } = s.color;
    lines.push(`${pad(r)} ${pad(g)} ${pad(b)}\t${s.name || swatchHex(s.color)}`);
  }
  return `${lines.join('\n')}\n`;
}

function isByte(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 255;
}

function sanitizeSwatch(raw: unknown): Swatch | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { color, name } = raw as { color?: unknown; name?: unknown };
  if (typeof color !== 'object' || color === null) return null;
  const { r, g, b, a } = color as Record<string, unknown>;
  if (!isByte(r) || !isByte(g) || !isByte(b)) return null;
  const alpha = typeof a === 'number' && Number.isFinite(a) ? Math.min(1, Math.max(0, a)) : 1;
  return { color: { r, g, b, a: alpha }, name: typeof name === 'string' ? name : '' };
}

/**
 * Validate a persisted swatch list. Persisted data is untrusted (older
 * versions, hand edits), so malformed entries are dropped and duplicates /
 * overflow are trimmed. Returns null when the payload is not a list at all.
 */
export function sanitizeSwatches(raw: unknown): Swatch[] | null {
  if (!Array.isArray(raw)) return null;
  const valid = raw.map(sanitizeSwatch).filter((s): s is Swatch => s !== null);
  return [...addSwatches([], valid)];
}
