import { describe, expect, it } from 'vitest';
import { decodeSegment, encodeSegment, segmentName } from './journal';
import { MemoryLocalStore } from './local-store';
import { DEFAULT_RECIPE, PIPELINE_VERSION, recipeFromPaths } from './recipe';
import { openLibrary } from './session';
import { TestAdapter } from './test-support/test-adapter';
import type { Json, LibrarySession, NewAsset, Op, OpEnvelope } from './types';
import { OP_SCHEMA_VERSION } from './validate';

function photo(n: number): NewAsset {
  return {
    kind: 'original',
    fileId: `file-${n}`,
    sha256: `sha-${n}`,
    fileName: `DSCF${1000 + n}.RAF`,
    byteSize: 30_000_000,
    format: 'raf',
    mimeType: 'image/x-fujifilm-raf',
    capturedAt: '2026-11-14T16:02:11',
    importedAt: '2026-11-15T10:00:00.000Z',
    importId: 'imp-1',
    width: 6240,
    height: 4160,
    orientation: 1,
    camera: null,
    lens: null,
    exposure: null,
    gps: null,
    pairedWith: null,
    source: null,
    renderFileId: null,
  };
}

async function open(adapter: TestAdapter, store = new MemoryLocalStore()): Promise<LibrarySession> {
  return openLibrary({ adapter, store, autoSync: false });
}

/** Every op the session's device has written to storage, in seq order. */
async function storedOps(adapter: TestAdapter, session: LibrarySession): Promise<OpEnvelope[]> {
  const folder = (await adapter.listChildren(session.layout.journalId)).find((f) => f.name === session.deviceId);
  if (!folder) return [];
  const ops: OpEnvelope[] = [];
  for (const file of await adapter.listChildren(folder.id)) {
    ops.push(...(await decodeSegment(await adapter.readContent(file.id))).ops);
  }
  return ops.sort((a, b) => a.seq - b.seq);
}

/** The fields of every `set` op the device wrote for one version. */
function versionWrites(ops: readonly OpEnvelope[], versionId: string): Readonly<Record<string, Json>>[] {
  return ops.flatMap((env) => (env.op.t === 'set' && env.op.kind === 'version' && env.op.id === versionId ? [env.op.fields] : []));
}

/**
 * Writes ops into `session`'s own journal folder after its last seq, as a
 * build of another age would have written them; another device reads them
 * from there.
 */
async function writeRawOps(adapter: TestAdapter, session: LibrarySession, ops: readonly Op[]): Promise<void> {
  await session.syncNow();
  const folder = (await adapter.listChildren(session.layout.journalId)).find((f) => f.name === session.deviceId);
  if (!folder) throw new Error('The device has no journal folder yet');
  const first = (await storedOps(adapter, session)).reduce((m, env) => Math.max(m, env.seq), 0) + 1;
  const envelopes: OpEnvelope[] = ops.map((op, i) => ({
    id: `${session.deviceId}:${first + i}`,
    device: session.deviceId,
    seq: first + i,
    hlc: `900000000000000-${String(i).padStart(5, '0')}-${session.deviceId}`,
    v: OP_SCHEMA_VERSION,
    op,
  }));
  await adapter.createFile(
    { parentId: folder.id, name: segmentName(first, first + ops.length - 1), mimeType: 'application/gzip' },
    await encodeSegment(envelopes),
  );
}

/** The asset fields a photo was created with, by a build of any age. */
function assetOp(assetId: string, versionId: string): Op {
  return {
    t: 'set',
    kind: 'asset',
    id: assetId,
    fields: { kind: 'original', fileId: 'file-old', fileName: 'OLD.RAF', format: 'raf', primaryVersionId: versionId, deleted: false },
  };
}

describe('the pipeline a version was edited with', () => {
  it('is written with every new version, also at its default', async () => {
    const adapter = new TestAdapter();
    const session = await open(adapter);
    const { assetId, versionId } = session.addAsset(photo(1));
    const second = session.createVersion(assetId, 'B&W');
    const third = session.createVersion(assetId, 'Copy', { ...DEFAULT_RECIPE, tone: { ...DEFAULT_RECIPE.tone, exposure: 1 } });
    await session.syncNow();
    const ops = await storedOps(adapter, session);
    for (const id of [versionId, second, third]) {
      const [created] = versionWrites(ops, id);
      expect(created?.['recipe.pipeline']).toBe(PIPELINE_VERSION);
      expect(session.getView().versions.get(id)?.recipe.pipeline).toBe(PIPELINE_VERSION);
    }
    // Only the pipeline is added: other leaves at their default stay out.
    expect(Object.keys(versionWrites(ops, second)[0] ?? {}).filter((k) => k.startsWith('recipe.'))).toEqual(['recipe.pipeline']);
  });

  it('is kept by edits, pastes and presets, which never write it', async () => {
    const adapter = new TestAdapter();
    const session = await open(adapter);
    const { versionId } = session.addAsset(photo(1));
    session.editRecipe(versionId, { 'tone.exposure': 0.5, pipeline: PIPELINE_VERSION + 4 }, 'Exposure');
    session.applyRecipeValues([versionId], { 'tone.contrast': 20, pipeline: PIPELINE_VERSION + 4 }, 'Paste edits');
    session.undo(versionId);
    session.redo(versionId);
    await session.syncNow();
    const writes = versionWrites(await storedOps(adapter, session), versionId);
    expect(writes.slice(1).some((fields) => 'recipe.pipeline' in fields)).toBe(false);
    const recipe = session.getView().versions.get(versionId)?.recipe;
    expect(recipe).toMatchObject({ pipeline: PIPELINE_VERSION, tone: { exposure: 0.5, contrast: 20 } });
  });

  it('reads as pipeline 1 from a journal written before versions recorded it', async () => {
    const adapter = new TestAdapter();
    const writer = await open(adapter);
    writer.setSetting('grid.size', 3);
    // What the app wrote before: no `recipe.pipeline`, only the leaves off their default.
    await writeRawOps(adapter, writer, [
      assetOp('asset-old', 'version-old'),
      {
        t: 'set',
        kind: 'version',
        id: 'version-old',
        fields: { assetId: 'asset-old', name: 'Original', createdAt: '2026-11-01T00:00:00.000Z', thumb: null, screen: null, deleted: false, 'recipe.tone.exposure': 0.7 },
      },
    ]);
    const reader = await open(adapter);
    await reader.syncNow();
    const version = reader.getView().versions.get('version-old');
    expect(version?.recipe.pipeline).toBe(1);
    expect(version?.recipe.tone.exposure).toBe(0.7);
    // An edit made now leaves it unrecorded, so it keeps reading as 1.
    reader.editRecipe('version-old', { 'tone.contrast': 10 }, 'Contrast');
    expect(reader.getView().versions.get('version-old')?.recipe).toMatchObject({ pipeline: 1, tone: { exposure: 0.7, contrast: 10 } });
  });

  it('reads as pipeline 1 when the leaf is missing or broken', () => {
    expect(recipeFromPaths({}).pipeline).toBe(1);
    expect(recipeFromPaths({ pipeline: 'two' }).pipeline).toBe(1);
    expect(recipeFromPaths({ pipeline: 1.5 }).pipeline).toBe(1);
    expect(recipeFromPaths({ pipeline: 3 }).pipeline).toBe(3);
  });
});
