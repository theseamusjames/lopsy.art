import { describe, it, expect } from 'vitest';
import { getHandlePositions } from '../transform/transform-handles';
import { createTransformState, type TransformState } from '../transform/transform';
import {
  applyDocumentAffine,
  applyDocumentLinear,
  applyMatrix,
  docToLayout,
  FLIP_HORIZONTAL,
  frameCentre,
  frameContains,
  frameCorners,
  IDENTITY_MATRIX,
  invertMatrix,
  isIdentityMatrix,
  isUsableTextMatrix,
  maxScaleOf,
  multiplyMatrix,
  dragTextFrame,
  placementThroughTransform,
  rotationMatrix,
  placementProps,
  rasterScaleFor,
  ROTATE_CCW,
  ROTATE_CW,
  scaleTextPropsJson,
  textAnchorOf,
  textTransformFor,
  transformStateFromFrame,
  type TextFrame,
  type TextMatrix,
} from './text-transform';

function rotation(deg: number): TextMatrix {
  const r = (deg * Math.PI) / 180;
  return { a: Math.cos(r), b: Math.sin(r), c: -Math.sin(r), d: Math.cos(r) };
}

function expectMatrixClose(actual: TextMatrix, expected: TextMatrix): void {
  expect(actual.a).toBeCloseTo(expected.a, 6);
  expect(actual.b).toBeCloseTo(expected.b, 6);
  expect(actual.c).toBeCloseTo(expected.c, 6);
  expect(actual.d).toBeCloseTo(expected.d, 6);
}

const BOX = { x: 0, y: -2, width: 120, height: 40 };

describe('matrix helpers', () => {
  it('multiplies so the right matrix applies first', () => {
    const p = { x: 3, y: 4 };
    const viaProduct = applyMatrix(multiplyMatrix(ROTATE_CW, FLIP_HORIZONTAL), p);
    const stepwise = applyMatrix(ROTATE_CW, applyMatrix(FLIP_HORIZONTAL, p));
    expect(viaProduct).toEqual(stepwise);
  });

  it('inverts a rotation-scale', () => {
    const m = multiplyMatrix(rotation(30), { a: 2, b: 0, c: 0, d: 3 });
    expectMatrixClose(multiplyMatrix(m, invertMatrix(m)!), IDENTITY_MATRIX);
  });

  it('has no inverse for a collapsed matrix', () => {
    expect(invertMatrix({ a: 1, b: 2, c: 2, d: 4 })).toBeNull();
  });

  it('measures the largest stretch', () => {
    expect(maxScaleOf(rotation(47))).toBeCloseTo(1, 6);
    expect(maxScaleOf(multiplyMatrix(rotation(20), { a: 3, b: 0, c: 0, d: 0.5 }))).toBeCloseTo(3, 6);
  });

  it('turns clockwise on screen with y pointing down', () => {
    // A point to the right of the pivot ends up below it.
    expect(applyMatrix(ROTATE_CW, { x: 1, y: 0 })).toEqual({ x: 0, y: 1 });
    expectMatrixClose(multiplyMatrix(ROTATE_CW, ROTATE_CCW), IDENTITY_MATRIX);
  });

  it('rejects collapsed and enormous matrices', () => {
    expect(isUsableTextMatrix(rotation(10))).toBe(true);
    expect(isUsableTextMatrix({ a: 0.00001, b: 0, c: 0, d: 1 })).toBe(false);
    expect(isUsableTextMatrix({ a: 500, b: 0, c: 0, d: 500 })).toBe(false);
    expect(isUsableTextMatrix({ a: Number.NaN, b: 0, c: 0, d: 1 })).toBe(false);
  });

  it('detects identity', () => {
    expect(isIdentityMatrix(IDENTITY_MATRIX)).toBe(true);
    expect(isIdentityMatrix(rotation(1))).toBe(false);
  });
});

describe('raster density', () => {
  it('supersamples upright text twice', () => {
    expect(rasterScaleFor(rotation(33))).toBe(2);
  });

  it('follows the largest stretch so the resample never magnifies', () => {
    expect(rasterScaleFor({ a: 3, b: 0, c: 0, d: 1 })).toBe(6);
    expect(rasterScaleFor({ a: 0.3, b: 0, c: 0, d: 0.3 })).toBe(0.75);
  });

  it('stays within engine-friendly bounds', () => {
    expect(rasterScaleFor({ a: 40, b: 0, c: 0, d: 40 })).toBe(16);
    expect(rasterScaleFor({ a: 0.01, b: 0, c: 0, d: 0.01 })).toBe(0.25);
  });
});

describe('anchors and placement', () => {
  it('stores the anchor relative to the texture so moving the layer carries the text', () => {
    const t = textTransformFor(rotation(15), { x: 105.5, y: 60 }, 90, 40);
    expect(t.anchorX).toBeCloseTo(15.5);
    expect(t.anchorY).toBeCloseTo(20);
    expect(textAnchorOf({ x: 90, y: 40, transform: t })).toEqual({ x: 105.5, y: 60 });
    // A Move drag only changes x/y; the anchor follows.
    expect(textAnchorOf({ x: 190, y: 140, transform: t })).toEqual({ x: 205.5, y: 160 });
  });

  it('has no stored anchor for upright text', () => {
    expect(textAnchorOf({ x: 1, y: 2 })).toBeNull();
  });

  it('copies only layer fields from a placement', () => {
    const p = { x: 1, y: 2, anchorX: 9, anchorY: 9 };
    expect(placementProps(p)).toEqual({ x: 1, y: 2 });
    const t = textTransformFor(IDENTITY_MATRIX, { x: 5, y: 5 }, 1, 2);
    expect(placementProps({ x: 1, y: 2, transform: t })).toEqual({ x: 1, y: 2, transform: t });
  });
});

describe('frames', () => {
  const frame: TextFrame = { anchor: { x: 200, y: 100 }, matrix: ROTATE_CW, box: BOX };

  it('maps box corners through the matrix to the anchor', () => {
    const [tl, tr] = frameCorners(frame);
    expect(tl).toEqual({ x: 202, y: 100 });
    // The top edge runs down the page after a clockwise quarter turn.
    expect(tr).toEqual({ x: 202, y: 220 });
  });

  it('maps a document point back into layout space', () => {
    const local = docToLayout(frame, { x: 180, y: 160 })!;
    expect(local.x).toBeCloseTo(60);
    expect(local.y).toBeCloseTo(20);
  });

  it('contains points on the rotated text but not in the texture corners', () => {
    expect(frameContains(frame, { x: 180, y: 160 }, 0)).toBe(true);
    // Inside the axis-aligned texture box of a 45° layer, but off the text.
    const tilted: TextFrame = { ...frame, matrix: rotation(45) };
    const [tl] = frameCorners(tilted);
    expect(frameContains(tilted, { x: tl.x + 60, y: tl.y - 30 }, 2)).toBe(false);
  });

  it('grows the hit box by the slop in document pixels', () => {
    const scaled: TextFrame = { ...frame, matrix: { a: 2, b: 0, c: 0, d: 2 } };
    // Box spans x 200..440 in the document; 3px beyond the right edge.
    expect(frameContains(scaled, { x: 443, y: 120 }, 2)).toBe(false);
    expect(frameContains(scaled, { x: 443, y: 120 }, 4)).toBe(true);
  });

  it('finds the box centre in the document', () => {
    expect(frameCentre(frame)).toEqual({ x: 182, y: 160 });
  });
});

describe('handle state for drawing', () => {
  const cases: [string, TextMatrix][] = [
    ['upright', IDENTITY_MATRIX],
    ['rotated', rotation(37)],
    ['rotated and stretched', multiplyMatrix(rotation(-120), { a: 1.5, b: 0, c: 0, d: 0.75 })],
    ['flipped', FLIP_HORIZONTAL],
    ['skewed', { a: 1, b: 0, c: 0.4, d: 1 }],
  ];

  for (const [name, matrix] of cases) {
    it(`puts the ${name} handles on the layout box corners`, () => {
      const frame: TextFrame = { anchor: { x: 312.25, y: 87.5 }, matrix, box: BOX };
      const handles = getHandlePositions(transformStateFromFrame(frame));
      const [tl, tr, br, bl] = frameCorners(frame);
      for (const [handle, corner] of [
        [handles['top-left'], tl], [handles['top-right'], tr],
        [handles['bottom-right'], br], [handles['bottom-left'], bl],
      ] as const) {
        expect(handle.x).toBeCloseTo(corner.x, 6);
        expect(handle.y).toBeCloseTo(corner.y, 6);
      }
    });
  }
});

describe('dragTextFrame', () => {
  const free = { mode: 'free', isProportional: false, shouldSnapAngle: false } as const;
  const upright: TextFrame = { anchor: { x: 100, y: 100 }, matrix: IDENTITY_MATRIX, box: BOX };

  function corner(frame: TextFrame, i: number): { x: number; y: number } {
    return frameCorners(frame)[i]!;
  }

  it('stretches from the right edge and keeps the left edge in place', () => {
    const r = dragTextFrame(upright, 'right', { x: 220, y: 118 }, { x: 340, y: 130 }, free)!;
    expectMatrixClose(r.matrix, { a: 2, b: 0, c: 0, d: 1 });
    const after = { ...upright, ...r };
    expect(corner(after, 0).x).toBeCloseTo(corner(upright, 0).x, 6);
  });

  it('scales along the rotated box axis, not the document axis', () => {
    const turned: TextFrame = { ...upright, matrix: ROTATE_CW };
    // The box's right edge now faces down; dragging down 120px doubles the width.
    const [, tr] = frameCorners(turned);
    const r = dragTextFrame(turned, 'right', tr, { x: tr.x, y: tr.y + 120 }, free)!;
    expectMatrixClose(r.matrix, multiplyMatrix(ROTATE_CW, { a: 2, b: 0, c: 0, d: 1 }));
    const [tlAfter] = frameCorners({ ...turned, ...r });
    expect(tlAfter.x).toBeCloseTo(corner(turned, 0).x, 6);
    expect(tlAfter.y).toBeCloseTo(corner(turned, 0).y, 6);
  });

  it('keeps a flipped layer flipped while it is scaled (no collapse)', () => {
    const flipped: TextFrame = { ...upright, matrix: FLIP_HORIZONTAL };
    const [, , br] = frameCorners(flipped);
    const r = dragTextFrame(flipped, 'bottom-right', br, { x: br.x - 60, y: br.y + 20 }, free)!;
    expect(r.matrix.a).toBeCloseTo(-1.5, 6);
    expect(r.matrix.d).toBeCloseTo(1.5, 6);
  });

  it('flips when the edge is dragged past the opposite one', () => {
    const r = dragTextFrame(upright, 'right', { x: 220, y: 118 }, { x: 40, y: 118 }, free)!;
    expect(r.matrix.a).toBeCloseTo(-0.5, 6);
  });

  it('never collapses the box to nothing', () => {
    const r = dragTextFrame(upright, 'right', { x: 220, y: 118 }, { x: 100, y: 118 }, free)!;
    expect(Math.abs(r.matrix.a)).toBeGreaterThan(0);
    expect(isUsableTextMatrix(r.matrix)).toBe(true);
  });

  it('keeps the aspect ratio of a proportional corner drag', () => {
    const r = dragTextFrame(upright, 'bottom-right', { x: 220, y: 138 }, { x: 340, y: 138 }, {
      ...free, isProportional: true,
    })!;
    expect(r.matrix.a).toBeCloseTo(r.matrix.d, 6);
  });

  it('rotates about the box centre and snaps to 15° with ⌘', () => {
    const centre = frameCentre(upright);
    const start = { x: centre.x + 100, y: centre.y };
    const at = (deg: number) => ({
      x: centre.x + 100 * Math.cos((deg * Math.PI) / 180),
      y: centre.y + 100 * Math.sin((deg * Math.PI) / 180),
    });
    const r = dragTextFrame(upright, 'rotate-top-right', start, at(40), free)!;
    expectMatrixClose(r.matrix, rotation(40));
    const after = frameCentre({ ...upright, ...r });
    expect(after.x).toBeCloseTo(centre.x, 6);
    expect(after.y).toBeCloseTo(centre.y, 6);
    const snapped = dragTextFrame(upright, 'rotate-top-right', start, at(40), { ...free, shouldSnapAngle: true })!;
    expectMatrixClose(snapped.matrix, rotation(45));
  });

  it('shears from an edge handle in skew mode and keeps the opposite edge', () => {
    const skew = { ...free, mode: 'skew' } as const;
    const r = dragTextFrame(upright, 'bottom', { x: 160, y: 138 }, { x: 180, y: 138 }, skew)!;
    // Bottom edge slid 20px right over a 40px tall box.
    expectMatrixClose(r.matrix, { a: 1, b: 0, c: 0.5, d: 1 });
    const after = { ...upright, ...r };
    expect(corner(after, 0).x).toBeCloseTo(corner(upright, 0).x, 6);
    expect(corner(after, 1).x).toBeCloseTo(corner(upright, 1).x, 6);
  });

  it('does not compound: each step starts from the frame the drag began with', () => {
    const first = dragTextFrame(upright, 'right', { x: 220, y: 118 }, { x: 280, y: 118 }, free)!;
    const second = dragTextFrame(upright, 'right', { x: 220, y: 118 }, { x: 280, y: 118 }, free)!;
    expect(second).toEqual(first);
  });

  it('builds rotation matrices clockwise on screen', () => {
    expectMatrixClose(rotationMatrix(Math.PI / 2), ROTATE_CW);
  });
});

describe('document-space flips and turns', () => {
  it('flipping twice about the same pivot restores the placement', () => {
    const start = { anchor: { x: 40, y: 70 }, matrix: rotation(25) };
    const pivot = { x: 100, y: 90 };
    const once = applyDocumentLinear(start, FLIP_HORIZONTAL, pivot);
    const twice = applyDocumentLinear(once, FLIP_HORIZONTAL, pivot);
    expectMatrixClose(twice.matrix, start.matrix);
    expect(twice.anchor.x).toBeCloseTo(start.anchor.x, 6);
    expect(twice.anchor.y).toBeCloseTo(start.anchor.y, 6);
  });

  it('mirrors the anchor across the pivot', () => {
    const flipped = applyDocumentLinear({ anchor: { x: 40, y: 70 }, matrix: IDENTITY_MATRIX }, FLIP_HORIZONTAL, { x: 100, y: 0 });
    expect(flipped.anchor).toEqual({ x: 160, y: 70 });
    expectMatrixClose(flipped.matrix, FLIP_HORIZONTAL);
  });
});

describe('scaleTextPropsJson', () => {
  it('scales lengths and leaves ratios and flags alone', () => {
    const props = JSON.stringify({
      text: 'Hi',
      fontSize: 24,
      letterSpacing: 2,
      paragraphSpacing: 5,
      areaWidth: 300,
      lineHeight: 1.4,
      underline: true,
      color: [1, 0, 0, 1],
    });
    const scaled = JSON.parse(scaleTextPropsJson(props, 2)) as Record<string, unknown>;
    expect(scaled).toMatchObject({
      fontSize: 48,
      letterSpacing: 4,
      paragraphSpacing: 10,
      areaWidth: 600,
      lineHeight: 1.4,
      underline: true,
      color: [1, 0, 0, 1],
    });
  });

  it('keeps point text point text', () => {
    const props = JSON.stringify({ text: 'Hi', fontSize: 10, areaWidth: null });
    expect(JSON.parse(scaleTextPropsJson(props, 3))).toMatchObject({ fontSize: 30, areaWidth: null });
  });
});

describe('placing text through a multi-layer transform (#1165)', () => {
  // The shared box over a rectangle at (200, 200)–(600, 400): centre (400, 300).
  const box = { x: 200, y: 200, width: 400, height: 200 };
  const pivot = { x: 400, y: 300 };
  const turn = (deg: number): TransformState => ({ ...createTransformState(box), rotation: (deg * Math.PI) / 180 });
  const docPoint = (pl: { anchor: { x: number; y: number }; matrix: TextMatrix }, p: { x: number; y: number }) => {
    const q = applyMatrix(pl.matrix, p);
    return { x: q.x + pl.anchor.x, y: q.y + pl.anchor.y };
  };
  const rotateAbout = (p: { x: number; y: number }, deg: number) => {
    const q = applyMatrix(rotation(deg), { x: p.x - pivot.x, y: p.y - pivot.y });
    return { x: q.x + pivot.x, y: q.y + pivot.y };
  };

  it('turns upright text about the box centre, not its own', () => {
    const upright = { anchor: { x: 230, y: 260 }, matrix: IDENTITY_MATRIX };
    const placed = placementThroughTransform(upright, turn(15))!;
    expectMatrixClose(placed.matrix, rotation(15));
    const want = rotateAbout(upright.anchor, 15);
    expect(placed.anchor.x).toBeCloseTo(want.x, 6);
    expect(placed.anchor.y).toBeCloseTo(want.y, 6);
  });

  it('composes a second turn with the stored one', () => {
    const upright = { anchor: { x: 230, y: 260 }, matrix: IDENTITY_MATRIX };
    const once = placementThroughTransform(upright, turn(15))!;
    const twice = placementThroughTransform(once, turn(15))!;
    expectMatrixClose(twice.matrix, rotation(30));
    const want = rotateAbout(upright.anchor, 30);
    expect(twice.anchor.x).toBeCloseTo(want.x, 6);
    expect(twice.anchor.y).toBeCloseTo(want.y, 6);
  });

  it('keeps an earlier scale when the box rotates (scale, then rotate)', () => {
    const scaled = { anchor: { x: 250, y: 240 }, matrix: { a: 2, b: 0, c: 0, d: 0.5 } };
    const placed = placementThroughTransform(scaled, turn(90))!;
    // R(90°) · S(2, 0.5): the stretched x axis now points down.
    expectMatrixClose(placed.matrix, { a: 0, b: 2, c: -0.5, d: 0 });
    // Every glyph point lands where the box's turn moves it on the canvas.
    for (const p of [{ x: 0, y: 0 }, { x: 37, y: -12 }, { x: 120, y: 40 }]) {
      const want = rotateAbout(docPoint(scaled, p), 90);
      const got = docPoint(placed, p);
      expect(got.x).toBeCloseTo(want.x, 6);
      expect(got.y).toBeCloseTo(want.y, 6);
    }
  });

  it('carries scale, skew, flip and translation the way the pixels move', () => {
    const start = { anchor: { x: 260, y: 280 }, matrix: rotation(20) };
    const t: TransformState = {
      ...createTransformState(box, 'skew'),
      scaleX: -1.25,
      scaleY: 0.8,
      skewX: 0.2,
      rotation: 0.3,
      translateX: 14,
      translateY: -9,
    };
    const placed = placementThroughTransform(start, t)!;
    const cx = pivot.x;
    const cy = pivot.y;
    const forward = (q: { x: number; y: number }) => {
      // The handle chain: skew, scale, rotate about the centre, then translate.
      let x = q.x - cx;
      let y = q.y - cy;
      x += y * Math.tan(t.skewX);
      x *= t.scaleX;
      y *= t.scaleY;
      const c = Math.cos(t.rotation);
      const s = Math.sin(t.rotation);
      return { x: x * c - y * s + cx + t.translateX, y: x * s + y * c + cy + t.translateY };
    };
    for (const p of [{ x: 0, y: 0 }, { x: 50, y: 10 }, { x: -5, y: 70 }]) {
      const want = forward(docPoint(start, p));
      const got = docPoint(placed, p);
      expect(got.x).toBeCloseTo(want.x, 6);
      expect(got.y).toBeCloseTo(want.y, 6);
    }
  });

  it('matches applyDocumentLinear for a pure linear map about a pivot', () => {
    const start = { anchor: { x: 300, y: 250 }, matrix: rotation(-10) };
    const viaLinear = applyDocumentLinear(start, ROTATE_CW, pivot);
    const viaAffine = applyDocumentAffine(start, {
      ...ROTATE_CW,
      e: pivot.x - (ROTATE_CW.a * pivot.x + ROTATE_CW.c * pivot.y),
      f: pivot.y - (ROTATE_CW.b * pivot.x + ROTATE_CW.d * pivot.y),
    });
    expectMatrixClose(viaAffine.matrix, viaLinear.matrix);
    expect(viaAffine.anchor.x).toBeCloseTo(viaLinear.anchor.x, 6);
    expect(viaAffine.anchor.y).toBeCloseTo(viaLinear.anchor.y, 6);
  });

  it('gives no placement for a corner distortion', () => {
    const t: TransformState = {
      ...createTransformState(box, 'perspective'),
      corners: [{ x: 10, y: 0 }, { x: -10, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }],
    };
    expect(placementThroughTransform({ anchor: { x: 0, y: 0 }, matrix: IDENTITY_MATRIX }, t)).toBeNull();
  });
});
