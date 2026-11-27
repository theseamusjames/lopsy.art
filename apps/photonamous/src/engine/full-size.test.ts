import { describe, expect, it } from 'vitest';
import { FullSizeLoads, editableLimit, fullSizeNoteText, heldSize, STEP_DOWN, TRANSFORM_BORDER } from './full-size';

const Q2 = { width: 8368, height: 5584 };

describe('heldSize', () => {
  it('keeps a photo that fits, to the pixel', () => {
    expect(heldSize({ width: 8192, height: 5464 }, 8192)).toEqual({ width: 8192, height: 5464 });
    expect(heldSize({ width: 6000, height: 4000 }, 16384)).toEqual({ width: 6000, height: 4000 });
  });

  it('puts the long edge of a larger photo at the limit, aspect kept', () => {
    expect(heldSize(Q2, 8192)).toEqual({ width: 8192, height: 5467 });
    expect(heldSize({ width: 5584, height: 8368 }, 8192)).toEqual({ width: 5467, height: 8192 });
    expect(heldSize(Q2, 4096)).toEqual({ width: 4096, height: 2733 });
  });
});

describe('editableLimit', () => {
  it('leaves room for the border straighten’s layer transform adds on each side', () => {
    expect(TRANSFORM_BORDER).toBe(2);
    expect(editableLimit(8192)).toBe(8190);
    expect(editableLimit(16384)).toBe(16382);
  });
});

describe('FullSizeLoads', () => {
  it('tries the largest editable size first, then the steps down, all larger than what shows', () => {
    const loads = new FullSizeLoads(8192);
    loads.reset(Q2);
    expect(STEP_DOWN).toEqual([0.75, 0.5]);
    // 8190 · 0.5 = 4095 is no larger than a 4184-pixel working image, so it is left out.
    expect(loads.attempts(4184)).toEqual([
      { width: 8190, height: 5465 },
      { width: 6143, height: 4099 },
    ]);
    expect(loads.attempts(2092)).toEqual([
      { width: 8190, height: 5465 },
      { width: 6143, height: 4099 },
      { width: 4095, height: 2733 },
    ]);
  });

  it('a photo just under the texture limit is still taken in by the border', () => {
    const loads = new FullSizeLoads(8192);
    loads.reset({ width: 8192, height: 5464 });
    expect(loads.best()).toEqual({ width: 8190, height: 5463 });
    loads.reset({ width: 8190, height: 5464 });
    expect(loads.best()).toEqual({ width: 8190, height: 5464 });
  });

  it('a photo that fits is tried at its own size first', () => {
    const loads = new FullSizeLoads(16384);
    loads.reset(Q2);
    expect(loads.attempts(4184)[0]).toEqual(Q2);
    expect(loads.best()).toEqual(Q2);
  });

  it('after a failure, offers only smaller sizes', () => {
    const loads = new FullSizeLoads(8192);
    loads.reset(Q2);
    loads.noteFailed({ width: 8190, height: 5465 });
    expect(loads.attempts(2092)).toEqual([
      { width: 6143, height: 4099 },
      { width: 4095, height: 2733 },
    ]);
    expect(loads.isSettled()).toBe(false);
  });

  it('remembers a load: nothing more is asked for, and says why the photo is smaller', () => {
    const loads = new FullSizeLoads(8192);
    loads.reset(Q2);
    loads.noteLoaded({ width: 8190, height: 5465 });
    expect(loads.isSettled()).toBe(true);
    expect(loads.attempts(4184)).toEqual([]);
    expect(loads.outcome()).toBe('too-large');
  });

  it('remembers giving up: nothing more is asked for, and the outcome says it failed', () => {
    const loads = new FullSizeLoads(8192);
    loads.reset(Q2);
    for (const size of loads.attempts(4184)) loads.noteFailed(size);
    expect(loads.attempts(4184)).toEqual([]);
    loads.noteGaveUp();
    expect(loads.isSettled()).toBe(true);
    expect(loads.outcome()).toBe('failed');
  });

  it('a smaller size after a failure is a step down, even for a photo that fits', () => {
    const loads = new FullSizeLoads(16384);
    loads.reset(Q2);
    loads.noteFailed(Q2);
    loads.noteLoaded({ width: 6276, height: 4188 });
    expect(loads.outcome()).toBe('stepped-down');
  });

  it('a photo that fits and loads at its own size says nothing', () => {
    const loads = new FullSizeLoads(16384);
    loads.reset(Q2);
    loads.noteLoaded(Q2);
    expect(loads.outcome()).toBeNull();
  });

  it('forgets everything for the next photo', () => {
    const loads = new FullSizeLoads(8192);
    loads.reset(Q2);
    loads.noteFailed({ width: 8190, height: 5465 });
    loads.noteGaveUp();
    loads.reset(null);
    expect(loads.isSettled()).toBe(false);
    expect(loads.attempts(100)).toEqual([]);
    loads.setOwn({ width: 4000, height: 3000 });
    expect(loads.attempts(2048)).toEqual([{ width: 4000, height: 3000 }, { width: 3000, height: 2250 }]);
    expect(loads.outcome()).toBeNull();
  });
});

describe('fullSizeNoteText', () => {
  it('says the photo’s own size, the limit and the size it is shown and exported at', () => {
    expect(fullSizeNoteText({ kind: 'too-large', own: Q2, shown: { width: 8190, height: 5465 }, limit: 8190 })).toBe(
      'This photo is 8368 × 5584 pixels, larger than this device’s graphics can edit (8190 on a side), so it is shown and exported at 8190 × 5465.',
    );
    expect(fullSizeNoteText({ kind: 'failed', own: Q2, shown: { width: 4184, height: 2792 }, limit: 8192 })).toContain('could not load this photo');
    expect(fullSizeNoteText({ kind: 'stepped-down', own: Q2, shown: { width: 6144, height: 4100 }, limit: 8192 })).toContain('6144 × 4100');
  });
});

describe('tiles', () => {
  it('are for a photo larger than the GPU can edit, as large as the image that loaded', () => {
    const loads = new FullSizeLoads(8192);
    loads.reset(Q2);
    expect(loads.isTooLarge()).toBe(true);
    expect(loads.tileBudget()).toBeNull();
    loads.noteLoaded({ width: 8190, height: 5465 });
    expect(loads.tileBudget()).toBe(8190 * 5465);
  });

  it('are never for a photo that fits, even one that failed for memory and stepped down', () => {
    const loads = new FullSizeLoads(16384);
    loads.reset(Q2);
    loads.noteFailed(Q2);
    loads.noteLoaded({ width: 6276, height: 4188 });
    expect(loads.outcome()).toBe('stepped-down');
    expect(loads.isTooLarge()).toBe(false);
    expect(loads.tileBudget()).toBeNull();
  });
});
