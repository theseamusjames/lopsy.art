/**
 * Sidecars next to imported photos: which `.xmp` belongs to which image,
 * and applying one to the asset it describes.
 */

import { isDefaultRecipe } from '../library/recipe';
import { isNewerPipeline } from '../library/pipeline';
import type { Asset, AssetId, AssetMarks, LibrarySession, LibraryView, VersionId } from '../library/types';
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
  session: Pick<LibrarySession, 'setMarks' | 'setKeyword' | 'setRecipe' | 'withoutLibraryHistory'>,
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
  // What a sidecar brings in is not the user's command: it stays out of library undo.
  session.withoutLibraryHistory(() => {
    if (hasMarks) session.setMarks([assetId], marks);
    for (const keyword of data.keywords) session.setKeyword([assetId], keyword, true);
  });
  const read = recipeFromXmp(data, fileOrientation);
  // Edits written by a newer pipeline are not taken: this build would keep only the settings it knows, under that pipeline.
  const recipe = read && !isNewerPipeline(read) ? read : null;
  if (recipe) session.setRecipe(versionId, recipe, 'XMP sidecar');
  return { marks: hasMarks, keywords: data.keywords.length, recipe: recipe !== null };
}

export const SIDECAR_NOT_APPLIED_DUPLICATE = 'Sidecar not applied: photo already in the library';
export const SIDECAR_APPLIED_DUPLICATE = 'Photo already in the library; its XMP sidecar was applied to it';

/** Whether nobody has marked or edited the asset yet, so a sidecar cannot overwrite someone's work. */
export function isUntouched(asset: Asset, view: LibraryView): boolean {
  const version = view.versions.get(asset.primaryVersionId);
  return (
    asset.rating === 0 &&
    asset.label === null &&
    !asset.setAside &&
    asset.keywords.length === 0 &&
    asset.title === '' &&
    asset.caption === '' &&
    (!version || isDefaultRecipe(version.recipe))
  );
}

/**
 * Applies a sidecar that came with a duplicate photo to the asset already
 * in the library, only when that asset is untouched. Returns the note for
 * the import item.
 */
export async function applySidecarToExisting(
  session: Pick<LibrarySession, 'getView' | 'setMarks' | 'setKeyword' | 'setRecipe' | 'withoutLibraryHistory'>,
  assetId: AssetId,
  sidecar: Blob,
): Promise<string> {
  const asset = session.getView().assets.get(assetId);
  if (!asset || !isUntouched(asset, session.getView())) return SIDECAR_NOT_APPLIED_DUPLICATE;
  const applied = await applySidecarFile(session, assetId, asset.primaryVersionId, sidecar, asset.orientation).catch(() => null);
  return applied ? SIDECAR_APPLIED_DUPLICATE : 'Photo already in the library; its XMP sidecar could not be read';
}

/** Reads and applies a sidecar file; null when it is not readable XMP. */
export async function applySidecarFile(
  session: Pick<LibrarySession, 'setMarks' | 'setKeyword' | 'setRecipe' | 'withoutLibraryHistory'>,
  assetId: AssetId,
  versionId: VersionId,
  sidecar: Blob,
  fileOrientation: number,
): Promise<SidecarApplied | null> {
  const data = readXmp(await sidecar.text());
  return data ? applyXmp(session, assetId, versionId, data, fileOrientation) : null;
}
