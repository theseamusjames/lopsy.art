import { defineCommand } from '../registry';
import { useUIStore } from '../../app/ui-store';
import { actualSize, chooseRenderer, fitToScreen, zoomStep } from '../../app/MenuBar/view-actions';
import { RULER_UNITS } from '../../app/rendering/ruler-units';
import { hasWebGpu, runningRenderer, storedRenderer } from '../../engine-wasm/renderer-choice';

const NO_RESULT = 'Returns nothing.';

export const uiViewZoomIn = defineCommand({
  id: 'ui.view.zoom-in',
  summary: `Zooms in to the next zoom level, as View > Zoom In does. ${NO_RESULT}`,
  surface: 'ui',
  settles: false,
  params: {},
  run(): void {
    zoomStep('in');
  },
});

export const uiViewZoomOut = defineCommand({
  id: 'ui.view.zoom-out',
  summary: `Zooms out to the previous zoom level, as View > Zoom Out does. ${NO_RESULT}`,
  surface: 'ui',
  settles: false,
  params: {},
  run(): void {
    zoomStep('out');
  },
});

export const uiViewFit = defineCommand({
  id: 'ui.view.fit',
  summary: `Zooms the document to fill 90% of the canvas area and centres it, as View > Fit to Screen does. ${NO_RESULT}`,
  surface: 'ui',
  settles: false,
  params: {},
  run(): void {
    fitToScreen();
  },
});

export const uiViewActualSize = defineCommand({
  id: 'ui.view.actual-size',
  summary: `Zooms to 100% and centres the document, as View > Actual Size does. ${NO_RESULT}`,
  surface: 'ui',
  settles: false,
  params: {},
  run(): void {
    actualSize();
  },
});

type UIStoreState = ReturnType<typeof useUIStore.getState>;

function defineToggle(id: string, item: string, isOn: (ui: UIStoreState) => boolean, toggle: (ui: UIStoreState) => void): void {
  defineCommand({
    id,
    summary: `Turns ${item} on or off, as View > ${item} does; checked while it is on. ${NO_RESULT}`,
    surface: 'ui',
    settles: false,
    params: {},
    checked(): boolean {
      return isOn(useUIStore.getState());
    },
    run(): void {
      toggle(useUIStore.getState());
    },
  });
}

defineToggle('ui.view.rulers', 'Show Rulers', (ui) => ui.showRulers, (ui) => ui.toggleRulers());
defineToggle('ui.view.grid', 'Show Grid', (ui) => ui.showGrid, (ui) => ui.toggleGrid());
defineToggle('ui.view.pixel-grid', 'Show Pixel Grid', (ui) => ui.showPixelGrid, (ui) => ui.togglePixelGrid());
defineToggle('ui.view.guides', 'Show Guides', (ui) => ui.showGuides, (ui) => ui.toggleGuides());
defineToggle('ui.view.snap-to-grid', 'Snap to Grid', (ui) => ui.snapToGrid, (ui) => ui.toggleSnapToGrid());
defineToggle('ui.view.snap-to-layers', 'Snap to Layers', (ui) => ui.snapToLayers, (ui) => ui.toggleSnapToLayers());
defineToggle('ui.view.snap-to-guides', 'Snap to Guides', (ui) => ui.snapToGuides, (ui) => ui.toggleSnapToGuides());
defineToggle('ui.view.seamless-pattern', 'Show Seamless Pattern', (ui) => ui.showSeamlessPattern, (ui) => ui.toggleSeamlessPattern());

export const uiViewRulerUnit = defineCommand({
  id: 'ui.view.ruler-unit',
  summary: `Sets the rulers' unit, as View > Units does (px pixels, pt points, in inches, mm millimetres); checked for the current unit. ${NO_RESULT}`,
  surface: 'ui',
  settles: false,
  params: { unit: { type: 'string', enum: RULER_UNITS } },
  checked({ unit }): boolean {
    return useUIStore.getState().rulerUnit === unit;
  },
  run({ unit }): void {
    useUIStore.getState().setRulerUnit(unit);
  },
});

export const uiViewRenderer = defineCommand({
  id: 'ui.view.renderer',
  summary: `Chooses the renderer the next page load uses, as View > Renderer does, and toasts which one is in use or that a reload switches to it; checked for the one chosen (or running). WebGPU is disabled where the browser has none. ${NO_RESULT}`,
  surface: 'ui',
  settles: false,
  params: { renderer: { type: 'string', enum: ['webgl', 'wgpu'], description: 'webgl: WebGL. wgpu: WebGPU (Experimental).' } },
  enabled({ renderer }): boolean {
    return !(renderer === 'wgpu' && !hasWebGpu());
  },
  checked({ renderer }): boolean {
    return (storedRenderer() ?? runningRenderer() ?? 'webgl') === renderer;
  },
  run({ renderer }): void {
    chooseRenderer(renderer);
  },
});
