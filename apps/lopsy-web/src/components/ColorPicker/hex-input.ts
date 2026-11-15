import { rgbToHex6 } from '../../utils/color';
import type { Color } from '../../types';

interface Rgb {
  r: number;
  g: number;
  b: number;
}

const HEX_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Parse what the user typed into the picker's hex field: 3 or 6 hex digits,
 * with or without a leading `#`, surrounding whitespace ignored. Returns null
 * for anything else (including the 8-digit RGBA form — the picker's alpha
 * has its own bar, and the field must not silently change it).
 */
export function parseHexInput(text: string): Rgb | null {
  const match = HEX_PATTERN.exec(text.trim());
  const digits = match?.[1];
  if (!digits) return null;
  const full = digits.length === 3
    ? digits.split('').map((d) => d + d).join('')
    : digits;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

/** The field's display form of a color: six uppercase digits, no `#`. */
export function formatHexInput(color: Color): string {
  return rgbToHex6(color).slice(1).toUpperCase();
}
