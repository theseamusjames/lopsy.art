import { describe, expect, it } from 'vitest';
import { IMAGE_PROFILES, RAW_FALLBACK_PROFILES, parseDevelopProfiles, profilesFor, selectedProfile } from './profiles';

describe('parseDevelopProfiles', () => {
  it('reads the engine list, with the camera look under the recipe id', () => {
    const list = [
      { id: 'camera', name: 'Camera (Provia)', settings: { camToRgb: [1, 0, 0, 0, 1, 0, 0, 0, 1], exposureEv: 0.38, saturation: 1.2, highlightDesaturation: true, baseCurve: [0, 0.5, 1] } },
      { id: 'velvia', label: 'Velvia / Vivid', settings: { saturation: 1.4, baseCurve: null } },
    ];
    expect(parseDevelopProfiles(JSON.stringify(list))).toEqual([
      {
        id: 'standard',
        name: 'Camera (Provia)',
        settings: { camToRgb: [1, 0, 0, 0, 1, 0, 0, 0, 1], exposureEv: 0.38, saturation: 1.2, highlightDesaturation: true, baseCurve: [0, 0.5, 1] },
      },
      { id: 'velvia', name: 'Velvia / Vivid', settings: { saturation: 1.4, baseCurve: null } },
    ]);
    expect(parseDevelopProfiles(JSON.stringify({ profiles: list }))).toHaveLength(2);
  });

  it('drops broken and repeated entries', () => {
    const json = JSON.stringify([{ id: 'a', name: 'A' }, { id: 'a', name: 'Again' }, { name: 'No id' }, 3, { id: 'n', name: 'N', settings: { saturation: 'x' } }]);
    expect(parseDevelopProfiles(json)).toEqual([
      { id: 'a', name: 'A' },
      { id: 'n', name: 'N' },
    ]);
    expect(parseDevelopProfiles('not json')).toEqual([]);
    expect(parseDevelopProfiles('{"x":1}')).toEqual([]);
  });
});

describe('profilesFor', () => {
  it('offers Standard and Monochrome for images that are not RAW', () => {
    expect(profilesFor(false, [{ id: 'velvia', name: 'Velvia' }])).toEqual(IMAGE_PROFILES);
  });

  it('falls back to the camera look, Neutral and Monochrome', () => {
    expect(profilesFor(true, [])).toEqual(RAW_FALLBACK_PROFILES);
  });

  it('puts the camera look first and keeps Neutral and Monochrome', () => {
    const ids = profilesFor(true, [
      { id: 'velvia', name: 'Velvia' },
      { id: 'standard', name: 'Camera (Provia)' },
      { id: 'neutral', name: 'Flat' },
    ]).map((p) => `${p.id}:${p.name}`);
    expect(ids).toEqual(['standard:Camera (Provia)', 'velvia:Velvia', 'neutral:Flat', 'monochrome:Monochrome']);
  });
});

describe('selectedProfile', () => {
  it('finds the recipe profile or shows the first', () => {
    expect(selectedProfile(RAW_FALLBACK_PROFILES, 'neutral')?.name).toBe('Neutral');
    expect(selectedProfile(RAW_FALLBACK_PROFILES, 'astia')?.id).toBe('standard');
    expect(selectedProfile([], 'x')).toBeNull();
  });
});
