import type { FontCategory, FontEntry } from './font-catalog';

/**
 * The per-face record the Local Font Access API hands back from
 * `window.queryLocalFonts()` (minus the `blob()` accessor, which the store
 * keeps on the live object). One record per face, not per family — a family
 * with Regular / Bold / Bold Italic shows up as three records.
 */
export interface LocalFontFace {
  readonly family: string;
  readonly fullName: string;
  readonly postscriptName: string;
  readonly style: string;
}

// Checked in order: the compound names must win over their suffix
// ("ExtraLight" before "Light", "SemiBold" before "Bold"). Matching runs on
// the style with whitespace/hyphens stripped so "Semi Bold", "Semi-Bold" and
// "SemiBold" all land on the same row.
const WEIGHT_PATTERNS: ReadonlyArray<readonly [RegExp, number]> = [
  [/extrablack|ultrablack/, 1000],
  [/hairline|thin/, 100],
  [/extralight|ultralight/, 200],
  [/light/, 300],
  [/medium/, 500],
  [/semibold|demibold|demi/, 600],
  [/extrabold|ultrabold/, 800],
  [/heavy|black/, 900],
  [/bold/, 700],
];

// Japanese system families (Hiragino, Toppan Bunkyu, …) name their weights
// W0–W9 rather than with English words.
const NUMBERED_WEIGHT = /(?:^|\s)w(\d)(?:\s|$)/i;

/** Map an OS style name ("Bold Italic", "Semi Bold", "W6") to a CSS weight. */
export function styleToWeight(style: string): number {
  const compact = style.toLowerCase().replace(/[\s_-]+/g, '');
  for (const [pattern, weight] of WEIGHT_PATTERNS) {
    if (pattern.test(compact)) return weight;
  }
  const numbered = NUMBERED_WEIGHT.exec(style);
  if (numbered) return Math.max(100, Number(numbered[1]) * 100);
  return 400;
}

export function isItalicStyle(style: string): boolean {
  return /italic|oblique|inclined|slanted/i.test(style);
}

/**
 * Best-effort CSS generic for a family we know nothing about beyond its name.
 * Only used as the `font-family` fallback while the real face resolves, so a
 * wrong guess costs nothing but a brief flash in the picker row.
 */
export function guessLocalFontCategory(family: string): FontCategory {
  const name = family.toLowerCase();
  if (/mono|courier|consol|menlo|monaco|\bcode\b|typewriter|fixed/.test(name)) return 'monospace';
  if (/script|hand|brush|marker|chalk|casual|cursive|writing|pen\b/.test(name)) return 'handwriting';
  if (/serif/.test(name) && !/sans/.test(name)) return 'serif';
  if (/times|georgia|garamond|baskerville|palatino|didot|bodoni|caslon|minion|cambria|charter|hoefler|cochin|athelas|iowan|book/.test(name)) return 'serif';
  return 'sans-serif';
}

/**
 * Collapse the API's per-face records into one catalog entry per family:
 * the family's weight list (sorted, deduplicated) and whether any face is
 * italic. Families whose name starts with "." are macOS-internal UI faces
 * that CSS cannot address by name, so they are dropped.
 */
export function groupLocalFontFaces(faces: readonly LocalFontFace[]): FontEntry[] {
  const groups = new Map<string, { weights: Set<number>; hasItalic: boolean }>();
  for (const face of faces) {
    const family = face.family.trim();
    if (!family || family.startsWith('.')) continue;
    let group = groups.get(family);
    if (!group) {
      group = { weights: new Set(), hasItalic: false };
      groups.set(family, group);
    }
    group.weights.add(styleToWeight(face.style));
    if (isItalicStyle(face.style)) group.hasItalic = true;
  }

  const entries: FontEntry[] = [];
  for (const [family, group] of groups) {
    entries.push({
      family,
      category: guessLocalFontCategory(family),
      weights: [...group.weights].sort((a, b) => a - b),
      hasItalic: group.hasItalic,
      source: 'local',
      previewFile: null,
      ttfDir: null,
      ttfFile: null,
      ttfWeightFiles: null,
    });
  }
  entries.sort((a, b) => a.family.localeCompare(b.family));
  return entries;
}

/**
 * Picker list: local families first, then the catalog minus any family that
 * is also installed locally. The installed bytes beat a download (Google
 * entries) and beat the Inter fallback (the catalog's name-only "system"
 * entries), so the local row is the one that should be picked.
 */
export function mergeLocalFonts(catalog: readonly FontEntry[], local: readonly FontEntry[]): readonly FontEntry[] {
  if (local.length === 0) return catalog;
  const shadowed = new Set(local.map((entry) => entry.family));
  return [...local, ...catalog.filter((entry) => !shadowed.has(entry.family))];
}
