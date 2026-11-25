import { describe, expect, it } from 'vitest';
import { formatCamera, formatCaptureTime, formatDimensions, formatExposure } from './format';

describe('photo facts', () => {
  it('writes capture times as the camera recorded them', () => {
    expect(formatCaptureTime('2026-11-14T16:02:11+01:00')).toBe('14 Nov 2026, 16:02');
    expect(formatCaptureTime('2026-01-03')).toBe('3 Jan 2026');
    expect(formatCaptureTime(null)).toBe('Unknown');
  });

  it('avoids repeating the make', () => {
    expect(formatCamera({ make: 'Canon', model: 'Canon EOS R5' })).toBe('Canon EOS R5');
    expect(formatCamera({ make: 'FUJIFILM', model: 'X-T5' })).toBe('Fujifilm X-T5');
  });

  it('writes exposure and size', () => {
    expect(formatExposure({ iso: 400, shutter: '1/250', aperture: 2.8, focalLength: 23 })).toBe('1/250 s · f/2.8 · ISO 400 · 23 mm');
    expect(formatExposure({ iso: null, shutter: null, aperture: null, focalLength: null })).toBeNull();
    expect(formatDimensions(6000, 4000)).toBe('6000 × 4000 (24 MP)');
    expect(formatDimensions(null, 4000)).toBeNull();
  });
});
