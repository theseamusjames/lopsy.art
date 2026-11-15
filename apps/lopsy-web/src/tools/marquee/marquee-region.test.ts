import { describe, it, expect } from 'vitest';
import { regionFromCorners, defaultMarqueeCorners, DEFAULT_REGION_SIZE } from './marquee-region';

describe('regionFromCorners', () => {
  it('treats To as exclusive, matching a drag', () => {
    expect(regionFromCorners({ x: 10, y: 10 }, { x: 110, y: 60 })).toEqual({
      x: 10, y: 10, width: 100, height: 50,
    });
  });

  it('normalizes corners given in reverse order', () => {
    expect(regionFromCorners({ x: 110, y: 60 }, { x: 10, y: 10 })).toEqual({
      x: 10, y: 10, width: 100, height: 50,
    });
  });

  it('normalizes mixed-direction corners', () => {
    expect(regionFromCorners({ x: 50, y: 5 }, { x: 20, y: 25 })).toEqual({
      x: 20, y: 5, width: 30, height: 20,
    });
  });

  it('rounds fractional coordinates to whole pixels', () => {
    expect(regionFromCorners({ x: 10.4, y: 9.6 }, { x: 20.5, y: 20.2 })).toEqual({
      x: 10, y: 10, width: 11, height: 10,
    });
  });

  it('allows corners outside the document', () => {
    expect(regionFromCorners({ x: -20, y: -10 }, { x: 30, y: 40 })).toEqual({
      x: -20, y: -10, width: 50, height: 50,
    });
  });

  it('returns null for a zero-width or zero-height region', () => {
    expect(regionFromCorners({ x: 10, y: 10 }, { x: 10, y: 50 })).toBeNull();
    expect(regionFromCorners({ x: 10, y: 10 }, { x: 50, y: 10 })).toBeNull();
  });
});

describe('defaultMarqueeCorners', () => {
  it('anchors at the rounded click point and extends down-right', () => {
    expect(defaultMarqueeCorners({ x: 20.4, y: 30.6 }, 800, 600)).toEqual({
      from: { x: 20, y: 31 },
      to: { x: 20 + DEFAULT_REGION_SIZE, y: 31 + DEFAULT_REGION_SIZE },
    });
  });

  it('stops at the document edge when the click is near it', () => {
    expect(defaultMarqueeCorners({ x: 750, y: 580 }, 800, 600)).toEqual({
      from: { x: 750, y: 580 },
      to: { x: 800, y: 600 },
    });
  });

  it('pulls back inside the document for a click on the far edge', () => {
    expect(defaultMarqueeCorners({ x: 800, y: 600 }, 800, 600)).toEqual({
      from: { x: 800 - DEFAULT_REGION_SIZE, y: 600 - DEFAULT_REGION_SIZE },
      to: { x: 800, y: 600 },
    });
  });

  it('clamps clicks on the pasteboard into the document', () => {
    expect(defaultMarqueeCorners({ x: -40, y: 900 }, 800, 600)).toEqual({
      from: { x: 0, y: 600 - DEFAULT_REGION_SIZE },
      to: { x: DEFAULT_REGION_SIZE, y: 600 },
    });
  });

  it('fits a document smaller than the default size', () => {
    expect(defaultMarqueeCorners({ x: 10, y: 10 }, 40, 30)).toEqual({
      from: { x: 10, y: 10 },
      to: { x: 40, y: 30 },
    });
  });
});
