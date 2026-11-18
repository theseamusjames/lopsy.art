import { describe, expect, it } from 'vitest';
import { IMAGE_PROFILES, RAW_FALLBACK_PROFILES, parseDevelopProfiles, profilesFor, selectedProfile } from './profiles';

describe('parseDevelopProfiles', () => {
  it('reads an array or a { profiles } object', () => {
    const list = [
      { id: 'provia', name: 'Provia / Standard', saturation: 1.2, baseCurve: [0, 0.5, 1] },
      { id: 'velvia', label: 'Velvia / Vivid' },
    ];
    expect(parseDevelopProfiles(JSON.stringify(list))).toEqual([
      { id: 'provia', name: 'Provia / Standard', saturation: 1.2, baseCurve: [0, 0.5, 1] },
      { id: 'velvia', name: 'Velvia / Vivid' },
    ]);
    expect(parseDevelopProfiles(JSON.stringify({ profiles: list }))).toHaveLength(2);
  });

  it('drops broken and repeated entries', () => {
    const json = JSON.stringify([{ id: 'a', name: 'A' }, { id: 'a', name: 'Again' }, { name: 'No id' }, 3, { id: 'n', name: 'N', baseCurve: null }]);
    expect(parseDevelopProfiles(json)).toEqual([
      { id: 'a', name: 'A' },
      { id: 'n', name: 'N', baseCurve: null },
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
