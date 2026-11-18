import { describe, expect, it } from 'vitest';
import { BUILT_IN_EXPORT_PRESETS } from '@lopsy/photos-core/library/presets';
import { DEFAULT_EXPORT_SETTINGS } from '@lopsy/photos-core/export/types';
import { DEFAULT_EXPORT_FORM, fitColorSpace, formFromSettings, locationKept, settingsFromForm } from './export-form';

describe('export form', () => {
  it('reads a preset into the form and back', () => {
    const web = BUILT_IN_EXPORT_PRESETS.find((p) => p.name.startsWith('Web'));
    expect(web).toBeDefined();
    if (!web) return;
    const form = formFromSettings(web.settings);
    expect(form).toEqual({ format: 'jpeg', quality: 85, longEdge: 2048, colorSpace: 'srgb' });
    const back = settingsFromForm(form, web.settings);
    expect(back.quality).toBeCloseTo(0.85);
    expect(back.maxLongEdge).toBe(2048);
    expect(back.metadata).toBe(web.settings.metadata);
  });

  it('offers what the engine encodes, TIFF at full size', () => {
    expect(fitColorSpace({ ...DEFAULT_EXPORT_FORM, format: 'jpeg', colorSpace: 'rec2020' }).colorSpace).toBe('srgb');
    // The engine has no Rec. 2020 yet, so it is not offered even for TIFF.
    expect(fitColorSpace({ ...DEFAULT_EXPORT_FORM, format: 'tiff', colorSpace: 'rec2020' }).colorSpace).toBe('srgb');
    expect(fitColorSpace({ ...DEFAULT_EXPORT_FORM, format: 'tiff', colorSpace: 'display-p3', longEdge: 2048 })).toMatchObject({
      colorSpace: 'display-p3',
      longEdge: null,
    });
    expect(settingsFromForm({ ...DEFAULT_EXPORT_FORM, format: 'png', colorSpace: 'rec2020' }).colorSpace).toBe('srgb');
  });

  it('says when the location will be kept', () => {
    expect(locationKept(DEFAULT_EXPORT_SETTINGS)).toBe(false);
    const keep = { ...DEFAULT_EXPORT_SETTINGS, metadata: 'all' as const, removeLocation: false };
    expect(locationKept(keep)).toBe(true);
    expect(locationKept({ ...keep, format: 'tiff' })).toBe(false);
    expect(locationKept({ ...keep, metadata: 'copyright' })).toBe(false);
  });
});
