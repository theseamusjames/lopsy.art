/**
 * Convert between JS string offsets (UTF-16 code units) and the engine's text
 * offsets (UTF-8 bytes). The Rust text engine reports and accepts UTF-8 byte
 * offsets; the JS editing state (cursorPos / selectionAnchor) uses UTF-16
 * indices. These helpers bridge the two so non-ASCII text (accents, CJK, emoji)
 * maps correctly. For pure ASCII the two coincide.
 */

const encoder = new TextEncoder();

function utf8Len(codePoint: number): number {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

/** UTF-16 index → UTF-8 byte offset within `text`. */
export function utf16ToUtf8(text: string, index16: number): number {
  const clamped = Math.max(0, Math.min(text.length, index16));
  if (clamped === 0) return 0;
  return encoder.encode(text.slice(0, clamped)).length;
}

/** UTF-8 byte offset → UTF-16 index within `text` (rounds down to a code-point boundary). */
export function utf8ToUtf16(text: string, byteOffset: number): number {
  if (byteOffset <= 0) return 0;
  let bytes = 0;
  let index16 = 0;
  for (const ch of text) {
    const b = utf8Len(ch.codePointAt(0)!);
    if (bytes + b > byteOffset) break;
    bytes += b;
    index16 += ch.length;
    if (bytes >= byteOffset) break;
  }
  return index16;
}
