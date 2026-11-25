import { describe, expect, it } from 'vitest';
import { encodeHlc } from './hlc';
import { decodeSegment, encodeSegment, segmentName } from './journal';
import { MemoryLocalStore } from './local-store';
import { rollUpSegments } from './rollup';
import { openLibrary } from './session';
import { canonicalView } from './test-support/canonical';
import { TestAdapter } from './test-support/test-adapter';
import type { OpEnvelope } from './types';

const DEVICE = 'dev-a';

function op(seq: number): OpEnvelope {
  return {
    id: `${DEVICE}:${seq}`,
    device: DEVICE,
    seq,
    hlc: encodeHlc({ wall: 1000 + seq, counter: 0, device: DEVICE }),
    v: 1,
    op: { t: 'set', kind: 'setting', id: `k${seq}`, fields: { value: seq } },
  };
}

async function setup(ranges: [number, number][]) {
  const adapter = new TestAdapter();
  const folder = await adapter.createFolder((await adapter.getRoot()).id, DEVICE);
  for (const [first, last] of ranges) {
    const ops = [];
    for (let s = first; s <= last; s++) ops.push(op(s));
    await adapter.createFile({ parentId: folder.id, name: segmentName(first, last), mimeType: 'application/gzip' }, await encodeSegment(ops));
  }
  const run = (minRun: number, throughSeq = 1_000_000) =>
    rollUpSegments({ adapter, folderId: folder.id, deviceId: DEVICE, libraryId: 'lib', throughSeq, minRun });
  const names = async () => (await adapter.listChildren(folder.id)).map((f) => f.name).sort();
  return { adapter, folder, run, names };
}

describe('rollUpSegments', () => {
  it('merges a run of small segments into one', async () => {
    const { adapter, folder, run, names } = await setup([[1, 2], [3, 3], [4, 7], [8, 9]]);
    const result = await run(3);
    expect(result.created).toEqual([segmentName(1, 9)]);
    expect(await names()).toEqual([segmentName(1, 9)]);
    const file = (await adapter.listChildren(folder.id))[0]!;
    const decoded = await decodeSegment(await adapter.readContent(file.id), { device: DEVICE });
    expect(decoded.ops.map((o) => o.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('leaves short runs, gaps and segments past throughSeq alone', async () => {
    const { run, names } = await setup([[1, 1], [2, 2], [5, 5], [6, 6], [7, 7]]);
    await run(3, 6);
    expect(await names()).toEqual([segmentName(1, 1), segmentName(2, 2), segmentName(5, 5), segmentName(6, 6), segmentName(7, 7)]);
    await run(2, 6);
    expect(await names()).toEqual([segmentName(1, 2), segmentName(5, 6), segmentName(7, 7)]);
  });

  it('cleans up after an interrupted roll-up', async () => {
    const { run, names } = await setup([[1, 1], [2, 2], [1, 2], [3, 3]]);
    await run(50);
    expect(await names()).toEqual([segmentName(1, 2), segmentName(3, 3)]);
  });

  it('never rolls up a run with an unreadable segment', async () => {
    const { adapter, folder, run, names } = await setup([[1, 1], [2, 2]]);
    await adapter.createFile({ parentId: folder.id, name: segmentName(3, 3), mimeType: 'application/gzip' }, new Blob(['junk']));
    const result = await run(2);
    expect(result.problems).toHaveLength(1);
    expect(await names()).toEqual([segmentName(1, 1), segmentName(2, 2), segmentName(3, 3)]);
  });
});

describe('roll-up in sync', () => {
  it('keeps devices converging while one rolls up its journal', async () => {
    const adapter = new TestAdapter();
    const a = await openLibrary({ adapter, store: new MemoryLocalStore(), autoSync: false, rollUpAt: 3 });
    const b = await openLibrary({ adapter, store: new MemoryLocalStore(), autoSync: false });
    for (let i = 0; i < 7; i++) {
      a.setSetting(`k${i}`, i);
      await a.syncNow();
      if (i === 1) await b.syncNow();
    }
    const folder = (await adapter.listChildren(a.layout.journalId)).find((f) => f.name === a.deviceId)!;
    expect((await adapter.listChildren(folder.id)).length).toBeLessThan(7);
    await b.syncNow();
    const c = await openLibrary({ adapter, store: new MemoryLocalStore(), autoSync: false });
    await c.syncNow();
    expect(canonicalView(b.getView())).toEqual(canonicalView(a.getView()));
    expect(canonicalView(c.getView())).toEqual(canonicalView(a.getView()));
    expect(a.getView().settings.size).toBe(7);
  });
});
