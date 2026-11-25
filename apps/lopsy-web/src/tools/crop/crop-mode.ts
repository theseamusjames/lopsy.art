import { useToolSettingsStore } from '../../app/tool-settings-store';
import { useUIStore } from '../../app/ui-store';
import type { CropSettings } from './crop-settings';

/** The Crop options' Mode select. */
export function setCropMode(mode: CropSettings['mode']): void {
  useToolSettingsStore.getState().setCropSetting('mode', mode);
  // Clear any active overlay when switching modes
  const ui = useUIStore.getState();
  ui.setPerspectiveCropQuad(null);
  ui.setPerspectiveCropDragging(null);
}
