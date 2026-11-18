import { describe, expect, it } from 'vitest';
import { altDragView } from './alt-drag-views';

describe('altDragView', () => {
  it('shows the sharpening mask or clipping only with Alt held during the matching drag', () => {
    expect(altDragView(['sharpness.radius'], true)).toEqual({ sharpenMask: true, shadows: false, highlights: false });
    expect(altDragView(['tone.blacks'], true)).toEqual({ sharpenMask: false, shadows: true, highlights: false });
    expect(altDragView(['tone.whites'], true)).toEqual({ sharpenMask: false, shadows: false, highlights: true });
    expect(altDragView(['tone.whites'], false)).toEqual({ sharpenMask: false, shadows: false, highlights: false });
    expect(altDragView(['tone.exposure'], true)).toEqual({ sharpenMask: false, shadows: false, highlights: false });
    expect(altDragView([], true)).toEqual({ sharpenMask: false, shadows: false, highlights: false });
  });
});
