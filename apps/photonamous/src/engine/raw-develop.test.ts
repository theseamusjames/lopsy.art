import { describe, expect, it } from 'vitest';
import { DEFAULT_RECIPE, type Recipe } from '@lopsy/photos-core/library/recipe';
import { WB_LUMA_WEIGHTS, parseRawDevelopSettings, rawSettingsFor, rawSettingsJson, temperatureTintFor, wbRatioFor } from './raw-develop';

const DEFAULTS_JSON = JSON.stringify({
  wbRatio: [1, 1, 1],
  camToRgb: [1.2, 0, -0.2, -0.1, 1.3, -0.2, 0, -0.3, 1.3],
  exposureEv: 0.38,
  saturation: 1.4,
  highlightDesaturation: true,
  baseCurve: [0, 0.3, 0.7, 1],
});

function luma(r: readonly number[]): number {
  const [wr, wg, wb] = WB_LUMA_WEIGHTS;
  return wr * (r[0] ?? 0) + wg * (r[1] ?? 0) + wb * (r[2] ?? 0);
}

function recipe(patch: { temperature?: number; tint?: number; exposure?: number; profile?: string }): Recipe {
  return {
    ...DEFAULT_RECIPE,
    profile: { id: patch.profile ?? 'standard' },
    whiteBalance: { mode: 'custom', temperature: patch.temperature ?? 0, tint: patch.tint ?? 0 },
    tone: { ...DEFAULT_RECIPE.tone, exposure: patch.exposure ?? 0 },
  };
}

describe('wbRatioFor', () => {
  it('is as shot at zero', () => {
    expect(wbRatioFor(0, 0)).toEqual([1, 1, 1]);
  });

  it('warms by raising red over blue by 1.2 stops at +100', () => {
    const [r, , b] = wbRatioFor(100, 0);
    expect(Math.log2(r / b)).toBeCloseTo(1.2, 10);
    const [r2, , b2] = wbRatioFor(-100, 0);
    expect(r2).toBeLessThan(b2);
  });

  it('moves green against red and blue for tint', () => {
    const [r, g, b] = wbRatioFor(0, 100);
    expect(Math.log2(r / g)).toBeCloseTo(0.4, 10);
    expect(r).toBeCloseTo(b, 10);
    expect(wbRatioFor(0, -50)[1]).toBeGreaterThan(1);
  });

  it('keeps the weighted luminance at 1', () => {
    for (const t of [-100, -37, 0, 64, 100]) {
      for (const m of [-100, 0, 45]) expect(luma(wbRatioFor(t, m))).toBeCloseTo(1, 10);
    }
  });
});

describe('parseRawDevelopSettings', () => {
  it('reads the defaults JSON', () => {
    const s = parseRawDevelopSettings(DEFAULTS_JSON);
    expect(s.exposureEv).toBe(0.38);
    expect(s.camToRgb).toHaveLength(9);
    expect(s.baseCurve).toEqual([0, 0.3, 0.7, 1]);
    expect(s.highlightDesaturation).toBe(true);
  });

  it('accepts a missing curve and rejects broken settings', () => {
    const noCurve = JSON.parse(DEFAULTS_JSON) as Record<string, unknown>;
    delete noCurve.baseCurve;
    expect(parseRawDevelopSettings(JSON.stringify(noCurve)).baseCurve).toBeNull();
    expect(() => parseRawDevelopSettings('{"wbRatio":[1,1]}')).toThrow();
    expect(() => parseRawDevelopSettings('null')).toThrow();
  });

  it('keeps clipLevels through to setRawDevelop, and leaves them out when absent', () => {
    const withClip = { ...(JSON.parse(DEFAULTS_JSON) as Record<string, unknown>), clipLevels: [1.7, 1, 1.8] };
    const s = parseRawDevelopSettings(JSON.stringify(withClip));
    expect(s.clipLevels).toEqual([1.7, 1, 1.8]);
    const sent = JSON.parse(rawSettingsJson(rawSettingsFor(s, recipe({})))) as Record<string, unknown>;
    expect(sent.clipLevels).toEqual([1.7, 1, 1.8]);
    const without = JSON.parse(rawSettingsJson(rawSettingsFor(parseRawDevelopSettings(DEFAULTS_JSON), recipe({})))) as Record<string, unknown>;
    expect('clipLevels' in without).toBe(false);
  });
});

describe('rawSettingsFor', () => {
  const defaults = parseRawDevelopSettings(DEFAULTS_JSON);

  it('adds the user exposure to the baseline and sets white balance', () => {
    const s = rawSettingsFor(defaults, recipe({ exposure: 0.5, temperature: 40 }));
    expect(s.exposureEv).toBeCloseTo(0.88, 10);
    expect(s.wbRatio).toEqual(wbRatioFor(40, 0));
    expect(s.saturation).toBe(1.4);
    expect(s.baseCurve).toEqual(defaults.baseCurve);
    expect(s.camToRgb).toEqual(defaults.camToRgb);
  });

  it('builds the JSON setRawDevelop takes', () => {
    const json = JSON.parse(rawSettingsJson(rawSettingsFor(defaults, recipe({})))) as Record<string, unknown>;
    expect(Object.keys(json).sort()).toEqual(
      ['baseCurve', 'camToRgb', 'exposureEv', 'highlightDesaturation', 'saturation', 'wbRatio'].sort(),
    );
    expect(json.wbRatio).toEqual([1, 1, 1]);
    expect(json.exposureEv).toBe(0.38);
  });

  it('drops the film look for the neutral profile', () => {
    const s = rawSettingsFor(defaults, recipe({ profile: 'neutral' }));
    expect(s.baseCurve).toBeNull();
    expect(s.saturation).toBe(1);
  });
});

describe('temperatureTintFor', () => {
  it('inverts wbRatioFor', () => {
    for (const t of [-100, -40, 0, 25, 100]) {
      for (const m of [-80, 0, 33]) expect(temperatureTintFor(wbRatioFor(t, m))).toEqual({ temperature: t, tint: m });
    }
  });

  it('ignores the scale of the ratios, as the engine gives green = 1', () => {
    const [r, g, b] = wbRatioFor(30, -20);
    expect(temperatureTintFor([r / g, 1, b / g])).toEqual({ temperature: 30, tint: -20 });
  });

  it('clamps to the slider range and survives nonsense', () => {
    expect(temperatureTintFor([16, 1, 0.0001])).toEqual({ temperature: 200, tint: -200 });
    expect(temperatureTintFor([0, 1, 1])).toEqual({ temperature: 0, tint: 0 });
  });
});

describe('profiles in the develop settings', () => {
  const defaults = parseRawDevelopSettings(DEFAULTS_JSON);

  it('takes Monochrome as no colour on the camera curve', () => {
    const s = rawSettingsFor(defaults, recipe({ profile: 'monochrome' }));
    expect(s.saturation).toBe(0);
    expect(s.baseCurve).toEqual(defaults.baseCurve);
  });

  it('uses an engine profile with settings', () => {
    const s = rawSettingsFor(defaults, recipe({ profile: 'astia', exposure: 0.5 }), [
      { id: 'astia', name: 'Astia', settings: { saturation: 1.1, baseCurve: [0, 1], exposureEv: 0.2 } },
    ]);
    expect(s.saturation).toBe(1.1);
    expect(s.baseCurve).toEqual([0, 1]);
    expect(s.exposureEv).toBeCloseTo(0.7, 10);
    expect(s.camToRgb).toEqual(defaults.camToRgb);
  });
});
