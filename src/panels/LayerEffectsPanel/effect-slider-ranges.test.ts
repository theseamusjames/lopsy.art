import { describe, it, expect } from 'vitest';
import { docScaledMax, docScaledOffset } from '../../utils/slider-ranges';
import { sliderKnobPosition } from '../../components/Slider/Slider';

/**
 * #664 — the effects-panel sliders (drop shadow, glow, stroke) declare
 * `max` from `docScaledMax` so the text input scales with document size,
 * and pin `sliderMax` so the DRAG range stays a usable ±200 (or ±100
 * for stroke width) regardless of doc size. Without the pin, a 5000px
 * canvas turned each slider into a hair-trigger sweeping thousands of
 * pixels per pointer motion.
 *
 * These sliders live in TSX so we test the math directly: `knobMax` is
 * `Math.min(max, sliderMax ?? max)` inside the Slider component, and
 * `sliderKnobPosition` is the exact function it calls to place the knob.
 */

describe('#664 effect slider drag range stays sensible on large canvases', () => {
  const bigDoc = { w: 5000, h: 4000 };

  it('drop shadow blur: max scales with doc, drag range caps at 200', () => {
    const max = docScaledMax(bigDoc.w, bigDoc.h, 100);
    const sliderMax = 200;
    expect(max).toBeGreaterThan(sliderMax);
    // A value larger than sliderMax pins the knob at sliderMax.
    expect(sliderKnobPosition(1500, 0, sliderMax)).toBe(sliderMax);
    // Inside the drag range the knob tracks the value normally.
    expect(sliderKnobPosition(75, 0, sliderMax)).toBe(75);
  });

  it('drop shadow offset: max scales with doc, drag range spans ±200', () => {
    const abs = docScaledOffset(bigDoc.w, bigDoc.h, 100);
    const sliderMax = 200;
    expect(abs).toBeGreaterThan(sliderMax);
    expect(sliderKnobPosition(-999, -sliderMax, sliderMax)).toBe(-sliderMax);
    expect(sliderKnobPosition(999, -sliderMax, sliderMax)).toBe(sliderMax);
  });

  it('stroke width: max scales with doc, drag range caps at 100', () => {
    const max = docScaledMax(bigDoc.w, bigDoc.h, 50);
    const sliderMax = 100;
    expect(max).toBeGreaterThan(sliderMax);
    expect(sliderKnobPosition(750, 1, sliderMax)).toBe(sliderMax);
  });

  it('glow size + spread: max scales with doc, drag range caps at 200', () => {
    const max = docScaledMax(bigDoc.w, bigDoc.h, 100);
    const sliderMax = 200;
    expect(max).toBeGreaterThan(sliderMax);
    expect(sliderKnobPosition(3000, 0, sliderMax)).toBe(sliderMax);
  });

  it('small docs still track values inside the sliderMax range', () => {
    // For a small doc, docScaledMax stays close to the baseMax value.
    const smallDoc = { w: 60, h: 60 };
    const max = docScaledMax(smallDoc.w, smallDoc.h, 100);
    expect(max).toBe(100);
    // sliderMax of 200 is larger than max — knobMax = min(max, sliderMax) = 100.
    // The knob still tracks values inside the doc-scaled range normally.
    expect(sliderKnobPosition(50, 0, Math.min(max, 200))).toBe(50);
    expect(sliderKnobPosition(9999, 0, Math.min(max, 200))).toBe(100);
  });
});
