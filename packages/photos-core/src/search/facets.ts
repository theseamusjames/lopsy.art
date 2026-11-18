/** Facet counts for the filter bar (spec 5.2): camera, lens, rating, label, file type, edited. */

import type { Asset, ImageFormat, LibraryView, Rating } from '../library/types';
import { cameraName, isEdited } from './asset-fields';
import type { LabelChoice } from './rules';

export interface FacetCount<T> {
  readonly value: T;
  readonly count: number;
}

export interface Facets {
  /** By count, most first; unknown cameras and lenses are left out. */
  readonly camera: readonly FacetCount<string>[];
  readonly lens: readonly FacetCount<string>[];
  /** 0 to 5, every value present. */
  readonly rating: readonly FacetCount<Rating>[];
  /** The five colours then 'none', every value present. */
  readonly label: readonly FacetCount<LabelChoice>[];
  readonly format: readonly FacetCount<ImageFormat>[];
  readonly edited: { readonly edited: number; readonly unedited: number };
  readonly total: number;
}

function sorted<T extends string>(counts: Map<T, number>): FacetCount<T>[] {
  return [...counts]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
}

function bump<T>(map: Map<T, number>, key: T): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

/** Counts over `assets`, typically the set the other filters leave. */
export function computeFacets(assets: Iterable<Asset>, view: LibraryView): Facets {
  const camera = new Map<string, number>();
  const lens = new Map<string, number>();
  const format = new Map<ImageFormat, number>();
  const ratings = [0, 0, 0, 0, 0, 0];
  const labels = new Map<LabelChoice, number>([
    ['red', 0],
    ['yellow', 0],
    ['green', 0],
    ['blue', 0],
    ['purple', 0],
    ['none', 0],
  ]);
  let edited = 0;
  let total = 0;
  for (const asset of assets) {
    total++;
    const cam = cameraName(asset);
    if (cam !== '') bump(camera, cam);
    if (asset.lens) bump(lens, asset.lens);
    bump(format, asset.format);
    ratings[asset.rating] = (ratings[asset.rating] ?? 0) + 1;
    bump(labels, asset.label ?? 'none');
    if (isEdited(asset, view)) edited++;
  }
  return {
    camera: sorted(camera),
    lens: sorted(lens),
    rating: ratings.map((count, value) => ({ value: value as Rating, count })),
    label: [...labels].map(([value, count]) => ({ value, count })),
    format: sorted(format),
    edited: { edited, unedited: total - edited },
    total,
  };
}
