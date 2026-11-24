import { describe, expect, it } from 'vitest';
import { DEFAULT_RECIPE, addArea, liveAreas } from '@lopsy/photos-core/library/recipe';
import { applyChanges } from './edit-controls';
import { MIN_RADIUS, areaLabel, dragLinear, dragRadial, ellipseAxes, hasAreaEffects, isAreaInUse } from './area-edit';

describe('dragLinear', () => {
  const start = { p0: { x: 10, y: 10 }, p1: { x: 10, y: 50 } };

  it('moves the pair or one end', () => {
    expect(dragLinear(start, 'move', { x: 0, y: 0 }, { x: 5, y: -3 })).toEqual({ p0: { x: 15, y: 7 }, p1: { x: 15, y: 47 } });
    expect(dragLinear(start, 'end', { x: 0, y: 0 }, { x: 30, y: 40 })).toEqual({ p0: { x: 10, y: 10 }, p1: { x: 30, y: 40 } });
    expect(dragLinear(start, 'start', { x: 0, y: 0 }, { x: 1, y: 2 }).p0).toEqual({ x: 1, y: 2 });
  });
});

describe('dragRadial', () => {
  const start = { ellipse: { cx: 100, cy: 100, rx: 40, ry: 20, angle: 90 }, feather: 50 };

  it('sets each radius along its own axis', () => {
    // At 90° the x axis points down.
    expect(dragRadial(start, 'radiusX', { x: 0, y: 0 }, { x: 105, y: 160 }).ellipse.rx).toBeCloseTo(60);
    expect(dragRadial(start, 'radiusY', { x: 0, y: 0 }, { x: 70, y: 100 }).ellipse.ry).toBeCloseTo(30);
    expect(dragRadial(start, 'radiusY', { x: 0, y: 0 }, { x: 100, y: 100 }).ellipse.ry).toBe(MIN_RADIUS);
  });

  it('turns, moves and feathers', () => {
    expect(dragRadial(start, 'rotate', { x: 0, y: 0 }, { x: 200, y: 100 }).ellipse.angle).toBeCloseTo(0);
    expect(dragRadial(start, 'move', { x: 0, y: 0 }, { x: 3, y: 4 }).ellipse.cx).toBe(103);
    // Halfway along the y axis: half the radius feathered.
    expect(dragRadial(start, 'feather', { x: 0, y: 0 }, { x: 90, y: 100 }).feather).toBe(50);
    expect(dragRadial(start, 'feather', { x: 0, y: 0 }, { x: 100, y: 100 }).feather).toBe(100);
  });

  it('gives perpendicular unit axes', () => {
    const { u, v } = ellipseAxes(start.ellipse);
    expect(u.x * v.x + u.y * v.y).toBeCloseTo(0);
    expect(Math.hypot(u.x, u.y)).toBeCloseTo(1);
  });
});

describe('areaLabel', () => {
  it('uses the name, or the place in the list as a mask', () => {
    const added = addArea(DEFAULT_RECIPE, 'radial', 'r1');
    if (!added) throw new Error('no area');
    const [area] = liveAreas(applyChanges(DEFAULT_RECIPE, added.values));
    if (!area) throw new Error('no area');
    expect(areaLabel(area, 1)).toBe('Mask 2');
    expect(areaLabel({ ...area, name: 'Sky' }, 0)).toBe('Sky');
  });
});

describe('isAreaInUse', () => {
  const added = addArea(DEFAULT_RECIPE, 'radial', 'r1');
  const recipe = applyChanges(DEFAULT_RECIPE, { ...(added?.values ?? {}), 'areas.r1.adjustments.temperature': 40 });
  const [area] = liveAreas(recipe);
  if (!area) throw new Error('no area');

  it('calls a mask in use once an adjustment is off zero', () => {
    expect(isAreaInUse(area)).toBe(true);
    const still = { ...area, adjustments: { ...area.adjustments, temperature: 0 } };
    expect(isAreaInUse(still)).toBe(false);
    // Or once an effect of its own does something: its colour grading, here.
    expect(hasAreaEffects(still)).toBe(false);
    const graded = { ...still, effects: { ...still.effects, colorGrading: { ...still.effects.colorGrading, global: { hue: 30, saturation: 20, luminance: 0 } } } };
    expect(hasAreaEffects(graded)).toBe(true);
    expect(isAreaInUse(graded)).toBe(true);
  });
});
