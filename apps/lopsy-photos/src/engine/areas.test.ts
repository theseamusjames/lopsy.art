import { describe, expect, it } from 'vitest';
import type { Area } from '@lopsy/photos-core/library/recipe';
import {
  AREA_STRIDE,
  areaFloats,
  documentToSource,
  ellipseFromDocument,
  ellipseToDocument,
  lineFromDocument,
  lineToDocument,
  sourceToDocument,
  type AreaFrame,
} from './areas';

const W = 400;
const H = 200;

function frame(over: Partial<AreaFrame> = {}): AreaFrame {
  return { sourceWidth: W, sourceHeight: H, framing: { rotate: 0, flipH: false }, angle: 0, cropX: 0, cropY: 0, ...over };
}

function close(p: { x: number; y: number }, x: number, y: number) {
  expect(p.x).toBeCloseTo(x, 6);
  expect(p.y).toBeCloseTo(y, 6);
}

describe('sourceToDocument', () => {
  it('scales to pixels with no framing', () => {
    close(sourceToDocument(0.25, 0.5, frame()), 100, 100);
  });

  it('follows a quarter turn clockwise (the image becomes 200 x 400)', () => {
    // The top-left corner of the source goes to the top-right of the turned image.
    close(sourceToDocument(0, 0, frame({ framing: { rotate: 90, flipH: false } })), 200, 0);
    close(sourceToDocument(1, 0, frame({ framing: { rotate: 90, flipH: false } })), 200, 400);
    close(sourceToDocument(0, 0, frame({ framing: { rotate: 180, flipH: false } })), 400, 200);
    close(sourceToDocument(0, 0, frame({ framing: { rotate: 270, flipH: false } })), 0, 400);
  });

  it('mirrors after turning', () => {
    close(sourceToDocument(0.25, 0.5, frame({ framing: { rotate: 0, flipH: true } })), 300, 100);
    close(sourceToDocument(0, 0, frame({ framing: { rotate: 90, flipH: true } })), 0, 0);
  });

  it('turns about the centre for straighten, clockwise on screen', () => {
    // A point right of centre moves down for a positive angle.
    const p = sourceToDocument(0.75, 0.5, frame({ angle: 90 }));
    close(p, 200, 200);
  });

  it('subtracts the crop origin', () => {
    close(sourceToDocument(0.5, 0.5, frame({ cropX: 50, cropY: 20 })), 150, 80);
  });

  it('round-trips through documentToSource under every framing', () => {
    for (const rotate of [0, 90, 180, 270] as const) {
      for (const flipH of [false, true]) {
        const f = frame({ framing: { rotate, flipH }, angle: 12.5, cropX: 30, cropY: -10 });
        const d = sourceToDocument(0.3, 0.8, f);
        close(documentToSource(d.x, d.y, f), 0.3, 0.8);
      }
    }
  });
});

describe('areas in document pixels', () => {
  it('maps a line and back', () => {
    const f = frame({ framing: { rotate: 90, flipH: false }, cropX: 10, cropY: 5 });
    const line = { x0: 0.5, y0: 0.1, x1: 0.5, y1: 0.6 };
    const { a, b } = lineToDocument(line, f);
    const back = lineFromDocument(a, b, f);
    expect(back.x0).toBeCloseTo(0.5, 6);
    expect(back.y0).toBeCloseTo(0.1, 6);
    expect(back.x1).toBeCloseTo(0.5, 6);
    expect(back.y1).toBeCloseTo(0.6, 6);
  });

  it('turns an ellipse with the image: radii stay, rotation follows', () => {
    const g = { cx: 0.5, cy: 0.5, rx: 0.25, ry: 0.1, angle: 0, feather: 40 };
    const plain = ellipseToDocument(g, frame());
    expect(plain).toMatchObject({ cx: 200, cy: 100 });
    expect(plain.rx).toBeCloseTo(100, 6);
    expect(plain.ry).toBeCloseTo(20, 6);
    expect(plain.rotation).toBeCloseTo(0, 6);
    const turned = ellipseToDocument(g, frame({ framing: { rotate: 90, flipH: false } }));
    expect(turned.rx).toBeCloseTo(100, 6);
    expect(turned.rotation).toBeCloseTo(Math.PI / 2, 6);
    const straightened = ellipseToDocument({ ...g, angle: 10 }, frame({ angle: 5 }));
    expect((straightened.rotation * 180) / Math.PI).toBeCloseTo(15, 6);
  });

  it('round-trips an ellipse under a mirror and a straighten', () => {
    const f = frame({ framing: { rotate: 270, flipH: true }, angle: -7, cropX: 12, cropY: 3 });
    const g = { cx: 0.4, cy: 0.3, rx: 0.2, ry: 0.15, angle: 30, feather: 60 };
    const back = ellipseFromDocument(ellipseToDocument(g, f), 60, f);
    expect(back.cx).toBeCloseTo(0.4, 6);
    expect(back.cy).toBeCloseTo(0.3, 6);
    expect(back.rx).toBeCloseTo(0.2, 6);
    expect(back.ry).toBeCloseTo(0.15, 6);
    expect(Math.abs(((back.angle - 30 + 540) % 180) - 0) < 0.11 || Math.abs(((back.angle - 30 + 540) % 180) - 180) < 0.11).toBe(true);
  });

  it('packs 16 floats per area in the engine layout', () => {
    const adjustments = { exposure: -1, contrast: 10, highlights: 0, shadows: 0, temperature: 5, tint: 0, saturation: -20, localContrast: 50 };
    const linear: Area = { id: 'a', kind: 'linear', invert: false, amount: 50, name: '', adjustments, geometry: { x0: 0.5, y0: 0, x1: 0.5, y1: 0.5 } };
    const radial: Area = {
      id: 'b',
      kind: 'radial',
      invert: true,
      amount: 100,
      name: '',
      adjustments,
      geometry: { cx: 0.5, cy: 0.5, rx: 0.25, ry: 0.5, angle: 0, feather: 25 },
    };
    const floats = areaFloats([linear, radial], frame());
    expect(floats).toHaveLength(2 * AREA_STRIDE);
    expect(Array.from(floats.slice(0, 9))).toEqual([0, 0, 0.5, 200, 0, 200, 100, 0, 0]);
    expect(Array.from(floats.slice(9, 16))).toEqual([-1, 10, 0, 0, 5, 0, -20]);
    expect(Array.from(floats.slice(16, 25))).toEqual([1, 1, 1, 200, 100, 100, 100, 0, 0.25]);
  });
});
