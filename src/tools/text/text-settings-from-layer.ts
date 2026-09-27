import type { TextLayer } from '../../types';
import type { TextSettings } from './text-settings';

type LayerBackedTextSettings = Omit<TextSettings, 'content'>;

/** The text-tool settings a committed text layer implies. */
export function textSettingsFromLayer(layer: TextLayer): LayerBackedTextSettings {
  return {
    fontSize: layer.fontSize,
    fontFamily: layer.fontFamily,
    fontWeight: layer.fontWeight,
    fontStyle: layer.fontStyle,
    align: layer.textAlign,
    underline: layer.underline,
    strikethrough: layer.strikethrough,
    lineHeight: layer.lineHeight,
    letterSpacing: layer.letterSpacing,
    paragraphSpacing: layer.paragraphSpacing,
    vertical: layer.vertical ?? false,
  };
}

/**
 * The settings that differ between `current` and what `layer` implies.
 * Empty when the tool settings already describe the layer, so callers can
 * skip a store write (and the re-render it triggers).
 */
export function textSettingsPatchFromLayer(
  layer: TextLayer,
  current: TextSettings,
): Partial<LayerBackedTextSettings> {
  const target = textSettingsFromLayer(layer);
  const patch: Partial<LayerBackedTextSettings> = {};
  for (const key of Object.keys(target) as (keyof LayerBackedTextSettings)[]) {
    if (target[key] !== current[key]) {
      (patch as Record<string, unknown>)[key] = target[key];
    }
  }
  return patch;
}
