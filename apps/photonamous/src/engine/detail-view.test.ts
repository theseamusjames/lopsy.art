import { describe, expect, it } from 'vitest';
import { contains, detailTile, KEPT_MARGIN, magnifiesHeld, ownViewport, visibleRect } from './detail-view';

const view = (zoom: number, panX = 0, panY = 0) => ({ zoom, panX, panY, isFit: false });

describe('ownViewport', () => {
  it('is the view at the photo’s own size: zoom times the pixel scale, the same pan, in device pixels', () => {
    expect(ownViewport(view(2, 10, -4), 2, 0.5)).toEqual({ zoom: 2, panX: 20, panY: -8 });
  });

  it('takes a zoom a rounding away from a whole number as that number, so 100 % is exactly 1', () => {
    const pixelScale = 8190 / 8368;
    expect(ownViewport(view(1 / pixelScale), 1, pixelScale).zoom).toBe(1);
    expect(ownViewport(view(1.5), 1, 1).zoom).toBe(1.5);
  });
});

describe('magnifiesHeld', () => {
  it('is more than one device pixel to each held pixel', () => {
    expect(magnifiesHeld(view(1), 1)).toBe(false);
    expect(magnifiesHeld(view(1.02), 1)).toBe(true);
    expect(magnifiesHeld(view(0.6), 2)).toBe(true);
  });
});

describe('visibleRect', () => {
  const document = { width: 8000, height: 6000 };
  it('is the part of the document under the canvas, as the final blit maps it, rounded out', () => {
    // At 1:1, centred: the canvas's size about the document's centre.
    expect(visibleRect({ zoom: 1, panX: 0, panY: 0 }, { width: 1000, height: 800 }, document)).toEqual({ x: 3500, y: 2600, width: 1000, height: 800 });
    // Panned right by 100 device pixels: the document moves right, so more of its left shows.
    expect(visibleRect({ zoom: 2, panX: 100, panY: 0 }, { width: 1000, height: 800 }, document)).toEqual({ x: 3700, y: 2800, width: 500, height: 400 });
  });

  it('is clipped to the document, and null when none of it shows', () => {
    expect(visibleRect({ zoom: 1, panX: 3800, panY: 0 }, { width: 1000, height: 800 }, document)).toEqual({ x: 0, y: 2600, width: 700, height: 800 });
    expect(visibleRect({ zoom: 1, panX: 9000, panY: 0 }, { width: 1000, height: 800 }, document)).toBeNull();
  });
});

describe('detailTile', () => {
  const document = { width: 8000, height: 6000 };
  const visible = { x: 3501, y: 2601, width: 1000, height: 800 };
  const any = () => true;

  it('keeps a quarter of the visible size on each side, on even pixels, and adds the apron', () => {
    const tile = detailTile(visible, document, 30, any);
    expect(tile?.kept).toEqual({ x: 3250, y: 2400, width: 1502, height: 1202 });
    expect(tile?.rect).toEqual({ x: 3220, y: 2370, width: 1562, height: 1262 });
    expect(contains(tile?.kept ?? visible, visible)).toBe(true);
    expect((tile?.kept.width ?? 0) * (tile?.kept.height ?? 0)).toBeLessThanOrEqual(2.26 * visible.width * visible.height);
    expect(KEPT_MARGIN).toBe(0.25);
  });

  it('shrinks the margin to fit, and gives up when the visible part with its apron does not', () => {
    const tile = detailTile(visible, document, 30, (w, h) => w <= 1300 && h <= 1100);
    expect(tile).not.toBeNull();
    expect(contains(tile?.kept ?? visible, visible)).toBe(true);
    expect(tile?.rect.width).toBeLessThanOrEqual(1300);
    expect(detailTile(visible, document, 30, (w) => w < 1000)).toBeNull();
  });

  it('stays within the document at its edges', () => {
    const tile = detailTile({ x: 0, y: 0, width: 500, height: 400 }, document, 100, any);
    expect(tile?.kept.x).toBe(0);
    expect(tile?.rect.x).toBe(0);
    expect(tile?.rect.width).toBe(626 + 100);
  });
});
