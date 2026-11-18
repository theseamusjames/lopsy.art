import { describe, expect, it } from 'vitest';
import { BUILT_IN_EXPORT_PRESETS } from '@lopsy/photos-core/library/presets';
import { DEFAULT_EXPORT_FORM, fitColorSpace, formFromSettings, settingsFromForm } from './export-form';

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

  it('keeps Rec. 2020 for 16-bit formats only', () => {
    expect(fitColorSpace({ ...DEFAULT_EXPORT_FORM, format: 'jpeg', colorSpace: 'rec2020' }).colorSpace).toBe('srgb');
    expect(fitColorSpace({ ...DEFAULT_EXPORT_FORM, format: 'tiff', colorSpace: 'rec2020' }).colorSpace).toBe('rec2020');
    expect(settingsFromForm({ ...DEFAULT_EXPORT_FORM, format: 'png', colorSpace: 'rec2020' }).colorSpace).toBe('srgb');
  });
});
