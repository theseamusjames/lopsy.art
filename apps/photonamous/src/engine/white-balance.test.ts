import { describe, expect, it } from 'vitest';
import { fittedReadout, isWhiteBalanceWaiting, kelvinDisplay, kelvinFor, parseKelvinScale, parsePresets, temperatureForKelvin } from './white-balance';

describe('isWhiteBalanceWaiting', () => {
  it('holds a RAF until the photo is read, so Kelvin is never taken as units', () => {
    expect(isWhiteBalanceWaiting('raf', false)).toBe(true);
    expect(isWhiteBalanceWaiting('raf', true)).toBe(false);
  });

  it('never holds photos whose sliders are relative', () => {
    expect(isWhiteBalanceWaiting('jpeg', false)).toBe(false);
    expect(isWhiteBalanceWaiting('dng', false)).toBe(false);
  });
});

describe('white balance presets', () => {
  it('reads the engine list in order, with ids', () => {
    const json = JSON.stringify([
      { name: 'Daylight', temperature: 4, tint: -1 },
      { name: 'Fluorescent (cool white)', temperature: 12, tint: 8 },
      { name: 'Bad', temperature: 'x', tint: 0 },
      { name: 'Daylight', temperature: 9, tint: 9 },
    ]);
    expect(parsePresets(json)).toEqual([
      { id: 'daylight', name: 'Daylight', temperature: 4, tint: -1 },
      { id: 'fluorescent-cool-white-', name: 'Fluorescent (cool white)', temperature: 12, tint: 8 },
    ]);
    expect(parsePresets('[]')).toEqual([]);
    expect(parsePresets('nope')).toEqual([]);
  });

  it('leaves out a preset whose slider values are those of an earlier one', () => {
    // A Fujifilm body's Underwater multipliers are within a percent of its Daylight ones: the same two slider values.
    const json = JSON.stringify([
      { name: 'Daylight', temperature: 45, tint: -17 },
      { name: 'Cloudy', temperature: 74, tint: -27 },
      { name: 'Underwater', temperature: 45.3, tint: -16.6 },
      { name: 'Shade', temperature: 45, tint: -18 },
    ]);
    expect(parsePresets(json).map((p) => p.name)).toEqual(['Daylight', 'Cloudy', 'Shade']);
  });
});

describe('Kelvin', () => {
  const scale = { miredAtZero: 190, miredPerUnit: -1.5, asShotKelvin: 5263 };

  it('reads the scale or nothing', () => {
    expect(parseKelvinScale(JSON.stringify(scale))).toEqual(scale);
    expect(parseKelvinScale('null')).toBeNull();
    expect(parseKelvinScale('{"miredAtZero":0,"miredPerUnit":1,"asShotKelvin":5000}')).toBeNull();
  });

  it('converts both ways, raising Kelvin as the slider rises', () => {
    expect(kelvinFor(scale, 0)).toBeCloseTo(1e6 / 190, 6);
    expect(kelvinFor(scale, 20)!).toBeGreaterThan(kelvinFor(scale, 0)!);
    expect(temperatureForKelvin(scale, kelvinFor(scale, 37)!)).toBeCloseTo(37, 6);
  });

  it('shows the readout in Kelvin and reads typed Kelvin', () => {
    const display = kelvinDisplay(fittedReadout(scale), 0);
    expect(display.format(0)).toBe('5250 K');
    const value = display.parse('6500 K');
    expect(value).not.toBeNull();
    expect(kelvinFor(scale, value!)!).toBeCloseTo(6500, -2);
    expect(display.parse('6500')).toBe(value);
    expect(display.parse('warm')).toBeNull();
    expect(display.parse('')).toBeNull();
    expect(display.parse('-60')).toBeNull();
    expect(display.parse('0')).toBeNull();
    // Out of range clamps: 60 K reads as the lowest Kelvin there is.
    expect(display.parse('60')).toBe(display.parse('2000'));
    expect(display.parse('900000')).toBe(display.parse('50000'));
  });

  it('a fitted readout is the scale, whatever the tint', () => {
    const readout = fittedReadout(scale);
    expect(readout.kind).toBe('fitted');
    expect(readout.asShotKelvin).toBe(5263);
    expect(readout.kelvinFor(37, -50)).toBe(kelvinFor(scale, 37));
    expect(readout.temperatureFor(6500, 80)).toBe(temperatureForKelvin(scale, 6500));
    expect(kelvinDisplay(readout, 60).format(25)).toBe(kelvinDisplay(readout, 0).format(25));
  });

  it('shows the readout at the given tint, for a readout whose Kelvin follows it', () => {
    const readout = { kind: 'measured' as const, asShotKelvin: 5000, kelvinFor: (t: number, m: number) => 5000 + 10 * t + m, temperatureFor: (k: number, m: number) => (k - 5000 - m) / 10 };
    expect(kelvinDisplay(readout, 0).format(10)).toBe('5100 K');
    expect(kelvinDisplay(readout, 50).format(10)).toBe('5150 K');
    expect(kelvinDisplay(readout, 50).parse('5550')).toBe(50);
  });
});
