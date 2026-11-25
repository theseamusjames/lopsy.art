import { describe, expect, it } from 'vitest';
import { DEFAULT_RECIPE, addArea, liveAreas, type Area, type QuarterTurns, type Recipe } from '@lopsy/photos-core/library/recipe';
import { applyChanges as applyRecipeChanges } from '../edit/edit-controls';
import {
  AREA_FLOATS,
  areaValues,
  docAngle,
  docToSource,
  linearAreaLayerKey,
  linearAreaLayerValues,
  linearFromDoc,
  linearToDoc,
  radialFromDoc,
  radialToDoc,
  sourceAngle,
  sourceToDoc,
  type AreaFrame,
} from './areas';

const PLAIN: AreaFrame = { framing: { rotate: 0, flipH: false }, angle: 0, sourceWidth: 600, sourceHeight: 400, cropX: 0, cropY: 0 };

const FRAMES: AreaFrame[] = ([0, 90, 180, 270] as QuarterTurns[]).flatMap((rotate) =>
  [false, true].flatMap((flipH) => [0, 7.5].map((angle) => ({ ...PLAIN, framing: { rotate, flipH }, angle, cropX: 31, cropY: 12 }))),
);

function close(a: { x: number; y: number }, b: { x: number; y: number }) {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
}

describe('point mapping', () => {
  it('maps the source to document pixels with no framing', () => {
    close(sourceToDoc({ x: 0.5, y: 0.25 }, PLAIN), { x: 300, y: 100 });
    close(sourceToDoc({ x: 0.5, y: 0.5 }, { ...PLAIN, cropX: 100, cropY: 50 }), { x: 200, y: 150 });
  });

  it('turns with Rotate: a quarter turn puts the top edge on the right', () => {
    const frame = { ...PLAIN, framing: { rotate: 90 as QuarterTurns, flipH: false } };
    // The framed image is 400 wide and 600 tall.
    close(sourceToDoc({ x: 0.5, y: 0 }, frame), { x: 400, y: 300 });
  });

  it('round-trips for every framing, straighten and crop', () => {
    for (const frame of FRAMES) {
      const p = { x: 0.23, y: 0.71 };
      close(docToSource(sourceToDoc(p, frame), frame), p);
    }
  });
});

describe('ellipse mapping', () => {
  it('keeps the axis where the points go, for every framing', () => {
    for (const frame of FRAMES) {
      const g = { cx: 0.4, cy: 0.6, rx: 0.2, ry: 0.1, angle: 30, feather: 40 };
      const e = radialToDoc(g, frame);
      // The end of the x axis on the source, in source pixels, mapped through the points.
      const t = (g.angle * Math.PI) / 180;
      const endPx = { x: g.cx * 600 + g.rx * 600 * Math.cos(t), y: g.cy * 400 + g.rx * 600 * Math.sin(t) };
      const end = sourceToDoc({ x: endPx.x / 600, y: endPx.y / 400 }, frame);
      const a = (e.angle * Math.PI) / 180;
      // Either end of the axis: an ellipse turned half a turn is the same ellipse.
      const ends = [1, -1].map((k) => ({ x: e.cx + k * e.rx * Math.cos(a), y: e.cy + k * e.rx * Math.sin(a) }));
      expect(Math.min(...ends.map((p) => Math.hypot(p.x - end.x, p.y - end.y)))).toBeLessThan(1e-6);
      const back = radialFromDoc(e, g.feather, frame);
      expect(back.cx).toBeCloseTo(g.cx, 6);
      expect(back.rx).toBeCloseTo(g.rx, 6);
      expect(Math.cos(((back.angle - g.angle) * Math.PI) / 90)).toBeCloseTo(1, 6);
    }
  });

  it('inverts the angle mapping', () => {
    for (const frame of FRAMES) expect(Math.cos(((sourceAngle(docAngle(-150, frame), frame) + 150) * Math.PI) / 90)).toBeCloseTo(1, 6);
  });
});

describe('linear mapping', () => {
  it('round-trips both points', () => {
    const g = { x0: 0.5, y0: 0.1, x1: 0.5, y1: 0.6 };
    for (const frame of FRAMES) {
      const { p0, p1 } = linearToDoc(g, frame);
      const back = linearFromDoc(p0, p1, frame);
      expect(back.x0).toBeCloseTo(g.x0, 6);
      expect(back.y1).toBeCloseTo(g.y1, 6);
    }
  });
});

describe('areaValues', () => {
  it('packs 16 floats per live area in creation order', () => {
    expect(areaValues(DEFAULT_RECIPE, PLAIN)).toBeNull();
    const first = addArea(DEFAULT_RECIPE, 'linear', 'a1', 'Sky');
    if (!first) throw new Error('no area');
    let r: Recipe = applyRecipeChanges(DEFAULT_RECIPE, { ...first.values, 'areas.a1.adjustments.exposure': -1, 'areas.a1.amount': 50 });
    const second = addArea(r, 'radial', 'a2');
    if (!second) throw new Error('no area');
    r = applyRecipeChanges(r, { ...second.values, 'areas.a2.invert': true });
    const out = areaValues(r, PLAIN);
    expect(out?.ids).toEqual(['a1', 'a2']);
    const v = Array.from(out?.values ?? []);
    expect(v).toHaveLength(2 * AREA_FLOATS);
    expect(v.slice(0, 7)).toEqual([0, 0, 0.5, 300, 100, 300, 300]);
    expect(v[9]).toBe(-1);
    expect(v.slice(16, 23)).toEqual([1, 1, 1, 300, 200, 150, 100]);
    expect(v[24]).toBeCloseTo(0.5);
  });
});

describe('linearAreaLayerValues', () => {
  const OPTIONS = { pixelScale: 1, grainSeed: 0, isInteractive: false };

  function areaWith(changes: Record<string, number>): Area {
    const added = addArea(DEFAULT_RECIPE, 'radial', 'a1');
    if (!added) throw new Error('no area');
    const r = applyRecipeChanges(DEFAULT_RECIPE, { ...added.values, ...changes });
    const [area] = liveAreas(r);
    if (!area) throw new Error('no live area');
    return area;
  }

  it('draws no layer for an area with no effects of its own', () => {
    expect(linearAreaLayerValues(areaWith({}), OPTIONS)).toBeNull();
    expect(linearAreaLayerKey(null)).toBe('');
  });

  it('sends whites, blacks, vibrance and the grade as the area look, and curves by their points', () => {
    const area = areaWith({ 'areas.a1.fx.tone.whites': 25, 'areas.a1.fx.colorGrading.global.saturation': 40 });
    const values = linearAreaLayerValues(area, OPTIONS);
    expect(values?.look?.length).toBe(45);
    expect(values?.look?.[0]).toBe(25);
    expect(values?.curvesKey).toBe('');
    expect(values?.curves()).toBeNull();
    expect(Array.from(values?.look?.slice(27) ?? []).some((v) => v !== 0)).toBe(true);
    const before = linearAreaLayerKey(values ?? null);
    const lifted = areaWith({ 'areas.a1.fx.tone.whites': 25, 'areas.a1.fx.colorGrading.global.saturation': 40 });
    expect(linearAreaLayerKey(linearAreaLayerValues(lifted, OPTIONS))).toBe(before);
  });
});
