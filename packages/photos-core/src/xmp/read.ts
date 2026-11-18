/**
 * Reads XMP sidecars written by other editors (and by us): marks,
 * keywords, title, caption, and basic edits.
 *
 * Camera Raw edits are mapped to our recipe one to one in value, which is
 * only an approximation: our tone controls are not Adobe's maths, so the
 * same numbers give a similar direction and rough strength, not the same
 * picture. White balance is skipped (Camera Raw stores Kelvin; ours is a
 * relative shift that needs camera data, spec E9), as are anything but an
 * unrotated crop and quarter-turn rotations.
 *
 * | Camera Raw (crs:)          | Range        | Recipe path       | Scale |
 * |----------------------------|--------------|-------------------|-------|
 * | Exposure2012               | -5..+5 EV    | tone.exposure     | x1    |
 * | Contrast2012               | -100..100    | tone.contrast     | x1    |
 * | Highlights2012             | -100..100    | tone.highlights   | x1    |
 * | Shadows2012                | -100..100    | tone.shadows      | x1    |
 * | Whites2012                 | -100..100    | tone.whites       | x1    |
 * | Blacks2012                 | -100..100    | tone.blacks       | x1    |
 * | Vibrance                   | -100..100    | color.vibrance    | x1    |
 * | Saturation                 | -100..100    | color.saturation  | x1    |
 * | CropLeft/Top/Right/Bottom  | 0..1         | framing.crop      | when HasCrop, CropAngle 0 and the photo is unrotated |
 * | tiff:Orientation vs file   | 1, 6, 3, 8   | framing.rotate    | the quarter turns between them |
 * | Temperature, Tint          | Kelvin       | (skipped)         |       |
 */

import { DEFAULT_RECIPE, recipeFromPaths, recipeToPaths } from '../library/recipe';
import type { CropRect, Recipe, RecipeLeaf } from '../library/recipe';
import type { ColorLabel } from '../library/types';
import { XML_NAMESPACE, attribute, parseXml, walk } from './xml';
import type { XmlElement } from './xml';

export const NS = {
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  xmp: 'http://ns.adobe.com/xap/1.0/',
  dc: 'http://purl.org/dc/elements/1.1/',
  lr: 'http://ns.adobe.com/lightroom/1.0/',
  crs: 'http://ns.adobe.com/camera-raw-settings/1.0/',
  tiff: 'http://ns.adobe.com/tiff/1.0/',
  /** Ours: the recipe, one attribute per dotted path, values as JSON. */
  lopsy: 'https://lopsy.art/ns/photos/1.0/',
} as const;

/** Sidecars bigger than this are not read. */
export const MAX_XMP_CHARS = 2 * 1024 * 1024;
const MAX_KEYWORDS = 1000;
const MAX_TEXT = 10_000;

export const CRS_MAPPING: readonly { readonly crs: string; readonly path: string }[] = [
  { crs: 'Exposure2012', path: 'tone.exposure' },
  { crs: 'Contrast2012', path: 'tone.contrast' },
  { crs: 'Highlights2012', path: 'tone.highlights' },
  { crs: 'Shadows2012', path: 'tone.shadows' },
  { crs: 'Whites2012', path: 'tone.whites' },
  { crs: 'Blacks2012', path: 'tone.blacks' },
  { crs: 'Vibrance', path: 'color.vibrance' },
  { crs: 'Saturation', path: 'color.saturation' },
];

const LABELS: Readonly<Record<string, ColorLabel>> = {
  red: 'red',
  yellow: 'yellow',
  green: 'green',
  blue: 'blue',
  purple: 'purple',
};

export interface XmpData {
  /** 0 to 5; null when absent. */
  readonly rating: number | null;
  /** True for a rejected photo (xmp:Rating -1); null when absent. */
  readonly setAside: boolean | null;
  readonly label: ColorLabel | null;
  readonly keywords: readonly string[];
  readonly title: string | null;
  readonly caption: string | null;
  /** Our own recipe, exactly as written by `writeXmp`; null when the sidecar has none. */
  readonly recipe: Recipe | null;
  /** Approximate edits from Camera Raw settings, by recipe path. */
  readonly edits: Readonly<Record<string, number>>;
  /** Camera Raw crop, normalized to the unrotated image; null without a plain crop. */
  readonly crop: CropRect | null;
  /** tiff:Orientation, when the sidecar has one. */
  readonly orientation: number | null;
}

type Value = string | readonly string[];

/** Every property in every rdf:Description, by `uri|local`, as text or a list. */
function collectProperties(root: XmlElement): Map<string, Value> {
  const props = new Map<string, Value>();
  for (const el of walk(root)) {
    if (el.name.uri !== NS.rdf || el.name.local !== 'Description') continue;
    for (const a of el.attributes) {
      if (a.uri === NS.rdf || a.uri === '' || a.uri === XML_NAMESPACE || a.uri === 'http://www.w3.org/2000/xmlns/') continue;
      props.set(`${a.uri}|${a.local}`, a.value);
    }
    for (const child of el.children) {
      const key = `${child.name.uri}|${child.name.local}`;
      const list = child.children.find((c) => c.name.uri === NS.rdf && ['Bag', 'Seq', 'Alt'].includes(c.name.local));
      if (list) {
        const items = list.children.filter((c) => c.name.uri === NS.rdf && c.name.local === 'li');
        if (list.name.local === 'Alt') {
          const preferred = items.find((li) => attribute(li, XML_NAMESPACE, 'lang') === 'x-default') ?? items[0];
          if (preferred) props.set(key, preferred.text.trim());
        } else {
          props.set(key, items.map((li) => li.text.trim()));
        }
      } else {
        props.set(key, child.text.trim());
      }
    }
  }
  return props;
}

function text(props: Map<string, Value>, uri: string, local: string): string | null {
  const v = props.get(`${uri}|${local}`);
  if (v === undefined) return null;
  return typeof v === 'string' ? v : (v[0] ?? null);
}

function number(props: Map<string, Value>, uri: string, local: string): number | null {
  const t = text(props, uri, local);
  if (t === null || t.trim() === '') return null;
  const n = Number(t.trim());
  return Number.isFinite(n) ? n : null;
}

function list(props: Map<string, Value>, uri: string, local: string): readonly string[] {
  const v = props.get(`${uri}|${local}`);
  if (v === undefined) return [];
  return typeof v === 'string' ? [v] : v;
}

function limited(value: string | null): string | null {
  return value === null || value === '' ? null : value.slice(0, MAX_TEXT);
}

function readOurRecipe(props: Map<string, Value>): Recipe | null {
  const paths: Record<string, unknown> = {};
  let found = false;
  for (const [key, value] of props) {
    if (!key.startsWith(`${NS.lopsy}|`) || typeof value !== 'string') continue;
    try {
      paths[key.slice(NS.lopsy.length + 1)] = JSON.parse(value);
      found = true;
    } catch {
      // A value that is not JSON is ignored; recipeFromPaths falls back to the default for it.
    }
  }
  return found ? recipeFromPaths(paths) : null;
}

function readCrop(props: Map<string, Value>): CropRect | null {
  if (text(props, NS.crs, 'HasCrop')?.toLowerCase() !== 'true') return null;
  if ((number(props, NS.crs, 'CropAngle') ?? 0) !== 0) return null;
  const left = number(props, NS.crs, 'CropLeft');
  const top = number(props, NS.crs, 'CropTop');
  const right = number(props, NS.crs, 'CropRight');
  const bottom = number(props, NS.crs, 'CropBottom');
  if (left === null || top === null || right === null || bottom === null) return null;
  if (left < 0 || top < 0 || right > 1 || bottom > 1 || right <= left || bottom <= top) return null;
  if (left === 0 && top === 0 && right === 1 && bottom === 1) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Reads a sidecar; null when it is not well-formed XMP. */
export function readXmp(source: string): XmpData | null {
  if (source.length > MAX_XMP_CHARS) return null;
  const root = parseXml(source);
  if (!root) return null;
  const props = collectProperties(root);

  const rawRating = number(props, NS.xmp, 'Rating');
  let rating: number | null = null;
  let setAside: boolean | null = null;
  if (rawRating !== null) {
    if (rawRating < 0) {
      setAside = true;
      rating = 0;
    } else {
      rating = Math.min(5, Math.round(rawRating));
      setAside = false;
    }
  }
  const labelText = text(props, NS.xmp, 'Label');
  const label = labelText ? (LABELS[labelText.trim().toLowerCase()] ?? null) : null;

  const keywords: string[] = [];
  const seen = new Set<string>();
  const add = (k: string) => {
    const t = k.trim().slice(0, 200);
    if (t === '' || seen.has(t.toLowerCase()) || keywords.length >= MAX_KEYWORDS) return;
    seen.add(t.toLowerCase());
    keywords.push(t);
  };
  list(props, NS.dc, 'subject').forEach(add);
  for (const path of list(props, NS.lr, 'hierarchicalSubject')) add(path.split('|').pop() ?? '');

  const edits: Record<string, number> = {};
  for (const { crs, path } of CRS_MAPPING) {
    const v = number(props, NS.crs, crs);
    if (v !== null) edits[path] = v;
  }
  const orientation = number(props, NS.tiff, 'Orientation');

  return {
    rating,
    setAside,
    label,
    keywords,
    title: limited(text(props, NS.dc, 'title')),
    caption: limited(text(props, NS.dc, 'description')),
    recipe: readOurRecipe(props),
    edits,
    crop: readCrop(props),
    orientation: orientation !== null && Number.isInteger(orientation) && orientation >= 1 && orientation <= 8 ? orientation : null,
  };
}

const QUARTER_TURNS: Readonly<Record<number, number>> = { 1: 0, 6: 90, 3: 180, 8: 270 };

/**
 * The recipe a sidecar asks for on a photo with EXIF `fileOrientation`:
 * ours when present (exact), else the Camera Raw mapping on the default
 * recipe; null when the sidecar has no edits.
 */
export function recipeFromXmp(data: XmpData, fileOrientation: number): Recipe | null {
  if (data.recipe) return data.recipe;
  const paths: Record<string, RecipeLeaf> = { ...recipeToPaths(DEFAULT_RECIPE), ...data.edits };
  let changed = Object.keys(data.edits).length > 0;
  const from = QUARTER_TURNS[fileOrientation];
  const to = data.orientation === null ? undefined : QUARTER_TURNS[data.orientation];
  const plain = from !== undefined && to !== undefined;
  if (plain && to !== from) {
    paths['framing.rotate'] = (((to ?? 0) - (from ?? 0)) % 360 + 360) % 360;
    changed = true;
  }
  // Camera Raw crops are relative to the unrotated image; ours to the oriented one, so only the trivial case maps.
  if (data.crop && fileOrientation === 1 && (data.orientation ?? 1) === 1) {
    paths['framing.crop'] = data.crop;
    changed = true;
  }
  return changed ? recipeFromPaths(paths) : null;
}
