import { describe, expect, it } from 'vitest';
import { isWhiteBalanceWaiting, kelvinDisplay, kelvinFor, parseKelvinScale, parsePresets, temperatureForKelvin } from './white-balance';

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
    const display = kelvinDisplay(scale);
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
});
