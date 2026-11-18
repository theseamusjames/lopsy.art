import { describe, expect, it } from 'vitest';
import { DEFAULT_RECIPE, type Recipe } from '@lopsy/photos-core/library/recipe';
import { choiceChanges, currentChoice } from './white-balance-mode';

const wb = (mode: 'asShot' | 'custom', temperature: number, tint: number): Recipe => ({
  ...DEFAULT_RECIPE,
  whiteBalance: { mode, temperature, tint },
});
const auto = { temperature: 12, tint: -3 };
const presets = [{ id: 'daylight', name: 'Daylight', temperature: 5, tint: 0 }];

describe('white balance mode', () => {
  it('names what the recipe holds', () => {
    expect(currentChoice(wb('asShot', 0, 0), auto, presets)).toBe('asShot');
    expect(currentChoice(wb('custom', 12, -3), auto, presets)).toBe('auto');
    expect(currentChoice(wb('custom', 5, 0), auto, presets)).toBe('preset:daylight');
    expect(currentChoice(wb('custom', 30, 0), auto, presets)).toBe('custom');
    expect(currentChoice(wb('custom', 12, -3), null, [])).toBe('custom');
  });

  it('turns a choice into one step', () => {
    expect(choiceChanges('asShot', auto, presets)).toEqual({
      changes: { 'whiteBalance.mode': 'asShot', 'whiteBalance.temperature': 0, 'whiteBalance.tint': 0 },
      label: 'White balance: As shot',
    });
    expect(choiceChanges('auto', auto, presets)?.label).toBe('White balance: Auto');
    expect(choiceChanges('preset:daylight', auto, presets)?.changes['whiteBalance.temperature']).toBe(5);
    expect(choiceChanges('custom', auto, presets)).toBeNull();
    expect(choiceChanges('auto', null, presets)).toBeNull();
  });
});
