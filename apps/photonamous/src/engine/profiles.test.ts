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

  it("lists the engine's entries in its order, under its menu names, leaving out the unlisted", () => {
    const menu = profilesFor(true, [
      { id: 'standard', name: 'Camera (Velvia look)', role: 'camera', menuName: 'Camera (Velvia look)', listed: true, sameAs: 'velvia' },
      { id: 'provia', name: 'Provia look', role: 'look', menuName: 'Standard (Provia look)', listed: true, makerStandard: true },
      { id: 'velvia', name: 'Velvia look', role: 'look', menuName: 'Velvia look', listed: false },
      { id: 'neutral', name: 'Neutral', role: 'neutral', menuName: 'Neutral', listed: true },
      { id: 'monochrome', name: 'Monochrome', role: 'monochrome', menuName: 'Monochrome', listed: true },
    ]);
    expect(menu.map((p) => `${p.id}:${p.name}`)).toEqual([
      'standard:Camera (Velvia look)',
      'provia:Standard (Provia look)',
      'neutral:Neutral',
      'monochrome:Monochrome',
    ]);
  });

  it('adds nothing the engine did not give, and prints the name where there is no menu name', () => {
    expect(profilesFor(true, [{ id: 'standard', name: 'Standard' }, { id: 'monochrome', name: 'Monochrome' }]).map((p) => p.name)).toEqual(['Standard', 'Monochrome']);
  });
});

describe('profiles from the engine', () => {
  it('reads the roles, menu names and listing of each entry', () => {
    const json = JSON.stringify([
      { id: 'camera', name: 'Camera (Provia look)', settings: { saturation: 1.2 }, role: 'camera', menuName: 'Camera (Provia look, Standard)', listed: true, sameAs: 'provia', makerStandard: true },
      { id: 'provia', name: 'Provia look', settings: { saturation: 1.2 }, role: 'look', menuName: 'Standard (Provia look)', listed: false, sameAs: null, makerStandard: true },
      { id: 'x', name: 'X', role: 'nonsense', listed: 'yes' },
    ]);
    const [camera, provia, x] = parseDevelopProfiles(json);
    expect(camera).toMatchObject({ id: 'standard', role: 'camera', menuName: 'Camera (Provia look, Standard)', listed: true, sameAs: 'provia', makerStandard: true });
    expect(provia).toMatchObject({ id: 'provia', listed: false, sameAs: null });
    expect(x).toEqual({ id: 'x', name: 'X' });
    expect(profilesFor(true, parseDevelopProfiles(json)).map((p) => p.name)).toEqual(['Camera (Provia look, Standard)', 'X']);
  });
});

describe('selectedProfile', () => {
  it('finds the recipe profile or shows the first', () => {
    expect(selectedProfile(RAW_FALLBACK_PROFILES, 'neutral')?.name).toBe('Neutral');
    expect(selectedProfile(RAW_FALLBACK_PROFILES, 'astia')?.id).toBe('standard');
    expect(selectedProfile([], 'x')).toBeNull();
  });
});
