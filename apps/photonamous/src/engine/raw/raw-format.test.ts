import { describe, expect, it } from 'vitest';
import { parseRawDescription, RAW_PATH_FORMATS } from './raw-format';
import { rawWhiteBalanceFor } from './raw-white-balance';
import { wbRatioFor } from '../raw-develop';

/** A description shaped as the engine writes one for a file with a fixed matrix and fitted Kelvin. */
const FITTED = {
  format: 'raf',
  width: 5152,
  height: 7728,
  planeWidth: 7752,
  planeHeight: 5178,
  samplesPerPixel: 1,
  clipLevels: [1.6, 1, 1.9],
  cameraModel: 'X-T5',
  colorNote: null,
  notApplied: [],
  developDefaults: {
    wbRatio: [1, 1, 1],
    camToRgb: [1.2, 0, -0.2, -0.1, 1.3, -0.2, 0, -0.3, 1.3],
    exposureEv: 0.38,
    saturation: 1.4,
    highlightDesaturation: true,
    baseCurve: [0, 0.3, 0.7, 1],
    clipLevels: [1.6, 1, 1.9],
  },
  profiles: [
    { id: 'camera', name: 'Camera (Velvia)', settings: { saturation: 1.5 } },
    { id: 'monochrome', name: 'Monochrome', settings: { saturation: 0 } },
  ],
  whiteBalance: {
    matrix: 'fixed',
    kelvin: { kind: 'fitted', miredAtZero: 190, miredPerUnit: -1.5, asShotKelvin: 5263 },
    presetSource: 'camera',
    presets: [
      { name: 'Daylight', temperature: 4, tint: -1 },
      { name: 'Shade', temperature: 30, tint: 2 },
    ],
  },
  finishedBands: true,
};

function described(patch: Record<string, unknown> = {}): string {
  return JSON.stringify({ ...FITTED, ...patch });
}

describe('parseRawDescription', () => {
  it('reads every field the app develops with', () => {
    const d = parseRawDescription(described());
    expect(d).toMatchObject({ format: 'raf', width: 5152, height: 7728, planeWidth: 7752, samplesPerPixel: 1, cameraModel: 'X-T5', colorNote: null, finishedBands: true });
    expect(d.clipLevels).toEqual([1.6, 1, 1.9]);
    expect(d.developDefaults.exposureEv).toBe(0.38);
    expect(d.developDefaults.clipLevels).toEqual([1.6, 1, 1.9]);
    // The engine's camera look is read under the recipe's id for it.
    expect(d.profiles.map((p) => p.id)).toEqual(['standard', 'monochrome']);
    expect(d.whiteBalance.matrix).toBe('fixed');
    expect(d.whiteBalance.kelvin).toEqual({ kind: 'fitted', miredAtZero: 190, miredPerUnit: -1.5, asShotKelvin: 5263 });
    expect(d.whiteBalance.presets.map((p) => p.id)).toEqual(['daylight', 'shade']);
  });

  it('reads a measured Kelvin, no Kelvin, three samples a pixel and a colour note', () => {
    const d = parseRawDescription(
      described({
        format: 'dng',
        samplesPerPixel: 3,
        colorNote: 'Colour is approximate.',
        whiteBalance: { matrix: 'perWhite', kelvin: { kind: 'measured', asShotKelvin: 5200, asShotTint: 4 }, presetSource: 'illuminants', presets: [] },
      }),
    );
    expect(d.samplesPerPixel).toBe(3);
    expect(d.colorNote).toBe('Colour is approximate.');
    expect(d.whiteBalance.kelvin).toEqual({ kind: 'measured', asShotKelvin: 5200, asShotTint: 4 });
    expect(parseRawDescription(described({ whiteBalance: { ...FITTED.whiteBalance, kelvin: { kind: 'none' } } })).whiteBalance.kelvin).toEqual({ kind: 'none' });
  });

  it('takes a fitted scale that gives no Kelvin as none, as the old Kelvin reader did', () => {
    const broken = { ...FITTED.whiteBalance, kelvin: { kind: 'fitted', miredAtZero: 0, miredPerUnit: -1.5, asShotKelvin: 5263 } };
    expect(parseRawDescription(described({ whiteBalance: broken })).whiteBalance.kelvin).toEqual({ kind: 'none' });
  });

  it('refuses a description it cannot develop', () => {
    expect(() => parseRawDescription('[]')).toThrow();
    expect(() => parseRawDescription(described({ width: 0 }))).toThrow(/empty image/);
    expect(() => parseRawDescription(described({ samplesPerPixel: 0 }))).toThrow(/plane/);
    expect(() => parseRawDescription(described({ developDefaults: {} }))).toThrow();
    expect(() => parseRawDescription(described({ whiteBalance: { ...FITTED.whiteBalance, matrix: 'sometimes' } }))).toThrow(/matrix/);
  });
});

describe('rawWhiteBalanceFor', () => {
  it('keeps the profile matrix and the relative gains for a fixed matrix, with the fitted readout', () => {
    const wb = rawWhiteBalanceFor(parseRawDescription(described()));
    expect(wb.settingsFor(40, -10)).toEqual({ wbRatio: wbRatioFor(40, -10), camToRgb: null });
    expect(wb.kelvin?.kind).toBe('fitted');
    expect(wb.kelvin?.kelvinFor(0, 0)).toBeCloseTo(1e6 / 190, 6);
    expect(wb.presets.map((p) => p.name)).toEqual(['Daylight', 'Shade']);
  });

  it('has no readout where the format has no Kelvin', () => {
    const none = { ...FITTED.whiteBalance, kelvin: { kind: 'none' }, presetSource: 'none', presets: [] };
    const wb = rawWhiteBalanceFor(parseRawDescription(described({ whiteBalance: none })));
    expect(wb.kelvin).toBeNull();
    expect(wb.presets).toEqual([]);
  });

  it('refuses the models no format on the RAW path uses yet', () => {
    const perWhite = { matrix: 'perWhite', kelvin: { kind: 'measured', asShotKelvin: 5200, asShotTint: 4 }, presetSource: 'illuminants', presets: [] };
    expect(() => rawWhiteBalanceFor(parseRawDescription(described({ format: 'dng', whiteBalance: perWhite })))).toThrow(/DNG/);
  });
});

describe('RAW_PATH_FORMATS', () => {
  it('holds the formats the Edit view develops through the RAW interface', () => {
    expect([...RAW_PATH_FORMATS]).toEqual(['raf']);
  });
});
