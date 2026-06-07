import type { WandSettings } from '../tools/wand/wand-settings';
import { DEFAULT_WAND_SETTINGS } from '../tools/wand/wand-settings';
import type { FillSettings } from '../tools/fill/fill-settings';
import { DEFAULT_FILL_SETTINGS } from '../tools/fill/fill-settings';
import type { MarqueeSettings } from '../tools/marquee/marquee-settings';
import { DEFAULT_MARQUEE_SETTINGS } from '../tools/marquee/marquee-settings';
import type { DodgeSettings } from '../tools/dodge/dodge-settings';
import { DEFAULT_DODGE_SETTINGS } from '../tools/dodge/dodge-settings';

/**
 * Per-tool settings slices owned by the global ToolSettings store.
 *
 * Each tool defines a `<Tool>Settings` interface in its own directory
 * (`src/tools/<tool>/<tool>-settings.ts`) and registers it here. The
 * store exposes them as `settings.<tool>.<field>` instead of the legacy
 * flat-bag `<tool><Field>` naming. See #453 for the migration plan —
 * this record grows one entry per tool slice landed.
 */
export interface ToolSettingsSlices {
  wand: WandSettings;
  fill: FillSettings;
  marquee: MarqueeSettings;
  dodge: DodgeSettings;
}

export const DEFAULT_TOOL_SETTINGS_SLICES: ToolSettingsSlices = {
  wand: DEFAULT_WAND_SETTINGS,
  fill: DEFAULT_FILL_SETTINGS,
  marquee: DEFAULT_MARQUEE_SETTINGS,
  dodge: DEFAULT_DODGE_SETTINGS,
};
