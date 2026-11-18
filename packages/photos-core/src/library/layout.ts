/**
 * Finds or creates a library's folders (spec 6.5, Layout and Tags). Every
 * folder and file made here carries `lp.lib` and `lp.role`, and existing
 * ones are found by role, so a rerun after a partial creation fills the
 * gaps instead of making duplicates.
 */

import type { FileId, StorageAdapter, StoredFile } from '../storage/types';
import { DecodeError } from './gzip';
import { newId } from './ids';
import type { LibraryLayout } from './types';
import { isRecord } from './validate';

export const LIBRARY_SCHEMA_VERSION = 1;

export const ROLES = {
  library: 'library',
  originals: 'originals',
  documents: 'documents',
  exports: 'exports',
  data: 'data',
  journal: 'journal',
  snapshots: 'snapshots',
  previews: 'previews',
  devices: 'devices',
  manifest: 'library-json',
  settings: 'settings',
  readme: 'readme',
  deviceJournal: 'device-journal',
  segment: 'segment',
  snapshot: 'snapshot',
  device: 'device',
} as const;

export const FOLDER_NAMES = {
  library: 'Lopsy Photos',
  originals: 'Originals',
  documents: 'Lopsy documents',
  exports: 'Exports',
  data: 'Library data',
  journal: 'journal',
  snapshots: 'snapshots',
  previews: 'previews',
  devices: 'devices',
} as const;

export const README_TEXT = `Lopsy Photos library

This folder holds a photo library made by Lopsy Photos.

- Originals/ holds your photos exactly as they were imported. Lopsy Photos
  never changes or deletes them.
- Lopsy documents/ holds photos opened in Lopsy, as .lopsy files.
- Exports/ holds the files you exported.
- Library data/ is the library's database: edits, ratings, albums and
  previews. Do not edit, move or delete anything in it.

Files you add to this folder outside Lopsy Photos (through Google Drive's
website or its desktop app) are not seen by the app. To add them, use
"Add from Google Drive" in Lopsy Photos.
`;

export interface LibraryManifest {
  readonly libraryId: string;
  readonly schemaVersion: number;
  readonly createdAt: string;
  readonly folders: {
    readonly originals: FileId;
    readonly documents: FileId;
    readonly exports: FileId;
    readonly data: FileId;
    readonly journal: FileId;
    readonly snapshots: FileId;
    readonly previews: FileId;
    readonly devices: FileId;
  };
}

export interface EnsureLibraryOptions {
  readonly now?: () => number;
  /**
   * Use this library when its root exists, even if it is not the lowest
   * ID: a device keeps writing where its saved state is, and reads the
   * other roots' journals, so duplicate roots lose nothing.
   */
  readonly preferLibraryId?: string;
}

export interface EnsuredLibrary {
  readonly layout: LibraryLayout;
  /** `library.json` as found or written. */
  readonly manifest: LibraryManifest;
  /** True when this call created the library's top folder. */
  readonly created: boolean;
  /**
   * Journal folders of other library roots of this account: two devices
   * that set up at the same moment each make one. Everyone writes to the
   * chosen root (lowest ID) and reads these too, so nothing written to the
   * other is lost; ops merge in any order, so merging the journals is valid.
   */
  readonly otherJournals: readonly { readonly libraryId: string; readonly journalId: FileId }[];
}

async function childByRole(adapter: StorageAdapter, parentId: FileId, role: string): Promise<StoredFile | undefined> {
  return pick((await adapter.listChildren(parentId)).filter((c) => c.isFolder && c.properties['lp.role'] === role));
}

/** Finds, without creating anything, the journal folders of the roots that were not chosen. */
async function otherJournalsOf(
  adapter: StorageAdapter,
  roots: readonly StoredFile[],
  chosen: FileId,
): Promise<{ libraryId: string; journalId: FileId }[]> {
  const out: { libraryId: string; journalId: FileId }[] = [];
  for (const root of roots) {
    const libraryId = root.properties['lp.lib'];
    if (root.id === chosen || !libraryId) continue;
    const data = await childByRole(adapter, root.id, ROLES.data);
    const journal = data ? await childByRole(adapter, data.id, ROLES.journal) : undefined;
    if (journal) out.push({ libraryId, journalId: journal.id });
  }
  return out;
}

function tags(libraryId: string, role: string): Record<string, string> {
  return { 'lp.lib': libraryId, 'lp.role': role };
}

/** When duplicates exist the lowest ID wins, so every device picks the same one. */
function pick(candidates: readonly StoredFile[]): StoredFile | undefined {
  return [...candidates].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
}

async function ensureFolder(
  adapter: StorageAdapter,
  parentId: FileId,
  name: string,
  libraryId: string,
  role: string,
): Promise<FileId> {
  const children = await adapter.listChildren(parentId);
  const byRole = pick(children.filter((c) => c.isFolder && c.properties['lp.role'] === role));
  if (byRole) return byRole.id;
  // A folder of the right name the app made earlier but failed to tag is adopted, not duplicated.
  const byName = pick(children.filter((c) => c.isFolder && c.name === name && c.properties['lp.role'] === undefined));
  if (byName) {
    await adapter.updateProperties(byName.id, tags(libraryId, role));
    return byName.id;
  }
  return (await adapter.createFolder(parentId, name, tags(libraryId, role))).id;
}

export function parseManifest(value: unknown): LibraryManifest | null {
  if (!isRecord(value)) return null;
  const { libraryId, schemaVersion, createdAt, folders } = value;
  if (typeof libraryId !== 'string' || libraryId === '') return null;
  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion)) return null;
  if (typeof createdAt !== 'string' || !isRecord(folders)) return null;
  const keys = ['originals', 'documents', 'exports', 'data', 'journal', 'snapshots', 'previews', 'devices'] as const;
  if (!keys.every((k) => typeof folders[k] === 'string')) return null;
  return {
    libraryId,
    schemaVersion,
    createdAt,
    folders: Object.fromEntries(keys.map((k) => [k, folders[k] as string])) as LibraryManifest['folders'],
  };
}

async function readManifest(adapter: StorageAdapter, file: StoredFile): Promise<LibraryManifest | null> {
  try {
    const text = await (await adapter.readContent(file.id)).text();
    return parseManifest(JSON.parse(text));
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof DecodeError) return null;
    throw error;
  }
}

function jsonBlob(value: unknown): Blob {
  return new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' });
}

/** Finds the user's library, or creates it, and returns its folder IDs. */
export async function ensureLibrary(adapter: StorageAdapter, options: EnsureLibraryOptions = {}): Promise<EnsuredLibrary> {
  const now = options.now ?? Date.now;
  let created = false;
  const roots = (await adapter.findByProperty('lp.role', ROLES.library)).filter((f) => f.isFolder);
  let root = roots.find((r) => options.preferLibraryId !== undefined && r.properties['lp.lib'] === options.preferLibraryId) ?? pick(roots);
  if (!root) {
    const top = await adapter.getRoot();
    root = await adapter.createFolder(top.id, FOLDER_NAMES.library, tags(newId(now()), ROLES.library));
    created = true;
  }
  let libraryId = root.properties['lp.lib'];
  if (!libraryId) {
    libraryId = newId(now());
    root = await adapter.updateProperties(root.id, { 'lp.lib': libraryId });
  }

  const originalsId = await ensureFolder(adapter, root.id, FOLDER_NAMES.originals, libraryId, ROLES.originals);
  const documentsId = await ensureFolder(adapter, root.id, FOLDER_NAMES.documents, libraryId, ROLES.documents);
  const exportsId = await ensureFolder(adapter, root.id, FOLDER_NAMES.exports, libraryId, ROLES.exports);
  const dataId = await ensureFolder(adapter, root.id, FOLDER_NAMES.data, libraryId, ROLES.data);
  const journalId = await ensureFolder(adapter, dataId, FOLDER_NAMES.journal, libraryId, ROLES.journal);
  const snapshotsId = await ensureFolder(adapter, dataId, FOLDER_NAMES.snapshots, libraryId, ROLES.snapshots);
  const previewsId = await ensureFolder(adapter, dataId, FOLDER_NAMES.previews, libraryId, ROLES.previews);
  const devicesId = await ensureFolder(adapter, dataId, FOLDER_NAMES.devices, libraryId, ROLES.devices);

  const rootChildren = await adapter.listChildren(root.id);
  if (!rootChildren.some((c) => !c.isFolder && c.properties['lp.role'] === ROLES.readme)) {
    await adapter.createFile(
      { parentId: root.id, name: 'README.txt', mimeType: 'text/plain', properties: tags(libraryId, ROLES.readme) },
      new Blob([README_TEXT], { type: 'text/plain' }),
    );
  }

  const folders = {
    originals: originalsId,
    documents: documentsId,
    exports: exportsId,
    data: dataId,
    journal: journalId,
    snapshots: snapshotsId,
    previews: previewsId,
    devices: devicesId,
  };
  const manifestFile = pick(
    (await adapter.listChildren(dataId)).filter((c) => !c.isFolder && c.properties['lp.role'] === ROLES.manifest),
  );
  const existing = manifestFile ? await readManifest(adapter, manifestFile) : null;
  const manifest: LibraryManifest = {
    libraryId,
    schemaVersion: existing?.schemaVersion ?? LIBRARY_SCHEMA_VERSION,
    createdAt: existing?.createdAt ?? new Date(now()).toISOString(),
    folders,
  };
  const stale =
    !existing ||
    existing.libraryId !== libraryId ||
    Object.entries(folders).some(([k, id]) => existing.folders[k as keyof typeof folders] !== id);
  if (!manifestFile) {
    await adapter.createFile(
      { parentId: dataId, name: 'library.json', mimeType: 'application/json', properties: tags(libraryId, ROLES.manifest) },
      jsonBlob(manifest),
    );
  } else if (stale) {
    await adapter.updateContent(manifestFile.id, jsonBlob(manifest));
  }

  return {
    created,
    manifest,
    otherJournals: await otherJournalsOf(adapter, roots, root.id),
    layout: {
      libraryId,
      rootId: root.id,
      originalsId,
      documentsId,
      exportsId,
      dataId,
      journalId,
      snapshotsId,
      previewsId,
      devicesId,
    },
  };
}
