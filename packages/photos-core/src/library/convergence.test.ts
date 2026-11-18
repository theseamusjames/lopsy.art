import { describe, expect, it } from 'vitest';
import { MemoryLocalStore } from './local-store';
import { openLibrary } from './session';
import { canonicalView } from './test-support/canonical';
import { pickOne, seededRandom } from './test-support/random';
import { TestAdapter } from './test-support/test-adapter';
import type { LibrarySession, NewAsset, Rating } from './types';

function photo(n: number): NewAsset {
  return {
    kind: 'original',
    fileId: `file-${n}`,
    sha256: `sha-${n}`,
    fileName: `IMG_${n}.JPG`,
    byteSize: 1000,
    format: 'jpeg',
    mimeType: 'image/jpeg',
    capturedAt: null,
    importedAt: '2026-11-15T10:00:00.000Z',
    importId: 'imp',
    width: null,
    height: null,
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

async function scenario(seed: number): Promise<{ sessions: LibrarySession[]; adapter: TestAdapter }> {
  const random = seededRandom(seed);
  const adapter = new TestAdapter();
  let wall = 1_700_000_000_000;
  const skews = [0, -90_000, 120_000];
  const sessions: LibrarySession[] = [];
  for (const skew of skews) {
    sessions.push(
      await openLibrary({
        adapter,
        store: new MemoryLocalStore(),
        autoSync: false,
        snapshotEvery: 40,
        rollUpAt: 4,
        now: () => wall + skew,
      }),
    );
  }
  const [first] = sessions;
  const created = [1, 2, 3].map((n) => first!.addAsset(photo(n)));
  const album = first!.createAlbum('Album');
  await first!.syncNow();
  for (const s of sessions) await s.syncNow();
  const assetIds = created.map((c) => c.assetId);
  const versionIds = created.map((c) => c.versionId);

  for (let step = 0; step < 150; step++) {
    wall += Math.floor(random() * 3000);
    const s = pickOne(random, sessions);
    const roll = random();
    const assetId = pickOne(random, assetIds);
    const versionId = pickOne(random, versionIds);
    if (roll < 0.15) s.setMarks([assetId], { rating: Math.floor(random() * 6) as Rating });
    else if (roll < 0.25) s.setKeyword([assetId], pickOne(random, ['a', 'b', 'c']), random() < 0.6);
    else if (roll < 0.3) (random() < 0.5 ? s.deleteAssets([assetId]) : s.restoreAssets([assetId]));
    else if (roll < 0.5) {
      const path = pickOne(random, ['tone.exposure', 'tone.contrast', 'color.saturation']);
      s.editRecipe(versionId, { [path]: Math.round(random() * 100) / 50 }, path);
    } else if (roll < 0.57) s.undo(versionId);
    else if (roll < 0.62) s.redo(versionId);
    else if (roll < 0.7) s.setAlbumMember(album, assetId, random() < 0.5);
    else if (roll < 0.75) s.setSetting(pickOne(random, ['x', 'y']), Math.floor(random() * 10));
    else {
      if (random() < 0.15) adapter.failNext(pickOne(random, ['network', 'rate-limited', 'unknown'] as const));
      await s.syncNow();
    }
  }
  for (let round = 0; round < 2; round++) for (const s of sessions) await s.syncNow();
  const late = await openLibrary({ adapter, store: new MemoryLocalStore(), autoSync: false });
  await late.syncNow();
  return { sessions: [...sessions, late], adapter };
}

describe('sessions on one storage', () => {
  it('converge after random edits, undo, failed syncs, snapshots and roll-ups (seeded)', async () => {
    let snapshots = 0;
    let deletes = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const { sessions, adapter } = await scenario(seed);
      snapshots += adapter.allFiles().filter((f) => f.properties['lp.role'] === 'snapshot').length;
      deletes += adapter.calls.filter((c) => c === 'deletePermanently').length;
      const views = sessions.map((s) => canonicalView(s.getView()));
      for (let i = 1; i < views.length; i++) expect(views[i], `seed ${seed}, device ${i}`).toEqual(views[0]);
      for (const s of sessions.slice(0, 3)) expect(s.getSyncStatus()).toMatchObject({ state: 'idle', pendingOps: 0 });
    }
    // The scenario really exercised snapshots and roll-ups.
    expect(snapshots).toBeGreaterThan(0);
    expect(deletes).toBeGreaterThan(0);
  });
});
