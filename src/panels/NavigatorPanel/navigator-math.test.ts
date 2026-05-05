import { describe, it, expect } from 'vitest';
import {
  computeViewportRect,
  thumbnailPointToDocPoint,
  docPointToPan,
} from './navigator-math';

describe('computeViewportRect', () => {
  it('fills the entire thumbnail when zoom=1 and viewport equals doc', () => {
    const rect = computeViewportRect(400, 300, 400, 300, 1, 0, 0, 200, 150);
    expect(rect.x).toBeCloseTo(0);
    expect(rect.y).toBeCloseTo(0);
    expect(rect.width).toBeCloseTo(200);
    expect(rect.height).toBeCloseTo(150);
  });

  it('produces a smaller rect when zoomed in 2x', () => {
    // At zoom=2, only half the doc is visible
    const rect = computeViewportRect(400, 300, 400, 300, 2, 0, 0, 200, 150);
    expect(rect.width).toBeCloseTo(100);
    expect(rect.height).toBeCloseTo(75);
    // Centred when pan is 0
    expect(rect.x).toBeCloseTo(50);
    expect(rect.y).toBeCloseTo(37.5);
  });

  it('produces a larger rect when zoomed out 0.5x', () => {
    const rect = computeViewportRect(400, 300, 400, 300, 0.5, 0, 0, 200, 150);
    // Viewport sees 2× the doc size
    expect(rect.width).toBeCloseTo(400);
    expect(rect.height).toBeCloseTo(300);
  });

  it('shifts the rect left when panX is positive', () => {
    // positive panX = doc shifted right on screen → visible region is left of doc
    const rect = computeViewportRect(400, 300, 400, 300, 1, 100, 0, 200, 150);
    // docLeft = 400/2 - (400/2 + 100)/1 = 200 - 300 = -100 → thumb x = -100 * (200/400) = -50
    expect(rect.x).toBeCloseTo(-50);
  });

  it('shifts the rect up when panY is positive', () => {
    const rect = computeViewportRect(400, 300, 400, 300, 1, 0, 60, 200, 150);
    // docTop = 300/2 - (300/2 + 60)/1 = 150 - 210 = -60 → thumb y = -60 * (150/300) = -30
    expect(rect.y).toBeCloseTo(-30);
  });

  it('returns full thumbnail when doc dimensions are zero', () => {
    const rect = computeViewportRect(0, 0, 400, 300, 1, 0, 0, 200, 150);
    expect(rect.x).toBe(0);
    expect(rect.y).toBe(0);
    expect(rect.width).toBe(200);
    expect(rect.height).toBe(150);
  });

  it('returns full thumbnail when thumbnail dimensions are zero', () => {
    const rect = computeViewportRect(400, 300, 400, 300, 1, 0, 0, 0, 0);
    expect(rect.x).toBe(0);
    expect(rect.y).toBe(0);
    expect(rect.width).toBe(0);
    expect(rect.height).toBe(0);
  });

  it('scales proportionally with different thumbnail sizes', () => {
    const small = computeViewportRect(400, 300, 400, 300, 2, 0, 0, 100, 75);
    const large = computeViewportRect(400, 300, 400, 300, 2, 0, 0, 200, 150);
    // Width ratio should match thumbnail size ratio
    expect(large.width / small.width).toBeCloseTo(2);
    expect(large.height / small.height).toBeCloseTo(2);
  });
});

describe('thumbnailPointToDocPoint', () => {
  it('maps top-left thumbnail to top-left doc', () => {
    const { docX, docY } = thumbnailPointToDocPoint(0, 0, 400, 300, 200, 150);
    expect(docX).toBeCloseTo(0);
    expect(docY).toBeCloseTo(0);
  });

  it('maps centre thumbnail to centre doc', () => {
    const { docX, docY } = thumbnailPointToDocPoint(100, 75, 400, 300, 200, 150);
    expect(docX).toBeCloseTo(200);
    expect(docY).toBeCloseTo(150);
  });

  it('maps bottom-right thumbnail to bottom-right doc', () => {
    const { docX, docY } = thumbnailPointToDocPoint(200, 150, 400, 300, 200, 150);
    expect(docX).toBeCloseTo(400);
    expect(docY).toBeCloseTo(300);
  });

  it('returns doc centre when thumbnail dimensions are zero', () => {
    const { docX, docY } = thumbnailPointToDocPoint(0, 0, 400, 300, 0, 0);
    expect(docX).toBeCloseTo(200);
    expect(docY).toBeCloseTo(150);
  });
});

describe('docPointToPan', () => {
  it('returns zero pan when centred on the doc centre at zoom 1', () => {
    const { panX, panY } = docPointToPan(200, 150, 400, 300, 1);
    expect(panX).toBeCloseTo(0);
    expect(panY).toBeCloseTo(0);
  });

  it('returns negative panX when focusing right of centre', () => {
    // doc centre at x=300 → docX - docW/2 = 100 → panX = -100 * zoom
    const { panX } = docPointToPan(300, 150, 400, 300, 1);
    expect(panX).toBeCloseTo(-100);
  });

  it('scales pan by zoom', () => {
    const { panX } = docPointToPan(300, 150, 400, 300, 2);
    expect(panX).toBeCloseTo(-200);
  });

  it('is the inverse of computeViewportRect for centre position', () => {
    const docWidth = 400;
    const docHeight = 300;
    const viewportWidth = 400;
    const viewportHeight = 300;
    const zoom = 2;
    // Focus on doc centre (200, 150) — pan should be (0, 0)
    const { panX, panY } = docPointToPan(200, 150, docWidth, docHeight, zoom);
    expect(panX).toBeCloseTo(0);
    expect(panY).toBeCloseTo(0);

    const rect = computeViewportRect(
      docWidth, docHeight, viewportWidth, viewportHeight, zoom, panX, panY, 200, 150,
    );

    // The doc centre (200, 150) should be in the centre of the viewport rect in thumbnail space
    const thumbCentreX = rect.x + rect.width / 2;
    const thumbCentreY = rect.y + rect.height / 2;
    // doc centre = 200/400 * 200 = 100 (thumb x), 150/300 * 150 = 75 (thumb y)
    expect(thumbCentreX).toBeCloseTo((200 / docWidth) * 200);
    expect(thumbCentreY).toBeCloseTo((150 / docHeight) * 150);
  });
});
