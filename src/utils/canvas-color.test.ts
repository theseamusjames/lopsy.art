import { describe, expect, it } from 'vitest';
import { canvasColorString } from './canvas-color';

describe('canvasColorString (#1593)', () => {
  it('uses rgba() on an sRGB context', () => {
    expect(canvasColorString({ r: 255, g: 0, b: 0, a: 1 }, 'srgb')).toBe('rgba(255,0,0,1)');
  });

  it('names the raw channel values in display-p3 on a P3 context, so nothing is converted', () => {
    expect(canvasColorString({ r: 255, g: 0, b: 0, a: 1 }, 'display-p3')).toBe('color(display-p3 1 0 0 / 1)');
  });

  it('keeps fractional channels and alpha on a P3 context', () => {
    const s = canvasColorString({ r: 51, g: 102, b: 204, a: 0.5 }, 'display-p3');
    expect(s).toBe(`color(display-p3 ${51 / 255} ${102 / 255} ${204 / 255} / 0.5)`);
    const [r, g, b] = s.slice('color(display-p3 '.length).split(' ').map(Number);
    expect(Math.round(r! * 255)).toBe(51);
    expect(Math.round(g! * 255)).toBe(102);
    expect(Math.round(b! * 255)).toBe(204);
  });
});
