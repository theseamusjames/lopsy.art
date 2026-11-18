/**
 * Stores a save that came back from Lopsy (spec 5.6, 6.6, 6.12): the
 * `.lopsy` and its flattened 16-bit PNG go into `Lopsy documents/`, and the
 * library gains a document asset, or the document the save came from is
 * updated in place.
 *
 * - A save whose source names a document of this library updates that
 *   document's two files, provided the `.lopsy` is still at the revision
 *   Lopsy started from. If it moved on (another device saved meanwhile),
 *   the save becomes a copy, "<name> 2", so neither edit is lost.
 * - Any other save becomes a new document, in the source photo's stack
 *   when it has one.
 */

import type { ReceivedSave } from '@lopsy/handoff/photos';
import type { HandoffSource } from '@lopsy/handoff/messages';
import type { PreviewRenderer } from '@lopsy/photos-core/import/types';
import type { Asset, AssetId, LibrarySession, VersionId } from '@lopsy/photos-core/library/types';
import type { FileId, StoredFile } from '@lopsy/photos-core/storage/types';
import { sha256Hex } from '@lopsy/photos-core/import/hash';
import { newId } from '@lopsy/photos-core/library/ids';
import { DEFAULT_RECIPE, recipeHash } from '@lopsy/photos-core/library/recipe';

export const LOPSY_MIME_TYPE = 'application/x-lopsy';
export const PREVIEW_SIZES = { thumb: 512, screen: 2048 } as const;

export interface StoreLopsySaveOptions {
  readonly previewRenderer: PreviewRenderer;
  readonly now?: () => Date;
}

export interface StoredLopsySave {
  /** The `.lopsy` file's revision after the save: Lopsy's next baseRevision. */
  readonly revision: string;
  /** The document asset the save is stored as. */
  readonly documentId: AssetId;
  /** How it was stored. */
  readonly outcome: 'created' | 'updated' | 'copied';
  /** The `.lopsy` file's name in `Lopsy documents/`. */
  readonly fileName: string;
}

/** Width and height from a PNG's IHDR, or null when the bytes are not a PNG. */
export function pngSize(bytes: ArrayBuffer): { width: number; height: number } | null {
  if (bytes.byteLength < 24) return null;
  const view = new DataView(bytes);
  const isPng = view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a;
  const isIhdr = view.getUint32(12) === 0x49484452;
  if (!isPng || !isIhdr) return null;
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** A file name stem safe on Drive and on disk. */
export function documentStem(name: string): string {
  const printable = Array.from(name, (c) => (c.charCodeAt(0) < 0x20 ? ' ' : c)).join('');
  const cleaned = printable
    .replace(/\.lopsy$/i, '')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, 120) || 'Untitled';
}

/** `<stem>`, `<stem> 2`, `<stem> 3`… whichever has no `.lopsy` in `taken` (case-insensitive). */
export function freeStem(taken: Iterable<string>, stem: string): string {
  const names = new Set<string>();
  for (const n of taken) names.add(n.toLowerCase());
  const isFree = (s: string) => !names.has(`${s}.lopsy`.toLowerCase()) && !names.has(`${s}.png`.toLowerCase());
  if (isFree(stem)) return stem;
  for (let i = 2; ; i++) {
    const candidate = `${stem} ${i}`;
    if (isFree(candidate)) return candidate;
  }
}

function tags(session: LibrarySession, role: 'document' | 'render', assetId: AssetId): Record<string, string> {
  return { 'lp.lib': session.libraryId, 'lp.role': role, 'lp.asset': assetId };
}

/** The library document the save names, when it is one of this library's live documents. */
function targetDocument(session: LibrarySession, source: HandoffSource | undefined): Asset | null {
  if (!source?.documentId || source.libraryId !== session.libraryId) return null;
  const asset = session.getView().assets.get(source.documentId);
  if (!asset || asset.deleted || asset.kind !== 'document') return null;
  return asset;
}

/** The source photo, when the save came from one in this library. */
function sourcePhoto(session: LibrarySession, source: HandoffSource | undefined): Asset | null {
  if (!source || source.libraryId !== session.libraryId || !source.assetId) return null;
  const asset = session.getView().assets.get(source.assetId);
  return asset && !asset.deleted ? asset : null;
}

async function renderPreviews(
  session: LibrarySession,
  options: StoreLopsySaveOptions,
  assetId: AssetId,
  versionId: VersionId,
  png: Blob,
): Promise<void> {
  const version = session.getView().versions.get(versionId);
  const hash = recipeHash(version ? version.recipe : DEFAULT_RECIPE);
  const old: FileId[] = [version?.thumb?.fileId, version?.screen?.fileId].filter((id): id is FileId => !!id);
  for (const size of ['screen', 'thumb'] as const) {
    const rendered = await options.previewRenderer.render(png, PREVIEW_SIZES[size], 1);
    const stored = await session.adapter.createFile(
      {
        parentId: session.layout.previewsId,
        name: `${assetId}.${versionId}.${PREVIEW_SIZES[size]}.jpg`,
        mimeType: rendered.blob.type || 'image/jpeg',
        properties: { 'lp.lib': session.libraryId, 'lp.role': 'preview', 'lp.asset': assetId },
      },
      rendered.blob,
    );
    session.setPreview(versionId, size, { fileId: stored.id, recipeHash: hash, width: rendered.width, height: rendered.height });
  }
  // The replaced previews are only caches; a failure to trash them is harmless.
  for (const id of old) await session.adapter.trash(id).catch(() => {});
}

async function createDocument(
  session: LibrarySession,
  save: ReceivedSave,
  options: StoreLopsySaveOptions,
  stem: string,
  source: HandoffSource | undefined,
): Promise<{ assetId: AssetId; lopsyFile: StoredFile }> {
  const now = options.now ?? (() => new Date());
  const assetId = newId(now().getTime());
  const lopsyBlob = new Blob([save.lopsy], { type: LOPSY_MIME_TYPE });
  const renderBlob = new Blob([save.render], { type: 'image/png' });
  const sha256 = await sha256Hex(save.lopsy);
  const lopsyFile = await session.adapter.createFile(
    { parentId: session.layout.documentsId, name: `${stem}.lopsy`, mimeType: LOPSY_MIME_TYPE, properties: { ...tags(session, 'document', assetId), 'lp.sha': sha256 } },
    lopsyBlob,
  );
  const renderFile = await session.adapter.createFile(
    { parentId: session.layout.documentsId, name: `${stem}.png`, mimeType: 'image/png', properties: tags(session, 'render', assetId) },
    renderBlob,
  );
  const photo = sourcePhoto(session, source);
  const size = pngSize(save.render);
  const { versionId } = session.addAsset({
    id: assetId,
    kind: 'document',
    fileId: lopsyFile.id,
    sha256,
    fileName: lopsyFile.name,
    byteSize: save.lopsy.byteLength,
    format: 'lopsy',
    mimeType: LOPSY_MIME_TYPE,
    capturedAt: photo?.capturedAt ?? null,
    importedAt: now().toISOString(),
    // Grouped with the photo it came from, so a "recent imports" view still shows the photo beside it.
    importId: photo?.importId ?? `lopsy-${save.id}`,
    width: size?.width ?? null,
    height: size?.height ?? null,
    orientation: 1,
    camera: photo?.camera ?? null,
    lens: photo?.lens ?? null,
    exposure: photo?.exposure ?? null,
    gps: photo?.gps ?? null,
    pairedWith: null,
    source: photo && source ? { assetId: photo.id, versionId: source.versionId, recipeHash: source.recipeHash } : null,
    renderFileId: renderFile.id,
    marks: { title: save.name },
  });
  await renderPreviews(session, options, assetId, versionId, renderBlob);
  return { assetId, lopsyFile };
}

async function updateDocument(
  session: LibrarySession,
  document: Asset,
  save: ReceivedSave,
  options: StoreLopsySaveOptions,
): Promise<StoredFile> {
  const renderBlob = new Blob([save.render], { type: 'image/png' });
  const lopsyFile = await session.adapter.updateContent(document.fileId, new Blob([save.lopsy], { type: LOPSY_MIME_TYPE }));
  if (document.renderFileId) {
    await session.adapter.updateContent(document.renderFileId, renderBlob);
  }
  await renderPreviews(session, options, document.id, document.primaryVersionId, renderBlob);
  return lopsyFile;
}

/**
 * Stores one save from Lopsy and returns what `photos:saved` reports.
 * Throws when storage fails; the handoff turns that into an error answer.
 */
export async function storeLopsySave(
  session: LibrarySession,
  save: ReceivedSave,
  options: StoreLopsySaveOptions,
): Promise<StoredLopsySave> {
  const document = targetDocument(session, save.source);
  if (document) {
    const current = await session.adapter.getFile(document.fileId);
    const isCurrent = current && !current.trashed && (save.baseRevision === undefined || save.baseRevision === current.revision);
    if (isCurrent) {
      const updated = await updateDocument(session, document, save, options);
      return { revision: updated.revision, documentId: document.id, outcome: 'updated', fileName: updated.name };
    }
  }

  const taken = (await session.adapter.listChildren(session.layout.documentsId)).filter((f) => !f.trashed).map((f) => f.name);
  const stem = freeStem(taken, documentStem(save.name));
  const { assetId, lopsyFile } = await createDocument(session, save, options, stem, save.source);
  return { revision: lopsyFile.revision, documentId: assetId, outcome: document ? 'copied' : 'created', fileName: lopsyFile.name };
}
