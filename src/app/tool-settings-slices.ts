import type { WandSettings } from '../tools/wand/wand-settings';
import { DEFAULT_WAND_SETTINGS } from '../tools/wand/wand-settings';
import type { FillSettings } from '../tools/fill/fill-settings';
import { DEFAULT_FILL_SETTINGS } from '../tools/fill/fill-settings';
import type { MarqueeSettings } from '../tools/marquee/marquee-settings';
import { DEFAULT_MARQUEE_SETTINGS } from '../tools/marquee/marquee-settings';
import type { SmudgeSettings } from '../tools/smudge/smudge-settings';
import { DEFAULT_SMUDGE_SETTINGS } from '../tools/smudge/smudge-settings';
import type { PencilSettings } from '../tools/pencil/pencil-settings';
import { DEFAULT_PENCIL_SETTINGS } from '../tools/pencil/pencil-settings';
import type { SpongeSettings } from '../tools/sponge/sponge-settings';
import { DEFAULT_SPONGE_SETTINGS } from '../tools/sponge/sponge-settings';
import type { EraserSettings } from '../tools/eraser/eraser-settings';
import { DEFAULT_ERASER_SETTINGS } from '../tools/eraser/eraser-settings';
import type { PathSettings } from '../tools/path/path-settings';
import { DEFAULT_PATH_SETTINGS } from '../tools/path/path-settings';
import type { StampSettings } from '../tools/stamp/stamp-settings';
import { DEFAULT_STAMP_SETTINGS } from '../tools/stamp/stamp-settings';
import type { MagneticLassoSettings } from '../tools/magnetic-lasso/magnetic-lasso-settings';
import { DEFAULT_MAGNETIC_LASSO_SETTINGS } from '../tools/magnetic-lasso/magnetic-lasso-settings';
import type { TextSettings } from '../tools/text/text-settings';
import { DEFAULT_TEXT_SETTINGS } from '../tools/text/text-settings';
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
  wand: WandSettings;
  fill: FillSettings;
  marquee: MarqueeSettings;
  smudge: SmudgeSettings;
  pencil: PencilSettings;
  sponge: SpongeSettings;
  eraser: EraserSettings;
  path: PathSettings;
  stamp: StampSettings;
  magneticLasso: MagneticLassoSettings;
  text: TextSettings;
  spray: SpraySettings;
}

export const DEFAULT_TOOL_SETTINGS_SLICES: ToolSettingsSlices = {
  wand: DEFAULT_WAND_SETTINGS,
  fill: DEFAULT_FILL_SETTINGS,
  marquee: DEFAULT_MARQUEE_SETTINGS,
  smudge: DEFAULT_SMUDGE_SETTINGS,
  pencil: DEFAULT_PENCIL_SETTINGS,
  sponge: DEFAULT_SPONGE_SETTINGS,
  eraser: DEFAULT_ERASER_SETTINGS,
  path: DEFAULT_PATH_SETTINGS,
  stamp: DEFAULT_STAMP_SETTINGS,
  magneticLasso: DEFAULT_MAGNETIC_LASSO_SETTINGS,
  text: DEFAULT_TEXT_SETTINGS,
  spray: DEFAULT_SPRAY_SETTINGS,
};
