import { describe, expect, it } from 'vitest';
import { colorToPoint, expandedBox, fieldCss, fieldNumber, pointToColor, stepColor } from './color-field';

describe('pointToColor', () => {
  it('reads hue across and saturation down, full at the top and none at the bottom', () => {
    expect(pointToColor(0, 0, 200, 200)).toEqual({ hue: 0, saturation: 100 });
    expect(pointToColor(100, 50, 200, 200)).toEqual({ hue: 180, saturation: 75 });
    expect(pointToColor(200, 200, 200, 200)).toEqual({ hue: 360, saturation: 0 });
  });

  it('holds a point outside the field to its edge', () => {
    expect(pointToColor(-30, 260, 200, 200)).toEqual({ hue: 0, saturation: 0 });
    expect(pointToColor(900, -5, 200, 200)).toEqual({ hue: 360, saturation: 100 });
  });

  it('keeps a tenth of a degree, so every pixel is a colour of its own, and a larger field has more of them', () => {
    expect(pointToColor(1, 0, 250, 250).hue).toBe(1.4);
    expect(pointToColor(2, 0, 250, 250).hue).toBe(2.9);
    expect(pointToColor(1, 0, 500, 500).hue).toBe(0.7);
    expect(pointToColor(2, 0, 500, 500).hue).toBe(1.4);
    expect(pointToColor(0, 1, 500, 500).saturation).toBe(99.8);
    const across = new Set(Array.from({ length: 500 }, (_, x) => pointToColor(x, 0, 500, 500).hue));
    expect(across.size).toBe(500);
  });

  it('gives nothing for a field with no size', () => {
    expect(pointToColor(5, 5, 0, 0)).toEqual({ hue: 0, saturation: 0 });
  });
});

describe('colorToPoint', () => {
  it('puts the marker where the colour was picked', () => {
    expect(colorToPoint({ hue: 180, saturation: 75 })).toEqual({ x: 0.5, y: 0.25 });
    expect(colorToPoint({ hue: 0, saturation: 0 })).toEqual({ x: 0, y: 1 });
  });
});

describe('stepColor', () => {
  const color = { hue: 5, saturation: 95 };

  it('moves the hue with left and right, the saturation with up and down', () => {
    expect(stepColor(color, 'ArrowRight', 1)).toEqual({ hue: 6, saturation: 95 });
    expect(stepColor(color, 'ArrowDown', 10)).toEqual({ hue: 5, saturation: 85 });
  });

  it('takes a fine step of a tenth, with no float dust', () => {
    expect(stepColor({ hue: 0.2, saturation: 95 }, 'ArrowRight', 0.1)).toEqual({ hue: 0.3, saturation: 95 });
    expect(stepColor({ hue: 5, saturation: 0.3 }, 'ArrowDown', 0.1)).toEqual({ hue: 5, saturation: 0.2 });
  });

  it('stops at the ends', () => {
    expect(stepColor(color, 'ArrowLeft', 10)).toEqual({ hue: 0, saturation: 95 });
    expect(stepColor(color, 'ArrowUp', 10)).toEqual({ hue: 5, saturation: 100 });
  });

  it('leaves other keys alone', () => {
    expect(stepColor(color, 'Enter', 1)).toBeNull();
  });
});

describe('fieldNumber', () => {
  it('shows a tenth only when there is one', () => {
    expect(fieldNumber(216.7)).toBe('216.7');
    expect(fieldNumber(216)).toBe('216');
    expect(fieldNumber(216.04)).toBe('216');
  });
});

describe('fieldCss', () => {
  it('is the full hue at the top and white at the bottom', () => {
    expect(fieldCss({ hue: 120, saturation: 100 })).toBe('hsl(120 100% 50%)');
    expect(fieldCss({ hue: 120, saturation: 0 })).toBe('hsl(120 100% 100%)');
  });
});

describe('expandedBox', () => {
  it('grows out to the left and down from the small field\'s top right corner', () => {
    expect(expandedBox({ top: 300, right: 1350 }, { width: 1400, height: 860 })).toEqual({ left: 850, top: 300, size: 500 });
  });

  it('moves up to stay in the window', () => {
    expect(expandedBox({ top: 600, right: 1350 }, { width: 1400, height: 860 })).toEqual({ left: 850, top: 352, size: 500 });
  });

  it('is as large as a small window allows', () => {
    expect(expandedBox({ top: 100, right: 380 }, { width: 400, height: 420 })).toEqual({ left: 8, top: 28, size: 384 });
  });
});
