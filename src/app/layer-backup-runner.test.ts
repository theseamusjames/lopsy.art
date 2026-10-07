import { describe, it, expect, beforeEach } from 'vitest';
import {
  createLayerBackupRunner, isSameHistoryKey, isStampUnchanged, knownBackupBytes, TOO_LARGE_WARNING,
  type BackupLayer, type HistoryKey, type LayerBackupRunner, type LayerStamp,
} from './layer-backup-runner';

describe('isSameHistoryKey (#973)', () => {
  const entry = { label: 'Fill' };
  const layers: unknown[] = [];
  const key: HistoryKey = { undoTop: entry, undoLength: 3, redoTop: undefined, redoLength: 0, layers };

  it('matches an unchanged document', () => {
    expect(isSameHistoryKey(key, { ...key })).toBe(true);
  });

  it('sees a new edit even when the capped undo stack keeps its length', () => {
    expect(isSameHistoryKey(key, { ...key, undoTop: { label: 'Brush' } })).toBe(false);
  });

  it('sees undo and redo', () => {
    expect(isSameHistoryKey(key, { ...key, undoLength: 2, redoTop: entry, redoLength: 1 })).toBe(false);
  });

  it('sees a layer change that pushed no history', () => {
    expect(isSameHistoryKey(key, { ...key, layers: [] })).toBe(false);
  });
});

describe('isStampUnchanged (#1221)', () => {
  const engine = {};
  const stamp: LayerStamp = { engine, generation: 7, width: 100, height: 50 };

  it('reuses a readback whose layer was not written since', () => {
    expect(isStampUnchanged(stamp, { ...stamp })).toBe(true);
  });

  it('re-reads after a write', () => {
    expect(isStampUnchanged(stamp, { ...stamp, generation: 9 })).toBe(false);
  });

  it('re-reads after the texture was resized without a reported write', () => {
    expect(isStampUnchanged(stamp, { ...stamp, width: 200 })).toBe(false);
  });

  it('re-reads on a new engine, whose generations start over', () => {
    expect(isStampUnchanged(stamp, { ...stamp, engine: {} })).toBe(false);
  });

  it('always reads a layer the engine never reported written', () => {
    const never = { ...stamp, generation: 0 };
    expect(isStampUnchanged(never, { ...never })).toBe(false);
  });

  it('reads a layer with no earlier readback', () => {
    expect(isStampUnchanged(undefined, stamp)).toBe(false);
  });
});

describe('knownBackupBytes (#1222)', () => {
  const engine = {};
  const stamps = new Map<string, LayerStamp>([
    ['a', { engine, generation: 1, width: 10, height: 10 }],
    ['b', { engine, generation: 5, width: 10, height: 10 }],
  ]);
  const stampOf = (id: string) => stamps.get(id) ?? null;

  it('counts only layers unchanged since their recorded size', () => {
    const records = new Map([
      ['a', { stamp: { engine, generation: 1, width: 10, height: 10 }, bytes: 300 }],
      ['b', { stamp: { engine, generation: 4, width: 10, height: 10 }, bytes: 900 }],
    ]);
    expect(knownBackupBytes(['a', 'b', 'c'], stampOf, records)).toBe(300);
  });

  it('ignores records of layers no longer backed up', () => {
    const records = new Map([['a', { stamp: stamps.get('a')!, bytes: 300 }]]);
    expect(knownBackupBytes(['b'], stampOf, records)).toBe(0);
  });
});

interface Harness {
  runner: LayerBackupRunner;
  layers: BackupLayer[];
  generations: Map<string, number>;
  readsOf: string[];
  warnings: string[];
  scheduled: Array<() => void>;
  setLost: (lost: boolean) => void;
  setMax: (bytes: number) => void;
  setEngine: (engine: object) => void;
  edit: () => void;
  write: (id: string) => void;
  runIdle: () => void;
  key: () => HistoryKey;
}

function raster(id: string): BackupLayer {
  return { id, type: 'raster', x: 0, y: 0, width: 10, height: 10 } as unknown as BackupLayer;
}

function harness(ids: string[], blobBytes = 100): Harness {
  let isLost = false;
  let max = 1_000_000;
  let engine: object = {};
  let nextGen = 1;
  let undoTop: object = {};
  const generations = new Map<string, number>();
  const readsOf: string[] = [];
  const warnings: string[] = [];
  const scheduled: Array<() => void> = [];
  const h: Harness = {
    runner: undefined as unknown as LayerBackupRunner,
    layers: ids.map(raster),
    generations,
    readsOf,
    warnings,
    scheduled,
    setLost: (lost) => { isLost = lost; },
    setMax: (bytes) => { max = bytes; },
    setEngine: (e) => { engine = e; },
    edit: () => { undoTop = {}; },
    write: (id) => { generations.set(id, nextGen++); },
    runIdle: () => {
      while (scheduled.length > 0) scheduled.shift()!();
    },
    key: () => ({ undoTop, undoLength: 1, redoTop: undefined, redoLength: 0, layers: h.layers }),
  };
  for (const id of ids) h.write(id);
  h.runner = createLayerBackupRunner({
    isContextLost: () => isLost,
    prepare: () => {},
    historyKey: h.key,
    backupLayers: () => h.layers,
    stamp: (id) => ({ engine, generation: generations.get(id) ?? 0, width: 10, height: 10 }),
    readBlob: (id) => {
      readsOf.push(id);
      return new Uint8Array(blobBytes);
    },
    scheduleIdle: (callback) => {
      scheduled.push(callback);
      return () => {
        const i = scheduled.indexOf(callback);
        if (i >= 0) scheduled.splice(i, 1);
      };
    },
    now: () => 1234,
    warn: (message) => { warnings.push(message); },
    maxBytes: () => max,
  });
  return h;
}

describe('layer backup runner', () => {
  let h: Harness;
  beforeEach(() => {
    h = harness(['a', 'b', 'c']);
  });

  it('a hidden tab backs every layer up before returning', () => {
    h.runner.request('now');
    expect(h.readsOf).toEqual(['a', 'b', 'c']);
    expect([...h.runner.committed()!.layers.keys()]).toEqual(['a', 'b', 'c']);
    expect(h.runner.committed()!.takenAt).toBe(1234);
  });

  it('does nothing when the history key is unchanged since the backup', () => {
    h.runner.request('now');
    h.runner.request('now');
    h.runner.request('idle');
    expect(h.readsOf).toHaveLength(3);
    expect(h.scheduled).toHaveLength(0);
  });

  it('re-reads only the layer written since the last backup (#1221)', () => {
    h.runner.request('now');
    const before = h.runner.committed()!;
    h.write('b');
    h.edit();
    h.runner.request('now');
    expect(h.readsOf).toEqual(['a', 'b', 'c', 'b']);
    const after = h.runner.committed()!;
    expect(after).not.toBe(before);
    expect(after.layers.get('a')!.blob).toBe(before.layers.get('a')!.blob);
    expect(after.layers.get('b')!.blob).not.toBe(before.layers.get('b')!.blob);
  });

  it('pairs a reused blob with the current layer model', () => {
    h.runner.request('now');
    const moved = { ...h.layers[0]!, x: 40 } as BackupLayer;
    h.layers = [moved, h.layers[1]!, h.layers[2]!];
    h.runner.request('now');
    expect(h.readsOf).toHaveLength(3);
    expect(h.runner.committed()!.layers.get('a')!.layer).toBe(moved);
  });

  it('reads everything again on a new engine', () => {
    h.runner.request('now');
    h.setEngine({});
    h.edit();
    h.runner.request('now');
    expect(h.readsOf).toHaveLength(6);
  });

  it('drops deleted layers and reads added ones', () => {
    h.runner.request('now');
    h.layers = [h.layers[0]!, raster('d')];
    h.write('d');
    h.runner.request('now');
    expect(h.readsOf).toEqual(['a', 'b', 'c', 'd']);
    expect([...h.runner.committed()!.layers.keys()]).toEqual(['a', 'd']);
  });

  it('a blur reads one layer per idle callback and commits only when all are in', () => {
    h.runner.request('idle');
    expect(h.readsOf).toEqual([]);
    expect(h.runner.committed()).toBeNull();
    h.scheduled.shift()!();
    expect(h.readsOf).toEqual(['a']);
    expect(h.runner.committed()).toBeNull();
    expect(h.runner.stats().isPassPending).toBe(true);
    h.scheduled.shift()!();
    expect(h.runner.committed()).toBeNull();
    h.scheduled.shift()!();
    expect(h.readsOf).toEqual(['a', 'b', 'c']);
    expect(h.runner.committed()?.layers.size).toBe(3);
    expect(h.scheduled).toHaveLength(0);
    expect(h.runner.stats().isPassPending).toBe(false);
  });

  it('a partial pass never replaces the last complete backup', () => {
    h.runner.request('now');
    const complete = h.runner.committed();
    h.write('a');
    h.write('b');
    h.edit();
    h.runner.request('idle');
    h.scheduled.shift()!();
    expect(h.runner.committed()).toBe(complete);
  });

  it('focus pauses a pass, and the next blur resumes it without re-reading', () => {
    h.runner.request('idle');
    h.scheduled.shift()!();
    h.runner.pause();
    expect(h.scheduled).toHaveLength(0);
    h.runner.request('idle');
    h.runIdle();
    expect(h.readsOf).toEqual(['a', 'b', 'c']);
    expect(h.runner.committed()?.layers.size).toBe(3);
  });

  it('an edit between slices abandons the pass but keeps what it read', () => {
    h.runner.request('idle');
    h.scheduled.shift()!();
    h.write('c');
    h.edit();
    h.runIdle();
    expect(h.runner.committed()).toBeNull();
    expect(h.runner.stats().isPassPending).toBe(false);
    h.runner.request('now');
    expect(h.readsOf).toEqual(['a', 'b', 'c']);
    expect(h.runner.committed()?.layers.size).toBe(3);
  });

  it('a hidden tab finishes a pass a blur started', () => {
    h.runner.request('idle');
    h.scheduled.shift()!();
    h.runner.request('now');
    expect(h.readsOf).toEqual(['a', 'b', 'c']);
    expect(h.runner.committed()?.layers.size).toBe(3);
    expect(h.scheduled).toHaveLength(0);
  });

  it('a context lost mid-pass ends it and keeps the last backup', () => {
    h.runner.request('now');
    const complete = h.runner.committed();
    h.write('a');
    h.edit();
    h.runner.request('idle');
    h.setLost(true);
    h.runIdle();
    expect(h.readsOf).toHaveLength(3);
    expect(h.runner.committed()).toBe(complete);
    h.runner.request('now');
    expect(h.readsOf).toHaveLength(3);
  });
});

describe('layer backup runner over the size cap (#1222)', () => {
  let h: Harness;
  beforeEach(() => {
    h = harness(['a', 'b', 'c'], 100);
    h.setMax(250);
  });

  it('stops reading once over the cap, drops the backup and warns', () => {
    h.runner.request('now');
    expect(h.readsOf).toEqual(['a', 'b', 'c']);
    expect(h.runner.committed()).toBeNull();
    expect(h.warnings).toEqual([TOO_LARGE_WARNING]);
    expect(h.runner.stats().tooLarge).toBe(1);
  });

  it('drops an older complete backup too', () => {
    h.setMax(1000);
    h.runner.request('now');
    h.setMax(250);
    h.write('a');
    h.edit();
    h.runner.request('now');
    expect(h.runner.committed()).toBeNull();
  });

  it('remembers the failure: leaving again without an edit reads nothing', () => {
    h.runner.request('now');
    h.runner.request('now');
    h.runner.request('idle');
    h.runIdle();
    expect(h.readsOf).toHaveLength(3);
    expect(h.warnings).toHaveLength(1);
  });

  it('skips a new key whose unchanged layers alone exceed the cap', () => {
    h.runner.request('now');
    h.edit();
    h.runner.request('now');
    expect(h.readsOf).toHaveLength(3);
    expect(h.runner.stats().tooLarge).toBe(2);
    expect(h.warnings).toHaveLength(2);
  });

  it('tries again once the document fits', () => {
    h.runner.request('now');
    h.layers = [h.layers[0]!];
    h.runner.request('now');
    expect(h.readsOf).toEqual(['a', 'b', 'c', 'a']);
    expect(h.runner.committed()?.layers.size).toBe(1);
  });

  it('a sliced pass stops at the cap too', () => {
    h.runner.request('idle');
    h.runIdle();
    expect(h.readsOf).toEqual(['a', 'b', 'c']);
    expect(h.runner.committed()).toBeNull();
    expect(h.runner.stats().isPassPending).toBe(false);
  });
});
