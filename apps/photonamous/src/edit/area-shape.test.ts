import { describe, expect, it } from 'vitest';
import { DEFAULT_RECIPE, addArea, liveAreas, type Area, type QuarterTurns } from '@lopsy/photos-core/library/recipe';
import type { AreaFrame } from '../engine/areas';
import { applyChanges } from './edit-controls';
import { formatShape, parseShape, shapeControls, shapeValue, withShapeValue, type AreaShapeKey } from './area-shape';

const PLAIN: AreaFrame = { framing: { rotate: 0, flipH: false }, angle: 0, sourceWidth: 600, sourceHeight: 400, cropX: 0, cropY: 0 };
const DOC = { width: 600, height: 400 };

function newArea(kind: 'linear' | 'radial'): Area {
  const added = addArea(DEFAULT_RECIPE, kind, kind === 'linear' ? 'l1' : 'r1');
  if (!added) throw new Error('no area');
  const [area] = liveAreas(applyChanges(DEFAULT_RECIPE, added.values));
  if (!area) throw new Error('no area');
  return area;
}

function withGeometry(area: Area, geometry: ReturnType<typeof withShapeValue>): Area {
  return { ...area, geometry } as Area;
}

describe('shapeValue', () => {
  it('reads a new linear area as a gradient down the middle of the photo', () => {
    const area = newArea('linear');
    const values = shapeControls(area).map((c) => shapeValue(area, PLAIN, DOC, c.key));
    expect(values.map((v) => Math.round(v))).toEqual([50, 25, 50, 75]);
  });

  it('reads a new radial area as half the photo across, unturned, half feathered', () => {
    const area = newArea('radial');
    const values = shapeControls(area).map((c) => shapeValue(area, PLAIN, DOC, c.key));
    expect(values.map((v) => Math.round(v))).toEqual([50, 50, 50, 50, 0, 50]);
  });

  it('reads the photo as it shows: a quarter turn puts the centre where it is on screen', () => {
    const area = newArea('radial');
    const moved = withGeometry(area, { ...(area.geometry as { cx: number }), cx: 0.25 } as ReturnType<typeof withShapeValue>);
    const turned: AreaFrame = { ...PLAIN, framing: { rotate: 90 as QuarterTurns, flipH: false } };
    // Turned clockwise, the source's left quarter is the top quarter of a 400×600 photo.
    expect(shapeValue(moved, turned, { width: 400, height: 600 }, 'centerY')).toBeCloseTo(25);
    expect(shapeValue(moved, turned, { width: 400, height: 600 }, 'centerX')).toBeCloseTo(50);
  });
});

describe('withShapeValue', () => {
  const frames: AreaFrame[] = ([0, 90, 180, 270] as QuarterTurns[]).flatMap((rotate) =>
    [false, true].map((flipH) => ({ ...PLAIN, framing: { rotate, flipH }, angle: 7.5, cropX: 31, cropY: 12 })),
  );

  it('sets one value and leaves the others, whatever the framing', () => {
    for (const kind of ['linear', 'radial'] as const) {
      const area = newArea(kind);
      for (const frame of frames) {
        for (const control of shapeControls(area)) {
          const before = shapeControls(area).map((c) => shapeValue(area, frame, DOC, c.key));
          const target = control.key === 'turn' ? 30 : control.key === 'feather' ? 80 : 40;
          const next = withShapeValue(area, frame, DOC, control.key, target);
          const after = withGeometry(area, next);
          shapeControls(area).forEach((c, i) => {
            const want = c.key === control.key ? target : (before[i] ?? 0);
            expect(shapeValue(after, frame, DOC, c.key), `${kind} ${control.key} → ${c.key}`).toBeCloseTo(want, 6);
          });
        }
      }
    }
  });

  it('keeps a linear area whose ends would meet', () => {
    // The start is at (50 %, 25 %): an end moved onto it is refused.
    const area = newArea('linear');
    expect(withShapeValue(area, PLAIN, DOC, 'endY', 25)).toBe(area.geometry);
    const set = (key: AreaShapeKey, value: number, a: Area) => withGeometry(a, withShapeValue(a, PLAIN, DOC, key, value));
    expect(shapeValue(set('endY', 26, area), PLAIN, DOC, 'endY')).toBeCloseTo(26);
  });

  it('keeps the feather whole and in range', () => {
    const area = newArea('radial');
    expect((withShapeValue(area, PLAIN, DOC, 'feather', 140.4) as { feather: number }).feather).toBe(100);
    expect((withShapeValue(area, PLAIN, DOC, 'feather', 12.6) as { feather: number }).feather).toBe(13);
  });
});

describe('formatShape and parseShape', () => {
  it('shows percent and degrees, with a true minus', () => {
    expect(formatShape(49.6, 'percent')).toBe('50 %');
    expect(formatShape(-15.2, 'degrees')).toBe('−15°');
    expect(formatShape(-0.2, 'degrees')).toBe('0°');
  });

  it('reads typed numbers with or without their unit', () => {
    expect(parseShape('40')).toBe(40);
    expect(parseShape(' 40 % ')).toBe(40);
    expect(parseShape('−15°')).toBe(-15);
    expect(parseShape('12,5')).toBe(12.5);
    expect(parseShape('wide')).toBeNull();
    expect(parseShape('')).toBeNull();
  });
});
