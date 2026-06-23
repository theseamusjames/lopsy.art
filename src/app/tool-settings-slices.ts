import type { SpraySettings } from '../tools/spray/spray-settings';
import { DEFAULT_SPRAY_SETTINGS } from '../tools/spray/spray-settings';

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
  spray: SpraySettings;
}

export const DEFAULT_TOOL_SETTINGS_SLICES: ToolSettingsSlices = {
  spray: DEFAULT_SPRAY_SETTINGS,
};
