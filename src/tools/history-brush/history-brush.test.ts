import { describe, it, expect } from 'vitest';
import { resolveHistorySource } from './history-brush';
import type { HistorySnapshot } from '../../app/store/types';
import type { DocumentState } from '../../types';

const ORIGIN_ID = 'origin-1';

function makeDoc(layerOrder: string[]): DocumentState {
  return {
    id: 'doc-1',
    name: 'Untitled',
    width: 100,
    height: 100,
    layers: [],
    layerOrder,
    activeLayerId: layerOrder[0] ?? '',
    backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
    rootGroupId: 'root',
  };
}

function makeSnap(
  id: string,
  label: string,
  layerOrder: string[],
  pixels: Record<string, Uint8Array>,
  metadataOnly = false,
): HistorySnapshot {
  return {
    id,
    document: makeDoc(layerOrder),
    gpuSnapshots: new Map(Object.entries(pixels)),
    layerPixelData: new Map(),
    layerCropInfo: new Map(),
    sparseLayerData: new Map(),
    label,
    metadataOnly,
  };
}

const PIXELS = new Uint8Array([1, 2, 3, 4]);

describe('resolveHistorySource', () => {
  it('returns no-source when sourceId is null', () => {
    const r = resolveHistorySource(null, 'layer-1', [], ORIGIN_ID);
    expect(r.kind).toBe('no-source');
  });

  it('resolves the origin row to a transparent blob', () => {
    const r = resolveHistorySource(ORIGIN_ID, 'layer-1', [], ORIGIN_ID);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.blob).toBe(null);
      expect(r.label).toBe('Original');
    }
  });

  it('returns snapshot-gone when the id is no longer in the stack', () => {
    const stack = [makeSnap('a', 'Edit', ['layer-1'], { 'layer-1': PIXELS })];
    const r = resolveHistorySource('missing', 'layer-1', stack, ORIGIN_ID);
    expect(r.kind).toBe('snapshot-gone');
  });

  it('returns layer-missing when the layer did not exist at that snapshot', () => {
    const stack = [makeSnap('a', 'Edit', ['layer-2'], { 'layer-2': PIXELS })];
    const r = resolveHistorySource('a', 'layer-1', stack, ORIGIN_ID);
    expect(r.kind).toBe('layer-missing');
  });

  it('returns the blob for a full snapshot', () => {
    const stack = [makeSnap('a', 'Brush', ['layer-1'], { 'layer-1': PIXELS })];
    const r = resolveHistorySource('a', 'layer-1', stack, ORIGIN_ID);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.blob).toBe(PIXELS);
      expect(r.label).toBe('Brush');
      expect(r.snapshotId).toBe('a');
    }
  });

  it('walks back through metadata-only snapshots to find pixel data', () => {
    const stack = [
      makeSnap('a', 'Paint', ['layer-1'], { 'layer-1': PIXELS }),
      makeSnap('b', 'Rename', ['layer-1'], {}, true),
      makeSnap('c', 'Opacity', ['layer-1'], {}, true),
    ];
    const r = resolveHistorySource('c', 'layer-1', stack, ORIGIN_ID);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      // Labeled from the user-picked row, but pixels come from the earlier snapshot.
      expect(r.label).toBe('Opacity');
      expect(r.blob).toBe(PIXELS);
      expect(r.snapshotId).toBe('c');
    }
  });

  it('falls back to transparent blob when no earlier snapshot has pixels', () => {
    const stack = [
      makeSnap('a', 'Add Layer', ['layer-1'], {}, true),
      makeSnap('b', 'Rename', ['layer-1'], {}, true),
    ];
    const r = resolveHistorySource('b', 'layer-1', stack, ORIGIN_ID);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.blob).toBe(null);
    }
  });

  it('skips snapshots where the layer had not been added yet', () => {
    const stack = [
      makeSnap('a', 'First Paint', ['layer-1'], { 'layer-1': PIXELS }),
      makeSnap('b', 'Add Layer 2', ['layer-1', 'layer-2'], {}, true),
      makeSnap('c', 'Paint Layer 2', ['layer-1', 'layer-2'], { 'layer-2': PIXELS }),
    ];
    // Ask for layer-2 source at snapshot c: layer-2's most recent pixels are at c.
    const r = resolveHistorySource('c', 'layer-2', stack, ORIGIN_ID);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.blob).toBe(PIXELS);
    }
  });
});
