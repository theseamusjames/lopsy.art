/**
 * Edit in Lopsy (spec 5.6): opens Lopsy with a photo or a document from the
 * library and stores what Lopsy saves back.
 *
 * - An original goes as its developed render, a 16-bit PNG, with the source
 *   block (library, asset, version, recipe hash).
 * - A document goes as its `.lopsy`, with the file's current revision as
 *   `baseRevision` and its asset id in the source, so saves update it in place.
 */

import { sendToLopsy, type LopsyHandoff, type ReceivedSave } from '@lopsy/handoff/photos';
import type { CameraSummary, HandoffDocument, HandoffSource } from '@lopsy/handoff/messages';
import type { HandoffWindow } from '@lopsy/handoff/channel';
import type { PreviewRenderer } from '@lopsy/photos-core/import/types';
import type { Asset, AssetId, LibrarySession, VersionId } from '@lopsy/photos-core/library/types';
import { recipeHash } from '@lopsy/photos-core/library/recipe';
import { storeLopsySave, type StoredLopsySave } from './store-lopsy-save';

export interface EditInLopsyOptions {
  readonly session: LibrarySession;
  readonly assetId: AssetId;
  /** The version to develop; the asset's primary version when absent. Ignored for documents. */
  readonly versionId?: VersionId;
  /** Renders the version at full resolution as a 16-bit PNG (the export path). Not called for documents. */
  readonly renderPng16: () => Promise<ArrayBuffer>;
  /** `VITE_LOPSY_URL` (see `lopsyUrl()`). */
  readonly lopsyUrl: string;
  /** Renders the previews of documents Lopsy saves. */
  readonly previewRenderer: PreviewRenderer;
  /** Called after each save from Lopsy is stored. */
  readonly onSaved?: (stored: StoredLopsySave, save: ReceivedSave) => void;
  readonly window?: HandoffWindow;
}

/** The name Lopsy shows: the title, else the file name without its extension. */
export function displayName(asset: Asset): string {
  const title = asset.title.trim();
  if (title) return title;
  return asset.fileName.replace(/\.[^.]+$/, '') || 'Untitled';
}

/** The asset's camera metadata summary for Lopsy (spec 6.12), or undefined when it has none. */
export function cameraSummary(asset: Asset): CameraSummary | undefined {
  const summary: { -readonly [K in keyof CameraSummary]: CameraSummary[K] } = {};
  if (asset.camera?.make) summary.make = asset.camera.make;
  if (asset.camera?.model) summary.model = asset.camera.model;
  if (asset.lens) summary.lens = asset.lens;
  if (asset.exposure?.iso != null) summary.iso = asset.exposure.iso;
  if (asset.exposure?.shutter) summary.shutter = asset.exposure.shutter;
  if (asset.exposure?.aperture != null) summary.aperture = asset.exposure.aperture;
  if (asset.exposure?.focalLength != null) summary.focalLength = asset.exposure.focalLength;
  if (asset.capturedAt) summary.capturedAt = asset.capturedAt;
  return Object.keys(summary).length > 0 ? summary : undefined;
}

/** How many times to re-read a document that changes while it is read. */
export const STABLE_READ_ATTEMPTS = 4;

/**
 * A document's bytes and the revision they are. The revision is read before
 * and after the content, and the read is repeated until they agree, so the
 * `baseRevision` sent with the bytes is never newer than the bytes: a later
 * save from Lopsy then fails the revision check instead of overwriting
 * another device's save.
 */
export async function readStableDocument(session: LibrarySession, asset: Asset): Promise<{ bytes: ArrayBuffer; revision: string }> {
  for (let attempt = 0; attempt < STABLE_READ_ATTEMPTS; attempt++) {
    const before = await session.adapter.getFile(asset.fileId);
    if (!before || before.trashed) throw new Error(`${asset.fileName} is missing from storage.`);
    const content = await session.adapter.readContent(asset.fileId);
    const after = await session.adapter.getFile(asset.fileId);
    if (after && after.revision === before.revision) {
      return { bytes: await content.arrayBuffer(), revision: before.revision };
    }
  }
  throw new Error(`${asset.fileName} kept changing while it was read. Try again in a moment.`);
}

async function documentFor(options: EditInLopsyOptions, asset: Asset): Promise<HandoffDocument> {
  const { session } = options;
  const name = displayName(asset);
  const camera = cameraSummary(asset);
  const withCamera = camera ? { camera } : {};
  if (asset.kind === 'document') {
    const { bytes, revision } = await readStableDocument(session, asset);
    const source: HandoffSource = asset.source
      ? { libraryId: session.libraryId, ...asset.source, documentId: asset.id }
      : { libraryId: session.libraryId, assetId: '', versionId: '', recipeHash: '', documentId: asset.id };
    return { name, kind: 'lopsy', bytes, source, baseRevision: revision, ...withCamera };
  }
  const versionId = options.versionId ?? asset.primaryVersionId;
  const version = session.getView().versions.get(versionId);
  if (!version || version.assetId !== asset.id) throw new Error('That version is not part of this photo.');
  const bytes = await options.renderPng16();
  const source: HandoffSource = {
    libraryId: session.libraryId,
    assetId: asset.id,
    versionId,
    recipeHash: recipeHash(version.recipe),
  };
  return { name, kind: 'png16', bytes, source, ...withCamera };
}

/**
 * Opens Lopsy with the asset. Call it from a click: Lopsy's tab opens before
 * this returns, and the photo is rendered (or the `.lopsy` read) while it loads.
 * Throws at once for an unknown or deleted asset.
 */
export function editInLopsy(options: EditInLopsyOptions): LopsyHandoff {
  const asset = options.session.getView().assets.get(options.assetId);
  if (!asset || asset.deleted) throw new Error('That photo is not in the library.');
  return sendToLopsy({
    lopsyUrl: options.lopsyUrl,
    document: documentFor(options, asset),
    onSave: async (save) => {
      const stored = await storeLopsySave(options.session, save, { previewRenderer: options.previewRenderer });
      options.onSaved?.(stored, save);
      return { revision: stored.revision, documentId: stored.documentId };
    },
    ...(options.window ? { window: options.window } : {}),
  });
}

/** Lopsy's URL for handoffs: `VITE_LOPSY_URL`, else the Lopsy dev server in development and this origin's root in production. */
export function lopsyUrlFor(configured: string | undefined, isDev: boolean): string {
  const trimmed = configured?.trim();
  if (trimmed) return trimmed;
  return isDev ? 'http://localhost:5173/' : '/';
}

export function lopsyUrl(): string {
  return lopsyUrlFor(import.meta.env.VITE_LOPSY_URL, import.meta.env.DEV);
}
