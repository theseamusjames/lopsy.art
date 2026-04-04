import { describe, it, expect } from 'vitest';
import { wrapText, alignLineX, buildFontString } from './text';
import type { TextStyle } from './text';

const defaultStyle: TextStyle = {
  fontSize: 24,
  fontFamily: 'Inter, sans-serif',
  fontWeight: 400,
  fontStyle: 'normal',
  color: { r: 0, g: 0, b: 0, a: 1 },
  lineHeight: 1.4,
  letterSpacing: 0,
  textAlign: 'left',
};

// Simple measureWidth: each character is 10px wide
const charWidth = 10;
const measureWidth = (text: string): number => text.length * charWidth;

describe('buildFontString', () => {
  it('builds correct CSS font string', () => {
    expect(buildFontString(defaultStyle)).toBe('normal 400 24px Inter, sans-serif');
  });

  it('handles italic bold', () => {
    const style: TextStyle = { ...defaultStyle, fontStyle: 'italic', fontWeight: 700 };
    expect(buildFontString(style)).toBe('italic 700 24px Inter, sans-serif');
  });
});

describe('wrapText', () => {
  it('returns single line for point text (null width)', () => {
    const lines = wrapText('Hello world', null, measureWidth);
    expect(lines).toEqual(['Hello world']);
  });

  it('preserves explicit newlines in point text', () => {
    const lines = wrapText('Line 1\nLine 2\nLine 3', null, measureWidth);
    expect(lines).toEqual(['Line 1', 'Line 2', 'Line 3']);
  });

  it('wraps text at word boundaries for area text', () => {
    // "Hello world" = 11 chars = 110px, maxWidth = 80px
    const lines = wrapText('Hello world', 80, measureWidth);
    expect(lines).toEqual(['Hello ', 'world']);
  });

  it('handles multiple words wrapping across lines', () => {
    // "one two three four" with maxWidth=100 (10 chars)
    const lines = wrapText('one two three four', 100, measureWidth);
    // "one two " = 8 chars = 80px fits
    // "one two three " = 14 chars = 140px > 100, so break
    // "three " = 6 chars = 60px fits
    // "three four" = 10 chars = 100px fits
    expect(lines.length).toBeGreaterThan(1);
    // Every line should be within max width
    for (const line of lines) {
      expect(measureWidth(line)).toBeLessThanOrEqual(100);
    }
  });

  it('returns empty line for empty paragraph', () => {
    const lines = wrapText('', null, measureWidth);
    expect(lines).toEqual(['']);
  });

  it('handles newlines in area text', () => {
    const lines = wrapText('First\nSecond', 200, measureWidth);
    expect(lines).toEqual(['First', 'Second']);
  });

  it('wraps within paragraphs in area text', () => {
    // "Hello world" = 110px, maxWidth = 80px
    // Each paragraph wraps independently
    const lines = wrapText('Hello world\nFoo bar', 80, measureWidth);
    expect(lines.length).toBe(3);
    expect(lines[0]).toBe('Hello ');
    expect(lines[1]).toBe('world');
    expect(lines[2]).toBe('Foo bar');
  });

  it('handles trailing newline', () => {
    const lines = wrapText('Hello\n', null, measureWidth);
    expect(lines).toEqual(['Hello', '']);
  });
});

describe('alignLineX', () => {
  it('returns 0 for left alignment', () => {
    expect(alignLineX(50, 200, 'left')).toBe(0);
  });

  it('centers text', () => {
    expect(alignLineX(50, 200, 'center')).toBe(75);
  });

  it('right-aligns text', () => {
    expect(alignLineX(50, 200, 'right')).toBe(150);
  });

  it('returns 0 for justify (justify is handled differently)', () => {
    expect(alignLineX(50, 200, 'justify')).toBe(0);
  });

  it('returns 0 when containerWidth is null (point text)', () => {
    expect(alignLineX(50, null, 'center')).toBe(0);
    expect(alignLineX(50, null, 'right')).toBe(0);
  });
});
