import type { FontStyle, TextAlign } from '../../types';

export interface TextStyle {
  fontSize: number;
  fontFamily: string;
  fontWeight: number;
  fontStyle: FontStyle;
  color: { r: number; g: number; b: number; a: number };
  lineHeight: number;
  letterSpacing: number;
  textAlign: TextAlign;
}

/** Build a CSS font string from style parameters. */
export function buildFontString(style: TextStyle): string {
  return `${style.fontStyle} ${style.fontWeight} ${style.fontSize}px ${style.fontFamily}`;
}

/**
 * Break text into lines that fit within maxWidth.
 * If maxWidth is null, each paragraph (split by \n) is one line (point text).
 */
export function wrapText(
  text: string,
  maxWidth: number | null,
  measureWidth: (text: string) => number,
): string[] {
  const paragraphs = text.split('\n');

  if (maxWidth === null || maxWidth <= 0) {
    return paragraphs;
  }

  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    if (paragraph === '') {
      lines.push('');
      continue;
    }

    const words = paragraph.split(/(\s+)/);
    let currentLine = '';

    for (const word of words) {
      if (currentLine === '') {
        currentLine = word;
        continue;
      }

      const testLine = currentLine + word;
      if (measureWidth(testLine) <= maxWidth) {
        currentLine = testLine;
      } else {
        // If the word itself is a space separator, just push current line
        if (/^\s+$/.test(word)) {
          lines.push(currentLine);
          currentLine = '';
        } else {
          lines.push(currentLine);
          currentLine = word;
        }
      }
    }

    if (currentLine !== '') {
      lines.push(currentLine);
    }
  }

  // If input ends with newline, add empty trailing line
  if (text.endsWith('\n')) {
    lines.push('');
  }

  return lines;
}

/**
 * Compute the x offset for a line of text given alignment and container width.
 *
 * For area text (containerWidth is a number), the offset is measured from the
 * left edge of the container. For point text (containerWidth is null), the
 * offset is measured from the click anchor and may be negative — center
 * alignment shifts the line so the anchor sits at its midpoint, right
 * alignment shifts it so the anchor sits at its trailing edge.
 */
export function alignLineX(
  lineWidth: number,
  containerWidth: number | null,
  align: TextAlign,
): number {
  if (containerWidth === null) {
    switch (align) {
      case 'center': return -lineWidth / 2;
      case 'right': return -lineWidth;
      default: return 0;
    }
  }
  switch (align) {
    case 'center': return (containerWidth - lineWidth) / 2;
    case 'right': return containerWidth - lineWidth;
    default: return 0;
  }
}
