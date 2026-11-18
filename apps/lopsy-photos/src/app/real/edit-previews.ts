/**
 * Stores the Edit view's rendered previews: uploads both JPEGs into the
 * library's Previews folder, points the version at them, warms the device
 * cache and deletes the files they replace (app-owned, so for good).
 */

import type { LibrarySession, PreviewRef, VersionId } from '@lopsy/photos-core/library/types';
import type { PreviewCache } from '@lopsy/photos-core/cache/preview-cache';
import { PREVIEW_SIZES } from '@lopsy/photos-core/import/importer';
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

export async function storeEditPreviews(
  session: LibrarySession,
  versionId: VersionId,
  previews: EditPreviews,
  cache: PreviewCache | null,
): Promise<void> {
  const version = session.getView().versions.get(versionId);
  if (!version) return;
  if (version.thumb?.recipeHash === previews.recipeHash && version.screen?.recipeHash === previews.recipeHash) return;
  const old = [version.thumb?.fileId, version.screen?.fileId].filter((id): id is string => typeof id === 'string');
  const refs: Partial<Record<'thumb' | 'screen', PreviewRef>> = {};
  for (const size of ['thumb', 'screen'] as const) {
    const blob = previews[size];
    const { width, height } = await sizeOf(blob);
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
    refs[size] = { fileId: stored.id, recipeHash: previews.recipeHash, width, height };
  }
  if (refs.thumb) session.setPreview(versionId, 'thumb', refs.thumb);
  if (refs.screen) session.setPreview(versionId, 'screen', refs.screen);
  // The replaced files belong to the app; another device may still show them until it syncs, which then reads the new ones.
  await Promise.allSettled(old.map((id) => session.adapter.deletePermanently(id)));
}
