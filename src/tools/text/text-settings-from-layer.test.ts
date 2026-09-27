import { describe, it, expect } from 'vitest';
import { textSettingsFromLayer, textSettingsPatchFromLayer } from './text-settings-from-layer';
import { DEFAULT_TEXT_SETTINGS } from './text-settings';
import type { TextLayer } from '../../types';

function makeLayer(overrides: Partial<TextLayer> = {}): TextLayer {
  return {
    fontSize: 40,
    fontFamily: "'Space Mono', monospace",
    fontWeight: 700,
    fontStyle: 'italic',
    textAlign: 'center',
    underline: true,
    strikethrough: false,
    lineHeight: 1.05,
    letterSpacing: 2,
    paragraphSpacing: 4,
    ...overrides,
  } as TextLayer;
}

describe('textSettingsFromLayer', () => {
  it('maps layer properties onto tool settings keys', () => {
    const s = textSettingsFromLayer(makeLayer());
    expect(s).toMatchObject({
      fontSize: 40,
      fontFamily: "'Space Mono', monospace",
      fontWeight: 700,
      fontStyle: 'italic',
      align: 'center',
      underline: true,
      lineHeight: 1.05,
      letterSpacing: 2,
      paragraphSpacing: 4,
      vertical: false,
    });
  });
});

describe('textSettingsPatchFromLayer (#943)', () => {
  it('returns only the settings that differ from the layer', () => {
    const current = { ...DEFAULT_TEXT_SETTINGS, fontSize: 80, fontWeight: 700 };
    const patch = textSettingsPatchFromLayer(makeLayer({ fontWeight: 700 }), current);
    expect(patch.fontSize).toBe(40);
    expect('fontWeight' in patch).toBe(false);
    expect(patch.align).toBe('center');
  });

  it('is empty when the tool already matches the layer', () => {
    const layer = makeLayer();
    const current = { ...DEFAULT_TEXT_SETTINGS, ...textSettingsFromLayer(layer) };
    expect(textSettingsPatchFromLayer(layer, current)).toEqual({});
  });
});
