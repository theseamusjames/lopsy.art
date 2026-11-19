import { defineCommand } from '../registry';
import { openLiquify } from '../../app/MenuBar/liquify-actions';
import { beginTiltShiftSession } from '../../app/MenuBar/tilt-shift-actions';
import { isFilteringMask } from '../../app/MenuBar/filter-target';

// Liquify and Tilt-Shift are on-canvas sessions over the layer's pixels;
// every other Filter item runs on the mask in mask edit mode (#1150).
function isPixelTarget(): boolean {
  return !isFilteringMask();
}

export const uiFilterLiquify = defineCommand({
  id: 'ui.filter.liquify',
  summary:
    'Filter > Liquify...: starts the on-canvas Liquify session on the active raster layer, as the menu item and Cmd+Shift+X do; brush strokes then push its pixels until the panel\'s Apply or Cancel. Disabled in layer-mask edit mode. Returns nothing.',
  surface: 'ui',
  params: {},
  enabled: isPixelTarget,
  run(): void {
    openLiquify();
  },
});

export const uiFilterTiltShift = defineCommand({
  id: 'ui.filter.tilt-shift',
  summary:
    'Filter > Tilt-Shift Blur...: starts the on-canvas Tilt-Shift session on the active layer, as the menu item does; it applies on the controls\' Apply or Enter. Disabled in layer-mask edit mode. Returns nothing.',
  surface: 'ui',
  params: {},
  enabled: isPixelTarget,
  run(): void {
    beginTiltShiftSession();
  },
});
