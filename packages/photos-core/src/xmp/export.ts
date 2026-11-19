/**
 * Sidecars for people moving to other software: one `.xmp` per photo,
 * named `<base name>.xmp` as Camera Raw and Capture One expect, or
 * `<file name>.xmp` when two photos share a base name (a RAW+JPEG pair).
 */

import { uniqueName } from '../import/folders';
import type { AssetId, LibrarySession } from '../library/types';
import type { FileId } from '../storage/types';
import { writeXmp } from './write';

export type SidecarDestination =
  | { readonly kind: 'folder'; readonly folderId: FileId }
  | { readonly kind: 'download' };

export interface SidecarExportResult {
  /** Every sidecar written, by name (for download, the content to save). */
  readonly files: readonly { readonly assetId: AssetId; readonly name: string; readonly blob: Blob; readonly fileId: FileId | null }[];
  readonly errors: readonly { readonly assetId: AssetId; readonly error: string }[];
}

function stem(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

export async function exportSidecars(
  session: Pick<LibrarySession, 'getView' | 'adapter' | 'libraryId'>,
  assetIds: readonly AssetId[],
  destination: SidecarDestination,
): Promise<SidecarExportResult> {
  const view = session.getView();
  const files: { assetId: AssetId; name: string; blob: Blob; fileId: FileId | null }[] = [];
  const errors: { assetId: AssetId; error: string }[] = [];
  const assets = assetIds.map((id) => view.assets.get(id));
  const baseCount = new Map<string, number>();
  for (const a of assets) if (a) baseCount.set(stem(a.fileName).toLowerCase(), (baseCount.get(stem(a.fileName).toLowerCase()) ?? 0) + 1);

  const taken = new Set<string>();
  if (destination.kind === 'folder') {
    for (const child of await session.adapter.listChildren(destination.folderId)) taken.add(child.name);
  }
  for (const [i, id] of assetIds.entries()) {
    const asset = assets[i];
    if (!asset || asset.deleted) {
      errors.push({ assetId: id, error: 'Photo not in the library' });
      continue;
    }
    const shared = (baseCount.get(stem(asset.fileName).toLowerCase()) ?? 0) > 1;
    const name = uniqueName(taken, `${shared ? asset.fileName : stem(asset.fileName)}.xmp`);
    taken.add(name);
    const blob = new Blob([writeXmp(asset, view.versions.get(asset.primaryVersionId) ?? null)], { type: 'application/rdf+xml' });
    if (destination.kind === 'download') {
      files.push({ assetId: id, name, blob, fileId: null });
      continue;
    }
    try {
      const stored = await session.adapter.createFile(
        {
          parentId: destination.folderId,
          name,
          mimeType: 'application/rdf+xml',
          properties: { 'lp.lib': session.libraryId, 'lp.role': 'sidecar', 'lp.asset': id },
        },
        blob,
      );
      files.push({ assetId: id, name, blob, fileId: stored.id });
    } catch (error) {
      errors.push({ assetId: id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { files, errors };
}
