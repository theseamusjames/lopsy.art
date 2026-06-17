import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TEXT_SETTINGS,
  clampTextSetting,
  type TextSettings,
} from './text-settings';

describe('text-settings clamps and defaults (#453)', () => {
  it('defaults match the values the flat-bag store carried', () => {
    expect(DEFAULT_TEXT_SETTINGS).toEqual({
      content: 'Text',
      fontSize: 24,
      fontFamily: 'Inter, sans-serif',
      fontWeight: 400,
      fontStyle: 'normal',
      align: 'left',
      underline: false,
      strikethrough: false,
    } satisfies TextSettings);
  });

  it('clamps fontSize into [1, 500]', () => {
    expect(clampTextSetting('fontSize', 0)).toBe(1);
    expect(clampTextSetting('fontSize', -5)).toBe(1);
    expect(clampTextSetting('fontSize', 99999)).toBe(500);
    expect(clampTextSetting('fontSize', 24)).toBe(24);
    expect(clampTextSetting('fontSize', 500)).toBe(500);
    expect(clampTextSetting('fontSize', 1)).toBe(1);
  });

  it('does not round fontSize — preserves fractional sizes', () => {
    // Sub-pixel font sizes are meaningful for animations and HDPI rendering,
    // so the clamp range guards the bounds without forcing integer values.
    expect(clampTextSetting('fontSize', 24.5)).toBe(24.5);
    expect(clampTextSetting('fontSize', 36.25)).toBe(36.25);
  });

  it('passes string fields through untouched', () => {
    expect(clampTextSetting('fontFamily', 'Comic Sans MS')).toBe('Comic Sans MS');
    expect(clampTextSetting('content', 'Hello, world')).toBe('Hello, world');
    // Empty strings pass through — the engine handles empty content,
    // and an empty fontFamily falls back to the browser default.
    expect(clampTextSetting('fontFamily', '')).toBe('');
    expect(clampTextSetting('content', '')).toBe('');
  });

  it('passes enum fields through untouched', () => {
    expect(clampTextSetting('fontStyle', 'italic')).toBe('italic');
    expect(clampTextSetting('fontStyle', 'normal')).toBe('normal');
    expect(clampTextSetting('align', 'center')).toBe('center');
    expect(clampTextSetting('align', 'justify')).toBe('justify');
  });

  it('passes booleans through untouched', () => {
    expect(clampTextSetting('underline', true)).toBe(true);
    expect(clampTextSetting('underline', false)).toBe(false);
    expect(clampTextSetting('strikethrough', true)).toBe(true);
    expect(clampTextSetting('strikethrough', false)).toBe(false);
  });
});
