import { describe, expect, it } from 'vitest';
import { parseRawDescription, RAW_PATH_FORMATS, rawLoadPath } from './raw-format';
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

/** An engine that answers as the real one is shaped, and counts its calls. */
function fakeEngine() {
  const calls: string[] = [];
  return {
    calls,
    whiteBalance(format: string, paramsJson: string, temperature: number, tint: number): string {
      calls.push(`wb ${format} ${paramsJson} ${temperature} ${tint}`);
      return JSON.stringify({ wbRatio: [1 + temperature / 1000, 1, 1 - temperature / 1000], camToRgb: [1, 0, 0, 0, 1, 0, 0, 0, 1 + tint / 1000], kelvin: 5000 + 20 * temperature + tint, tint: tint / 10 });
    },
    temperatureForKelvin(format: string, paramsJson: string, kelvin: number, tint: number): number {
      calls.push(`k ${format} ${paramsJson} ${kelvin} ${tint}`);
      return Math.max(-200, Math.min(200, (kelvin - 5000 - tint) / 20));
    },
  };
}

const MEASURED = { matrix: 'perWhite', kelvin: { kind: 'measured', asShotKelvin: 5003.25, asShotTint: 4 }, presetSource: 'illuminants', presets: [{ name: 'Daylight', temperature: 25, tint: -6 }] };
const UNMEASURED = { matrix: 'fixed', kelvin: { kind: 'none' }, presetSource: 'none', presets: [] };

describe('rawWhiteBalanceFor', () => {
  it('keeps the profile matrix and the relative gains for a fixed matrix, with the fitted readout', () => {
    const engine = fakeEngine();
    const wb = rawWhiteBalanceFor(parseRawDescription(described()), '{}', engine);
    expect(wb.settingsFor(40, -10)).toEqual({ wbRatio: wbRatioFor(40, -10), camToRgb: null });
    expect(wb.kelvin?.kind).toBe('fitted');
    expect(wb.kelvin?.kelvinFor(0, 0)).toBeCloseTo(1e6 / 190, 6);
    expect(wb.presets.map((p) => p.name)).toEqual(['Daylight', 'Shade']);
    expect(engine.calls).toEqual([]);
  });

  it('has no readout and no presets where the format has no Kelvin, and keeps the relative gains', () => {
    const engine = fakeEngine();
    const wb = rawWhiteBalanceFor(parseRawDescription(described({ format: 'arw', whiteBalance: UNMEASURED })), '{}', engine);
    expect(wb.kelvin).toBeNull();
    expect(wb.presets).toEqual([]);
    expect(wb.settingsFor(-30, 12)).toEqual({ wbRatio: wbRatioFor(-30, 12), camToRgb: null });
    expect(engine.calls).toEqual([]);
  });

  it("asks the engine for a white's gains and matrix where the matrix follows the white, once per rounded value", () => {
    const engine = fakeEngine();
    const wb = rawWhiteBalanceFor(parseRawDescription(described({ format: 'dng', whiteBalance: MEASURED })), 'P', engine);
    const settings = wb.settingsFor(50.4, -9.6);
    expect(settings.wbRatio).toEqual([1.05, 1, 0.95]);
    expect(settings.camToRgb).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 0.99]);
    wb.settingsFor(50, -10);
    expect(engine.calls).toEqual(['wb dng P 50 -10']);
    expect(wb.presets.map((p) => p.name)).toEqual(['Daylight']);
  });

  it('reads measured Kelvin from the white of both sliders, as shot exactly at zero, and types Kelvin at the tint', () => {
    const engine = fakeEngine();
    const wb = rawWhiteBalanceFor(parseRawDescription(described({ format: 'dng', whiteBalance: MEASURED })), 'P', engine);
    const kelvin = wb.kelvin;
    if (!kelvin) throw new Error('no readout');
    expect(kelvin.kind).toBe('measured');
    expect(kelvin.kelvinFor(0, 0)).toBe(5003.25);
    expect(kelvin.kelvinFor(10, 0)).toBe(5200);
    expect(kelvin.kelvinFor(10, 30)).toBe(5230);
    expect(kelvin.temperatureFor(5500, 20)).toBe(24);
    expect(engine.calls).toContain('k dng P 5500 20');
    // Out of reach: the engine keeps within the sliders, and the readout shows the Kelvin reached.
    expect(kelvin.temperatureFor(50000, 0)).toBe(200);
    expect(kelvin.kelvinFor(200, 0)).toBe(9000);
  });
});

describe('RAW_PATH_FORMATS and finished bands', () => {
  it('develops every RAW format through the RAW interface', () => {
    expect([...RAW_PATH_FORMATS].sort()).toEqual(['arw', 'cr2', 'dng', 'nef', 'raf']);
  });

  it('opens every RAW file through the RAW interface, or baked where the GPU cannot render it', () => {
    // As the engine's rawRendersFinishedBands answers today: RAF only.
    const asked: string[] = [];
    const finished = (format: string) => {
      asked.push(format);
      return format === 'raf';
    };
    for (const format of ['raf', 'dng', 'arw', 'cr2', 'nef'] as const) expect(rawLoadPath(format, true, finished)).toBe('raw');
    expect(asked).toEqual([]);
    // Without float targets: a format with finished bands renders them; the others take the baked decode.
    expect(rawLoadPath('raf', false, finished)).toBe('raw');
    expect(rawLoadPath('dng', false, finished)).toBe('baked');
    expect(rawLoadPath('arw', false, finished)).toBe('baked');
    expect(rawLoadPath('cr2', false, finished)).toBe('baked');
    expect(rawLoadPath('nef', false, finished)).toBe('baked');
    expect(asked).toEqual(['raf', 'dng', 'arw', 'cr2', 'nef']);
    for (const format of ['jpeg', 'png', 'webp'] as const) expect(rawLoadPath(format, false, finished)).toBe('image');
    expect(asked).toHaveLength(5);
  });
});
