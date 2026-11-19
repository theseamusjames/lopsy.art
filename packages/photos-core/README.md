# @lopsy/photos-core

Photonamous without the UI: storage adapters, the synced library
database, import, export, caches, search and XMP. It is plain TypeScript
with no React, and it runs in the browser. Its unit tests run in Node.

This is a maintainer's guide. The design is in
[the spec](../../docs/photonamous-spec.md), and this file links to the spec
instead of repeating it. The app's rules are in
[`apps/photonamous/CLAUDE.md`](../../apps/photonamous/CLAUDE.md).

## Module map

| Directory | What it is |
|---|---|
| `storage/` | `StorageAdapter` (`types.ts`), the only door to files. Adapters: Google Drive (`google-drive/`), a local folder (OPFS or a picked folder) and memory. Shared contract tests are in `adapter-contract.ts`. |
| `auth/` | Where Drive gets its token: the Google Identity Services client, or a fixed token in tests. |
| `library/` | The synced database ([spec 6.6](../../docs/photonamous-spec.md#66-the-library-database)). `session.ts` holds `openLibrary` and `LibrarySession`, which is the only way to change the library. `sync.ts` holds the sync engine. Data model: `types.ts`. Edit recipe: `recipe.ts`. |
| `import/` | The import job ([6.8](../../docs/photonamous-spec.md#68-import-and-upload)): hashing, EXIF/TIFF/RAF inspection, previews, RAW+JPEG pairs, staging, resume, and adding from storage. |
| `export/` | The export job ([6.11](../../docs/photonamous-spec.md#611-export)), export settings and presets, the EXIF writer, file names and zip. Rendering is injected. |
| `cache/` | Originals and previews on the device ([6.7](../../docs/photonamous-spec.md#67-storage-on-the-device)): OPFS blob caches, checked downloads, and Keep originals. |
| `search/` | Saved-search rules, text search, facets, dates and bursts over a `LibraryView`. |
| `xmp/` | Reading and writing XMP sidecars, including the Lightroom `crs:` edit mapping (`crs-mapping.ts`, a commented table). |

## On storage

All of these files are in the user's storage and are reached only through
the adapter. Every folder and file carries the `appProperties`
`lp.lib` (the library ID) and `lp.role`. Some also carry `lp.device`
(journal folders, segments, device files), `lp.asset` (exports) or
`lp.sha` (originals). Files are found by role, never by name.
`layout.ts` creates the layout and repairs a partly created one.

```
Photonamous/                 role library
  README.txt                  readme
  Originals/2026/2026-11-14/… originals; each file has role original and lp.sha
  Lopsy documents/            documents (.lopsy)
  Exports/<folder>/…          exports; each file has role export and lp.asset
  Library data/               data
    library.json              library-json: { libraryId, schemaVersion, createdAt, folders{…} }
    settings.json             settings: a copy of the synced settings; the ops are the source and it is never read back
    journal/<deviceId>/       device-journal, one folder per device
      <first>-<last>.jsonl.gz segment: 12-digit seqs, gzipped JSON lines, one op envelope each
    snapshots/<hlc>-<device>.json.gz   snapshot
    previews/                 previews (thumb 512, screen 2048)
    devices/<deviceId>.json   device: { deviceId, name, appVersion, lastSeenAt }
```

- **Op envelope** (`types.ts` `OpEnvelope`):
  `{ id: "<device>:<seq>", device, seq, hlc, v, step?, op }`.
  - `v` is the op schema version (`OP_SCHEMA_VERSION`, 1). A device that
    reads a newer `v` asks the user to reload.
  - `step` (`{ id, label, undoes?, redoes? }`) groups ops into one
    recipe history step.
- **Op types**: there are only two.
  - `set { kind, id, fields }`: each field is last-writer-wins by HLC, with
    the op ID breaking ties.
  - `member { kind, id, set, member, present }`: last-writer-wins for each
    member.
  - Kinds are `asset`, `version`, `album`, `setting`, `preset` and
    `exportPreset`.
  - Album sets are `assets` (whole photos) and `versions`
    (`"<assetId>/<versionId>"`). Asset keywords are the set `keywords`.
  - Recipe leaves are version fields named `recipe.<path>`.
- **Segments**:
  - Segments are written only by their own device, and never rewritten.
    Only the roll-up (`rollup.ts`) merges a device's own small segments.
  - At most 10,000 ops go in one segment. A decoded segment is capped at
    64 MB and a line at 256 KB.
- **Snapshots** (`snapshot.ts`):
  - Each holds the whole merged state with per-field stamps, plus the
    version vector (device → last seq included).
  - Caps: 256 MB of JSON and 64 MB compressed. Three are kept.
  - A new device loads the newest readable snapshot, then reads the
    journal past its vector.

On the device, IndexedDB (`local-store.ts`) holds the device ID, `nextSeq`,
the outbox, the merged state and the sync bookkeeping. One Web Lock per
library (`lock.ts`) allows one writer per device.

## Invariants and what protects them

- **Seq.** Each device's seqs count up from 1 with no gaps, so an
  envelope ID is unique.
  - The outbox append and `nextSeq` are written in one IndexedDB write
    (`LocalStorePatch`).
  - `committedSeq` is the highest seq whose outbox write has committed.
  - Only committed ops are uploaded.
  - A snapshot waits until everything is committed, so a crash can never
    reissue a seq that storage has already seen.
  - When a write fails, `SyncEngine.salvage` writes the new ops and the
    seq on their own, so a state that keeps failing to save (a full disk)
    never stops ops from committing.
- **Vector and state.** The stored version vector and outbox trimming are
  saved together with the stored state, never ahead of it. Otherwise a
  reload would skip ops that the stored state lacks.
- **Durable before destructive.** Await `whenDurable()` before anything
  that cannot be undone. It resolves once every command so far is saved on
  this device, and rejects if that save failed.
  - Trashing originals waits on it (`apps/photonamous/src/app/real/trash-assets.ts`).
  - So does deleting an import's staged copy.
- **Commands are written in full.** A user's command is written even when
  the local value already matches, so it beats an older remote change that
  has not arrived yet. Internal writes (previews, repair marks) drop
  no-ops instead (`emit`'s `internal` flag).
- **Recipe leaves and hashing** (`recipe.ts`, [spec 7](../../docs/photonamous-spec.md#7-data-model)).
  - Each control is one leaf. A curve, a crop and an area's geometry are
    each one object leaf.
  - `recipeFromPaths` validates and clamps every leaf, using `RECIPE_RANGES`
    and `rangeForPath`, and ignores unknown paths.
  - New versions store only non-default leaves.
  - Controls added after the first release (`LATER_PATHS`, `LATER_GROUPS`)
    count in `recipeHash` only when they are set. New fields must keep
    existing hashes, or every stored preview goes stale.
- **Tombstones.** Things that devices can delete while others edit them
  are deleted with a flag, not by removing them: `deleted` on assets,
  versions, albums and presets, and `areas.<id>.deleted` on areas.
  - A whole-recipe write (`setRecipe`) tombstones every area the new recipe
    leaves out.
- **At most 8 areas.**
  - `MAX_AREAS` live areas are kept, the oldest by ID (IDs are UUIDv7 and
    sort by creation time), so every device keeps the same ones.
  - Areas with bad geometry are dropped.
  - `addArea` returns null when the recipe is full.
- **Built-in IDs.** Built-in presets live in code (`presets.ts`) under the
  prefix `builtin:`.
  - Stored records that claim such an ID are ignored by the view.
  - Rename and delete do nothing on a built-in.
  - `findPreset` looks up a `builtin:` ID only among the built-ins.
- **Duplicate roots.** Two devices that set up at the same moment each make
  a library root.
  - Every device picks the lowest ID, or keeps its stored root when that
    still resolves by ID.
  - Each device reads the other roots' journals, so nothing is lost.
  - Tests: `duplicate-roots.test.ts`.
  - Repair looks only at `lp.lib` of this library, so it does not see
    orphans in the other roots.
- **Originals.** Originals are never modified or permanently deleted.
  - Delete means the adapter's `trash`.
  - Repair's `leftovers` (originals of deleted photos that are still
    outside the trash) never include a file that a live photo uses.

## Undo

Both kinds of undo write the earlier values as new ops and never remove
history ([spec 6.6](../../docs/photonamous-spec.md#66-the-library-database)).

- **Recipe history** works per version, across devices (`undo`, `redo`,
  `history`).
  - A step is the ops that share an `OpStep`.
  - Undo writes back only the fields the step still holds (`heldFields`).
  - A field counts as no longer held when a later write touched it: another
    device's write, or this device's later step that has not been undone.
  - A write that leaves the value unchanged does not count as touching the
    field.
- **Library undo** works per session and per device (`undoLibrary`,
  `redoLibrary`, `libraryHistory`).
  - It covers marks, keywords, album membership, delete and restore,
    version create, rename and delete, and the shown version.
  - A multi-photo command is one step, and `libraryStep` groups several
    commands into one.
  - Undo reverts a field or member only while library history wrote it
    last and its value is unchanged. Anything another device or an import
    wrote since is left alone.
  - A step with nothing left to revert is dropped, and the step before it
    is undone instead.
  - Imports and sidecars run inside `withoutLibraryHistory`.
  - The stack starts empty on every load.

## Untrusted input

Anything that another device, another app or a hostile file could have
written is validated before use.

- **Journal lines** go through `validate.ts` `validateEnvelope`, with
  `LIMITS` on IDs, paths, fields, JSON depth and size.
  - Prototype-touching paths are refused.
  - Bad lines are skipped and reported; they do not throw.
- **Snapshots** must pass the size caps, the format check and
  `isVersionVector`. An unreadable snapshot falls back to an older one or
  to the journal.
- **`library.json`** is read by `readManifest`.
- **Records in the view** (`view.ts`) check the type of every field, and a
  bad value falls back to its default.
  - Recipe values are re-read through `recipeFromPaths` and
    `sanitizeRecipeValues`.
  - Export settings are re-read through `exportSettingsFromJson`, which
    accepts location-keeping presets; the UI shows them with
    `exportKeepsLocation`.
  - Saved searches are validated in `search/rules.ts`.
- **Imported files**: the EXIF, TIFF and RAF parsers (`import/`) bound
  every offset and count.
- **XMP**: sidecars are size-capped (`MAX_XMP_CHARS`), and the parser in
  `xmp/xml.ts` caps depth, elements and attributes.
- **Storage contents**: the importer and repair check checksums.

## Testing

```bash
npm run test -w @lopsy/photos-core       # Vitest in Node
npm run typecheck -w @lopsy/photos-core
npm run lint -w @lopsy/photos-core
npm run test:e2e -w @lopsy/photos-core   # Playwright: the browser-only parts
npm run test:photos                      # this package, then the app
```

- **Adapters.**
  - `library/test-support/test-adapter.ts` is a small in-memory adapter
    with the properties the library relies on. `failNext` makes chosen
    calls fail.
  - `storage/memory-adapter.ts` is the full memory backend.
  - Every adapter must pass `storage/adapter-contract.ts`.
- **Fake Drive.**
  - `storage/google-drive/fake-drive.ts` fakes the Drive v3 endpoints that
    the real `GoogleDriveAdapter` uses, as a fetch function.
  - `playwright-fake-drive.ts` serves it to a browser page.
  - Tests never talk to Google.
- **Seeded convergence.** Devices make random commands with a seeded
  random source (`test-support/random.ts`), sync in shuffled orders, and
  must end with equal `canonicalView`s. Tests: `convergence.test.ts`,
  `presets.test.ts`, `areas.test.ts`.
  - The integrity tests (`integrity.test.ts`, `regressions.test.ts`,
    `import/integrity.test.ts`) each reproduce a bug that was found:
    crashes between writes, failing stores, and interrupted uploads.
- **Browser harness.** `e2e/harness/` is a Vite page that loads
  photos-core in Chromium, for the parts that need a real browser:
  IndexedDB, Web Locks, OPFS, the GIS token stub, resumable uploads
  across a reload, and two devices syncing on the fake Drive.
  `e2e/browser.spec.ts` drives it.
- **Benchmarks.** `library/scale.bench.test.ts` and `search/bench.test.ts`
  hold the 50,000-photo budgets of [spec 11](../../docs/photonamous-spec.md#11-performance-budgets).
