import { describe, expect, it } from 'vitest';
import { EFFECT_LIST, effectLabel, effectSliderLimits } from './effect-list';

describe('effect-list', () => {
  it('lists the drawer\'s effects in order with their labels', () => {
    expect(EFFECT_LIST.map((e) => e.label)).toEqual(['Drop Shadow', 'Stroke', 'Outer Glow', 'Inner Glow', 'Color Overlay']);
    expect(effectLabel('innerGlow')).toBe('Inner Glow');
  });

  it('scales the form limits with the document, from the forms\' base maxima', () => {
    expect(effectSliderLimits(40, 30)).toEqual({
      shadowOffset: 100, shadowBlurMax: 100, shadowSpreadMax: 100, glowSizeMax: 100, glowSpreadMax: 100, strokeWidthMax: 60,
    });
    expect(effectSliderLimits(200, 150).strokeWidthMax).toBe(300);
    expect(effectSliderLimits(8000, 10).shadowOffset).toBe(5000);
  });
});
