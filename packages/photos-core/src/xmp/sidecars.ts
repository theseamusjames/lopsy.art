/**
 * Sidecars next to imported photos: which `.xmp` belongs to which image,
 * and applying one to the asset it describes.
 */

import type { AssetId, AssetMarks, LibrarySession, VersionId } from '../library/types';
import { readXmp, recipeFromXmp } from './read';
import type { XmpData } from './read';

export function isSidecarName(name: string): boolean {
  return /\.xmp$/i.test(name);
}

const RAW_EXTENSIONS = /\.(raf|dng|nef|cr2|cr3|arw|orf|rw2|pef)$/i;

export interface SidecarMatch {
  /** Image index to the index of its sidecar. */
  readonly sidecarFor: ReadonlyMap<number, number>;
  /** Sidecar index to the index of the image it belongs to, or null when none. */
  readonly imageFor: ReadonlyMap<number, number | null>;
}

/**
 * Pairs `<name>.<ext>.xmp` with `<name>.<ext>` exactly, and `<name>.xmp`
 * with the image of that base name (a RAW first, as editors write the
 * sidecar for the RAW of a RAW+JPEG pair). Names compare without case.
 */
export function matchSidecars(names: readonly string[]): SidecarMatch {
  const byFullName = new Map<string, number>();
  const byBase = new Map<string, number[]>();
  names.forEach((name, index) => {
    if (isSidecarName(name)) return;
    const lower = name.toLowerCase();
    byFullName.set(lower, index);
    const dot = lower.lastIndexOf('.');
    const base = dot > 0 ? lower.slice(0, dot) : lower;
    const list = byBase.get(base) ?? [];
    list.push(index);
    byBase.set(base, list);
  });
  const sidecarFor = new Map<number, number>();
  const imageFor = new Map<number, number | null>();
  const claim = (sidecar: number, image: number | undefined): boolean => {
    if (image === undefined || sidecarFor.has(image)) return false;
    sidecarFor.set(image, sidecar);
    imageFor.set(sidecar, image);
    return true;
  };
  // Exact `<name>.<ext>.xmp` first, so they win over a plain `<name>.xmp`.
  const plain: number[] = [];
  names.forEach((name, index) => {
    if (!isSidecarName(name)) return;
    imageFor.set(index, null);
    const stem = name.slice(0, -4).toLowerCase();
    if (!claim(index, byFullName.get(stem))) plain.push(index);
  });
  for (const index of plain) {
    const stem = (names[index] ?? '').slice(0, -4).toLowerCase();
    const candidates = [...(byBase.get(stem) ?? [])].sort(
      (a, b) => Number(!RAW_EXTENSIONS.test(names[a] ?? '')) - Number(!RAW_EXTENSIONS.test(names[b] ?? '')),
    );
    for (const image of candidates) if (claim(index, image)) break;
  }
  return { sidecarFor, imageFor };
}

/** What applying a sidecar changed, for the import report. */
export interface SidecarApplied {
  readonly marks: boolean;
  readonly keywords: number;
  readonly recipe: boolean;
}

/** Applies a read sidecar to a newly added asset and its primary version. */
export function applyXmp(
  session: Pick<LibrarySession, 'setMarks' | 'setKeyword' | 'setRecipe'>,
  assetId: AssetId,
  versionId: VersionId,
  data: XmpData,
  fileOrientation: number,
): SidecarApplied {
  const marks: { -readonly [K in keyof AssetMarks]?: AssetMarks[K] } = {};
  if (data.rating !== null) marks.rating = Math.max(0, Math.min(5, data.rating)) as AssetMarks['rating'];
  if (data.setAside !== null) marks.setAside = data.setAside;
  if (data.label !== null) marks.label = data.label;
  if (data.title !== null) marks.title = data.title;
  if (data.caption !== null) marks.caption = data.caption;
  const hasMarks = Object.keys(marks).length > 0;
  if (hasMarks) session.setMarks([assetId], marks);
  for (const keyword of data.keywords) session.setKeyword([assetId], keyword, true);
  const recipe = recipeFromXmp(data, fileOrientation);
  if (recipe) session.setRecipe(versionId, recipe, 'XMP sidecar');
  return { marks: hasMarks, keywords: data.keywords.length, recipe: recipe !== null };
}

/** Reads and applies a sidecar file; null when it is not readable XMP. */
export async function applySidecarFile(
  session: Pick<LibrarySession, 'setMarks' | 'setKeyword' | 'setRecipe'>,
  assetId: AssetId,
  versionId: VersionId,
  sidecar: Blob,
  fileOrientation: number,
): Promise<SidecarApplied | null> {
  const data = readXmp(await sidecar.text());
  return data ? applyXmp(session, assetId, versionId, data, fileOrientation) : null;
}
