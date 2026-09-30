import { describe, it, expect } from 'vitest';
import { blendModeGroupsFor } from './BlendModeSelect';

describe('blendModeGroupsFor', () => {
  it('offers Pass Through first for groups only', () => {
    expect(blendModeGroupsFor(true, true)[0]!.modes).toEqual(['pass-through']);
    const layerModes = blendModeGroupsFor(false, true).flatMap((g) => g.modes);
    expect(layerModes).not.toContain('pass-through');
    expect(layerModes).toHaveLength(16);
  });

  it('drops the HSL modes when the color mode cannot run them', () => {
    const modes = blendModeGroupsFor(true, false).flatMap((g) => g.modes);
    expect(modes).not.toContain('hue');
    expect(modes).not.toContain('luminosity');
    expect(modes).toContain('pass-through');
  });
});
