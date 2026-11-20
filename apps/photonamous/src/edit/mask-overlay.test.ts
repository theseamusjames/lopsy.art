import { describe, expect, it } from 'vitest';
import { maskActivity, maskOverlayId, type MaskOverlayState } from './mask-overlay';

const shape = { 'areas.m1.geometry': { cx: 0.4, cy: 0.5, rx: 0.25, ry: 0.25, angle: 0, feather: 50 } };
const exposure = { 'areas.m1.adjustments.exposure': 0.5 };
const amount = { 'areas.m1.amount': 60 };

function state(changes: Partial<MaskOverlayState> = {}): MaskOverlayState {
  return { selectedId: 'm1', isShown: false, isFlashing: false, draft: null, ...changes };
}

describe('maskActivity', () => {
  it('tells a shape drag from an adjustment', () => {
    expect(maskActivity(shape, 'm1')).toBe('shape');
    expect(maskActivity({ 'areas.m1.geometry.cx': 0.4 }, 'm1')).toBe('shape');
    expect(maskActivity(exposure, 'm1')).toBe('adjust');
    expect(maskActivity(amount, 'm1')).toBe('adjust');
  });

  it('is nothing for no drag, another mask, the whole photo, or a mask whose id only starts the same', () => {
    expect(maskActivity(null, 'm1')).toBeNull();
    expect(maskActivity({ 'areas.m2.geometry': {} }, 'm1')).toBeNull();
    expect(maskActivity({ 'tone.exposure': 1 }, 'm1')).toBeNull();
    expect(maskActivity({ 'areas.m10.amount': 50 }, 'm1')).toBeNull();
    expect(maskActivity({ 'areas.m1.name': 'Sky' }, 'm1')).toBeNull();
  });
});

describe('maskOverlayId', () => {
  it('shows nothing without a selected mask, whatever else holds', () => {
    expect(maskOverlayId(state({ selectedId: null, isShown: true, isFlashing: true, draft: shape }))).toBeNull();
  });

  it('hides the selected mask at rest, and shows it with Show mask on', () => {
    expect(maskOverlayId(state())).toBeNull();
    expect(maskOverlayId(state({ isShown: true }))).toBe('m1');
  });

  it('shows it for a moment after it is added, chosen or shaped', () => {
    expect(maskOverlayId(state({ isFlashing: true }))).toBe('m1');
  });

  it('shows it while its shape is dragged, however long the drag rests', () => {
    expect(maskOverlayId(state({ draft: shape }))).toBe('m1');
  });

  it('hides it while its Amount or an adjustment is dragged, even with Show mask on or just after it was added', () => {
    expect(maskOverlayId(state({ isShown: true, draft: exposure }))).toBeNull();
    expect(maskOverlayId(state({ isShown: true, isFlashing: true, draft: amount }))).toBeNull();
  });

  it('leaves Show mask alone while something else is dragged', () => {
    expect(maskOverlayId(state({ isShown: true, draft: { 'tone.exposure': 1 } }))).toBe('m1');
    expect(maskOverlayId(state({ isShown: true, draft: { 'areas.m2.adjustments.exposure': 1 } }))).toBe('m1');
    expect(maskOverlayId(state({ draft: { 'tone.exposure': 1 } }))).toBeNull();
  });
});
