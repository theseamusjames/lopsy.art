import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BAR_DRAG_THRESHOLD,
  BAR_LARGE_STEP,
  BAR_MARGIN,
  BAR_PLACE_KEY,
  BAR_STEP,
  barOffset,
  isBarDrag,
  isBarHigh,
  loadBarPlace,
  otherEnd,
  parseBarPlace,
  placeAfterKey,
  placeAt,
  saveBarPlace,
} from './crop-bar';

const stage = { width: 1000, height: 700 };
const bar = { width: 400, height: 100 };
// The room left around the bar, inside the margins.
const roomX = stage.width - bar.width - 2 * BAR_MARGIN;
const roomY = stage.height - bar.height - 2 * BAR_MARGIN;

describe('barOffset and placeAt', () => {
  it('put the corners of the room at the stage margins', () => {
    expect(barOffset({ x: 0, y: 0 }, stage, bar)).toEqual({ left: BAR_MARGIN, top: BAR_MARGIN });
    expect(barOffset({ x: 1, y: 1 }, stage, bar)).toEqual({ left: BAR_MARGIN + roomX, top: BAR_MARGIN + roomY });
  });

  it('give back the place they were given', () => {
    const at = barOffset({ x: 0.25, y: 0.8 }, stage, bar);
    const place = placeAt(at.left, at.top, stage, bar);
    expect(place.x).toBeCloseTo(0.25);
    expect(place.y).toBeCloseTo(0.8);
  });

  it('keep a bar dragged past an edge inside the stage', () => {
    expect(placeAt(-500, 5000, stage, bar)).toEqual({ x: 0, y: 1 });
    expect(barOffset({ x: -3, y: 9 }, stage, bar)).toEqual({ left: BAR_MARGIN, top: BAR_MARGIN + roomY });
  });

  it('keep a corner in its corner when the stage changes size', () => {
    const corner = placeAt(10_000, 10_000, stage, bar);
    expect(barOffset(corner, { width: 600, height: 400 }, bar)).toEqual({ left: 600 - bar.width - BAR_MARGIN, top: 400 - bar.height - BAR_MARGIN });
  });

  it('keep a bar in the middle of a stage that leaves it no room', () => {
    expect(placeAt(0, 0, { width: 300, height: 90 }, bar)).toEqual({ x: 0.5, y: 0.5 });
    expect(barOffset({ x: 1, y: 1 }, { width: 300, height: 90 }, bar)).toEqual({ left: BAR_MARGIN, top: BAR_MARGIN });
  });
});

describe('isBarDrag', () => {
  it('takes a press that moves less than the threshold for a click', () => {
    expect(isBarDrag(0, 0)).toBe(false);
    expect(isBarDrag(2, -2)).toBe(false);
    expect(isBarDrag(BAR_DRAG_THRESHOLD, 0)).toBe(true);
    expect(isBarDrag(0, -40)).toBe(true);
  });
});

describe('placeAfterKey', () => {
  const middle = { x: 0.5, y: 0.5 };

  it('moves the bar ten pixels an arrow, fifty with Shift', () => {
    const start = barOffset(middle, stage, bar);
    const moved = (key: string, isLarge: boolean) => {
      const place = placeAfterKey(middle, key, isLarge, stage, bar);
      if (!place) throw new Error(`${key} moved nothing`);
      return barOffset(place, stage, bar);
    };
    expect(moved('ArrowRight', false).left - start.left).toBeCloseTo(BAR_STEP);
    expect(moved('ArrowLeft', false).left - start.left).toBeCloseTo(-BAR_STEP);
    expect(moved('ArrowDown', false).top - start.top).toBeCloseTo(BAR_STEP);
    expect(start.top - moved('ArrowUp', true).top).toBeCloseTo(BAR_LARGE_STEP);
    expect(moved('ArrowUp', true).left).toBeCloseTo(start.left);
  });

  it('stops at the edges', () => {
    expect(placeAfterKey({ x: 0, y: 1 }, 'ArrowLeft', true, stage, bar)).toEqual({ x: 0, y: 1 });
    expect(placeAfterKey({ x: 0, y: 1 }, 'ArrowDown', false, stage, bar)).toEqual({ x: 0, y: 1 });
  });

  it('leaves other keys alone', () => {
    for (const key of ['Enter', ' ', 'Home', 'PageUp', 'Tab', 'Escape']) {
      expect(placeAfterKey(middle, key, false, stage, bar)).toBeNull();
    }
  });
});

describe('otherEnd', () => {
  it('sends a bar in the lower half to the top, and one in the upper half to the bottom, keeping its side', () => {
    expect(otherEnd({ x: 0.2, y: 0.9 })).toEqual({ x: 0.2, y: 0 });
    expect(otherEnd({ x: 0.7, y: 0 })).toEqual({ x: 0.7, y: 1 });
    expect(otherEnd({ x: 0.5, y: 0.5 })).toEqual({ x: 0.5, y: 0 });
  });

  it('agrees with isBarHigh, which names where a click sends the bar', () => {
    for (const y of [0, 0.3, 0.49, 0.5, 0.8, 1]) {
      expect(otherEnd({ x: 0.5, y }).y).toBe(isBarHigh({ x: 0.5, y }) ? 1 : 0);
    }
  });
});

describe('parseBarPlace', () => {
  it('reads a stored place and clamps it', () => {
    expect(parseBarPlace('{"x":0.3,"y":0.6}')).toEqual({ x: 0.3, y: 0.6 });
    expect(parseBarPlace('{"x":-2,"y":7}')).toEqual({ x: 0, y: 1 });
  });

  it('takes anything else for no place', () => {
    for (const raw of [null, '', 'top', '{', '[]', '{"x":"1","y":0}', '{"x":0}', 'null', '{"x":null,"y":1}', '{"x":1e999,"y":0}']) {
      expect(parseBarPlace(raw)).toBeNull();
    }
  });
});

describe('loadBarPlace and saveBarPlace', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
    const items = new Map<string, string>();
    return {
      getItem: (key) => items.get(key) ?? null,
      setItem: (key, value) => {
        items.set(key, value);
      },
    };
  }

  it('remember a place on this device', () => {
    const storage = memoryStorage();
    vi.stubGlobal('localStorage', storage);
    expect(loadBarPlace()).toBeNull();
    saveBarPlace({ x: 1, y: 0.25 });
    expect(storage.getItem(BAR_PLACE_KEY)).toBe('{"x":1,"y":0.25}');
    expect(loadBarPlace()).toEqual({ x: 1, y: 0.25 });
  });

  it('ignore a corrupt value', () => {
    const storage = memoryStorage();
    storage.setItem(BAR_PLACE_KEY, '{"x":');
    vi.stubGlobal('localStorage', storage);
    expect(loadBarPlace()).toBeNull();
  });

  it('do without storage that is blocked', () => {
    const blocked = () => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    };
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked });
    expect(loadBarPlace()).toBeNull();
    expect(() => saveBarPlace({ x: 0, y: 0 })).not.toThrow();
  });
});
