import type { FontStyle, TextAlign } from '../../types';

/**
 * Per-tool settings slice for the Text tool.
 *
 * Authoritative settings type for text. The slice lives under
 * `settings.text` on the global ToolSettings store (see #453).
 * Same pattern as `wand-settings.ts` / `fill-settings.ts` /
 * `marquee-settings.ts` / `smudge-settings.ts` / `pencil-settings.ts` /
 * `sponge-settings.ts` / `eraser-settings.ts` / `path-settings.ts` /
 * `stamp-settings.ts` / `magnetic-lasso-settings.ts`:
 * `<Tool>Settings` interface + `DEFAULT_<TOOL>_SETTINGS` + a
 * `clamp<Tool>Setting` helper, then registered in
 * `tool-settings-slices.ts`. Eight fields covering typography
 * (size, family, weight, style), layout (align), decoration
 * (underline, strikethrough), and the staged content string.
 *
 * Only `fontSize` carries a clamp range — the rest are either
 * trusted string identifiers (`fontFamily` from the font catalog),
 * tagged-union enums (`fontStyle`, `align`), or booleans whose set
 * of valid values is the type itself.
 */
export interface TextSettings {
  content: string;
  fontSize: number;
  fontFamily: string;
  fontWeight: number;
  fontStyle: FontStyle;
  align: TextAlign;
  underline: boolean;
  strikethrough: boolean;
}

export const DEFAULT_TEXT_SETTINGS: TextSettings = {
  content: 'Text',
  fontSize: 24,
  fontFamily: 'Inter, sans-serif',
  fontWeight: 400,
  fontStyle: 'normal',
  align: 'left',
  underline: false,
  strikethrough: false,
};

export function clampTextSetting<K extends keyof TextSettings>(
  key: K,
  value: TextSettings[K],
): TextSettings[K] {
  if (key === 'fontSize') {
    const n = value as number;
    return Math.max(1, Math.min(500, n)) as TextSettings[K];
  }
  return value;
}
