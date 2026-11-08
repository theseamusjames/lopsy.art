import { describe, it, expect } from 'vitest';
import { planHistoryJump, type LiveHistoryState, type LivePixels } from './history-jump';
import type { HistorySnapshot } from './types';
import { EMPTY_SELECTION } from './types';
import type { DocumentState } from '../../types';

function doc(tag: string, width = 100): DocumentState {
  return {
    id: tag, name: tag, width, height: 100,
    layers: [{ id: 'L', type: 'raster' }] as unknown as DocumentState['layers'], layerOrder: ['L'], activeLayerId: 'L', selectedLayerIds: [],
    backgroundColor: { r: 0, g: 0, b: 0, a: 1 }, colorMode: 'rgb',
  } as DocumentState;
}

function meta(label: string, tag: string): HistorySnapshot {
  return { kind: 'metadata', document: doc(tag), selection: EMPTY_SELECTION, label, paths: [], selectedPathId: null };
}

function pix(label: string, tag: string, handle: number, width = 100): HistorySnapshot {
  return {
    kind: 'pixels', document: doc(tag, width), selection: EMPTY_SELECTION, label,
    gpuSnapshots: new Map([['L', handle]]), maskSnapshots: new Map(), paths: [], selectedPathId: null,
  };
}

const live: LiveHistoryState = { document: doc('live', 50), selection: EMPTY_SELECTION, paths: [], selectedPathId: null };
const LIVE_HANDLE = 999;
const EMPTY = 0xffffffff;
const capture = (): LivePixels => ({ gpuSnapshots: new Map([['L', LIVE_HANDLE]]), maskSnapshots: new Map() });
const merge = (snap: DocumentState, from: DocumentState) => ({ ...snap, name: `${snap.name}@${from.name}` });

/** Reference: what n single-step jumps would push, built one step at a time. */
function singleSteps(stack: HistorySnapshot[], n: number) {
  const plans = [];
  let cur = live;
  let curPixels: () => LivePixels = capture;
  const remaining = [...stack];
  for (let k = 0; k < n; k++) {
    const entry = remaining.pop()!;
    const plan = planHistoryJump([entry], cur, curPixels, merge, EMPTY)!;
    plans.push(plan);
    cur = plan.target;
    const t = plan.target;
    curPixels = t.kind === 'pixels'
      ? () => ({ gpuSnapshots: t.gpuSnapshots, maskSnapshots: t.maskSnapshots })
      : curPixels;
  }
  return plans;
}

describe('planHistoryJump (#1543)', () => {
  // Undo stack, oldest first: Levels (meta), Crop (pixels), Grading (meta).
  const stack = [meta('Levels', 's0'), pix('Crop', 's1', 11, 100), meta('Grading', 's2')];

  it('labels each pushed entry with the action it redoes', () => {
    const plan = planHistoryJump(stack.slice().reverse(), live, capture, merge, EMPTY)!;
    expect(plan.additions.map((a) => a.label)).toEqual(['Grading', 'Crop', 'Levels']);
    const single = singleSteps(stack, 3).map((p) => p.additions[0]!.label);
    expect(plan.additions.map((a) => a.label)).toEqual(single);
  });

  it('restores the pre-crop pixels when the target is a metadata entry before a crop', () => {
    const plan = planHistoryJump(stack.slice().reverse(), live, capture, merge, EMPTY)!;
    expect(plan.target.kind).toBe('pixels');
    if (plan.target.kind !== 'pixels') return;
    expect(plan.target.gpuSnapshots.get('L')).toBe(11);
    expect(plan.target.document.name).toBe('s0@s1');
  });

  it('gives the redo entry of a pixel action the pixels of the state it leads to', () => {
    const plan = planHistoryJump(stack.slice().reverse(), live, capture, merge, EMPTY)!;
    // additions[1] redoes Crop into state s2, whose pixels are the live ones.
    const redoCrop = plan.additions[1]!;
    expect(redoCrop.kind).toBe('pixels');
    if (redoCrop.kind !== 'pixels') return;
    expect(redoCrop.gpuSnapshots.get('L')).toBe(LIVE_HANDLE);
    expect(redoCrop.document.name).toBe('s2@live');
  });

  it('keeps live pixels when only metadata steps are crossed', () => {
    const plan = planHistoryJump([meta('A', 'a')], live, capture, merge, EMPTY)!;
    expect(plan.target.kind).toBe('metadata');
  });

  it('reuses a pixel target as-is', () => {
    const target = pix('Crop', 's1', 11);
    const plan = planHistoryJump([meta('Grading', 's2'), target], live, capture, merge, EMPTY)!;
    expect(plan.target).toBe(target);
  });

  it('gives a raster layer added by a metadata step an empty texture', () => {
    const before = pix('Fill', 'p', 11);
    const added = meta('Add Layer', 'a');
    added.document = {
      ...added.document,
      layerOrder: ['L', 'N'],
      layers: [{ id: 'L', type: 'raster' }, { id: 'N', type: 'raster' }] as unknown as DocumentState['layers'],
    };
    // Redo direction: Add Layer leads from `before` to `added`, then a pixel
    // action follows, so its entry needs pixels for both layers.
    const plan = planHistoryJump([added], live, capture, merge, EMPTY)!;
    expect(plan.target.kind).toBe('metadata');
    const redo = planHistoryJump([before, added], live, capture, merge, EMPTY)!;
    expect(redo.target.kind).toBe('pixels');
    if (redo.target.kind !== 'pixels') return;
    expect(redo.target.gpuSnapshots.get('L')).toBe(11);
    expect(redo.target.gpuSnapshots.get('N')).toBe(EMPTY);
  });

  it('resets a layer the jump removes to its content where it was last held', () => {
    const withN = (d: DocumentState): DocumentState => ({
      ...d,
      layerOrder: ['L', 'N'],
      layers: [{ id: 'L', type: 'raster' }, { id: 'N', type: 'raster' }] as unknown as DocumentState['layers'],
    });
    const liveWithN: LiveHistoryState = { ...live, document: withN(live.document) };
    // Undo stack, oldest first: Add Layer (meta, state without N),
    // Fill (pixels, state with N empty — no handle for N here means a fresh layer).
    const addLayer = meta('Add Layer', 'pre');
    const fill = pix('Fill', 'empty-n', 11);
    fill.document = withN(fill.document);
    const plan = planHistoryJump([fill, addLayer], liveWithN, capture, merge, EMPTY)!;
    expect(plan.removedLayerRestores.get('N')).toBe(EMPTY);

    const single = planHistoryJump([fill], liveWithN, capture, merge, EMPTY)!;
    expect(single.removedLayerRestores.size).toBe(0);
  });
});
