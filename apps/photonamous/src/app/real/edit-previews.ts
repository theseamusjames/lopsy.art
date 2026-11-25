/**
 * Stores the Edit view's rendered previews: uploads both JPEGs into the
 * library's Previews folder, points the version at them, warms the device
 * cache and deletes the files they replace (app-owned, so for good).
 */

import type { LibrarySession, PreviewRef, VersionId } from '@lopsy/photos-core/library/types';
import type { PreviewCache } from '@lopsy/photos-core/cache/preview-cache';
import { PREVIEW_SIZES } from '@lopsy/photos-core/import/importer';
import { isPreviewCurrent } from '@lopsy/photos-core/library/pipeline';
import { PIPELINE_VERSION } from '@lopsy/photos-core/library/recipe';
import type { EditPreviews } from '../backend';

/** The preview file's name: one per version, size and edit. */
export function editPreviewName(assetId: string, versionId: string, size: 'thumb' | 'screen', recipeHash: string): string {
  return `${assetId}.${versionId}.${PREVIEW_SIZES[size]}.${recipeHash}.jpg`;
}

async function sizeOf(blob: Blob): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(blob);
  try {
    return { width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

export type MeasureImage = (blob: Blob) => Promise<{ width: number; height: number }>;

export async function storeEditPreviews(
  session: LibrarySession,
  versionId: VersionId,
  previews: EditPreviews,
  cache: PreviewCache | null,
  measure: MeasureImage = sizeOf,
): Promise<void> {
  const version = session.getView().versions.get(versionId);
  if (!version) return;
  if (isPreviewCurrent(version.thumb, version, previews.recipeHash) && isPreviewCurrent(version.screen, version, previews.recipeHash)) return;
  const oldThumb = version.thumb?.fileId ?? null;
  const oldScreen = version.screen?.fileId ?? null;
  const refs: Partial<Record<'thumb' | 'screen', PreviewRef>> = {};
  for (const size of ['thumb', 'screen'] as const) {
    const blob = previews[size];
    const { width, height } = await measure(blob);
    const stored = await session.adapter.createFile(
      {
        parentId: session.layout.previewsId,
        name: editPreviewName(version.assetId, versionId, size, previews.recipeHash),
        mimeType: 'image/jpeg',
        properties: { 'lp.lib': session.libraryId, 'lp.role': 'preview', 'lp.asset': version.assetId },
      },
      blob,
    );
    await cache?.put(stored.id, blob).catch(() => undefined);
    // Rendered here, so by this build's pipeline.
    refs[size] = { fileId: stored.id, recipeHash: previews.recipeHash, pipeline: PIPELINE_VERSION, width, height };
  }
  let recordError: unknown = null;
  try {
    if (refs.thumb) session.setPreview(versionId, 'thumb', refs.thumb);
    if (refs.screen) session.setPreview(versionId, 'screen', refs.screen);
  } catch (error) {
    recordError = error;
  }
  // Delete per size only what nothing points at any more: the old file when
  // the version now shows the new one; else the new file (the session kept
  // the old preview, e.g. for an edit that moved on meanwhile).
  const after = session.getView().versions.get(versionId);
  const unused: string[] = [];
  for (const size of ['thumb', 'screen'] as const) {
    const ref = refs[size];
    if (!ref) continue;
    const before = size === 'thumb' ? oldThumb : oldScreen;
    if (after?.[size]?.fileId === ref.fileId) {
      if (before && before !== ref.fileId) unused.push(before);
    } else {
      unused.push(ref.fileId);
    }
  }
  // A preview file can be shared: versions with the same recipe reuse one render (preview-refresh.ts).
  const stillShown = new Set<string>();
  for (const other of session.getView().versions.values()) {
    if (other.thumb) stillShown.add(other.thumb.fileId);
    if (other.screen) stillShown.add(other.screen.fileId);
  }
  await Promise.allSettled(unused.filter((id) => !stillShown.has(id)).map((id) => session.adapter.deletePermanently(id)));
  if (recordError !== null) throw recordError;
}
