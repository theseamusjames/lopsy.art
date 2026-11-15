import { useEditorStore } from '../../editor-store';
import { useUIStore } from '../../ui-store';
import { nextZoomLevel } from '../../../utils/zoom-levels';
import { RULER_UNITS, RULER_UNIT_LABELS } from '../../rendering/ruler-units';
import { hasWebGpu, runningRenderer, storedRenderer, storeRenderer, type Renderer } from '../../../engine-wasm/renderer-choice';
import { notifyInfo } from '../../notifications-store';
import type { MenuDef } from './types';

const RENDERER_NAMES: Record<Renderer, string> = { webgl: 'WebGL', wgpu: 'WebGPU' };
const RENDERER_LABELS: Record<Renderer, string> = { webgl: 'WebGL', wgpu: 'WebGPU (Experimental)' };

/**
 * The engine's two builds are separate downloads, chosen before either is
 * fetched, so a new choice takes effect on the next page load.
 */
function chooseRenderer(renderer: Renderer): void {
  storeRenderer(renderer);
  const name = RENDERER_NAMES[renderer];
  notifyInfo(
    runningRenderer() === renderer
      ? `Lopsy is using the ${name} renderer.`
      : `Lopsy will use the ${name} renderer the next time it loads. Reload the page to switch now.`,
  );
}

export function createViewMenu(): MenuDef {
  const ui = useUIStore.getState();
  const preferredRenderer = storedRenderer() ?? runningRenderer() ?? 'webgl';
  return {
    label: 'View',
    items: [
      {
        label: 'Zoom In', shortcut: '\u2318=',
        action: () => {
          const state = useEditorStore.getState();
          state.setZoom(nextZoomLevel(state.viewport.zoom, 'in'));
        },
      },
      {
        label: 'Zoom Out', shortcut: '\u2318-',
        action: () => {
          const state = useEditorStore.getState();
          state.setZoom(nextZoomLevel(state.viewport.zoom, 'out'));
        },
      },
      {
        label: 'Fit to Screen', shortcut: '\u23180',
        action: () => {
          const state = useEditorStore.getState();
          const { width, height } = state.document;
          const vp = state.viewport;
          if (vp.width > 0 && vp.height > 0) {
            state.setZoom(Math.min(vp.width / width, vp.height / height) * 0.9);
            state.setPan(0, 0);
          }
        },
      },
      {
        label: 'Actual Size', shortcut: '\u23181',
        action: () => {
          useEditorStore.getState().setZoom(1);
          useEditorStore.getState().setPan(0, 0);
        },
      },
      { separator: true, label: '' },
      {
        label: 'Show Rulers', shortcut: '\u2318R',
        checked: ui.showRulers,
        action: () => useUIStore.getState().toggleRulers(),
      },
      {
        label: 'Units',
        submenu: RULER_UNITS.map((unit) => ({
          label: RULER_UNIT_LABELS[unit],
          checked: ui.rulerUnit === unit,
          action: () => useUIStore.getState().setRulerUnit(unit),
        })),
      },
      {
        label: 'Show Grid', shortcut: "\u2318'",
        checked: ui.showGrid,
        action: () => useUIStore.getState().toggleGrid(),
      },
      {
        label: 'Show Pixel Grid',
        checked: ui.showPixelGrid,
        action: () => useUIStore.getState().togglePixelGrid(),
      },
      {
        label: 'Show Guides', shortcut: '\u2318;',
        checked: ui.showGuides,
        action: () => useUIStore.getState().toggleGuides(),
      },
      { separator: true, label: '' },
      {
        label: 'Snap to Grid',
        checked: ui.snapToGrid,
        action: () => useUIStore.getState().toggleSnapToGrid(),
      },
      {
        label: 'Snap to Layers',
        checked: ui.snapToLayers,
        action: () => useUIStore.getState().toggleSnapToLayers(),
      },
      {
        label: 'Snap to Guides',
        checked: ui.snapToGuides,
        action: () => useUIStore.getState().toggleSnapToGuides(),
      },
      { separator: true, label: '' },
      {
        label: 'Show Seamless Pattern',
        checked: ui.showSeamlessPattern,
        action: () => useUIStore.getState().toggleSeamlessPattern(),
      },
      { separator: true, label: '' },
      {
        label: 'Renderer',
        submenu: (['webgl', 'wgpu'] as const).map((renderer) => ({
          label: RENDERER_LABELS[renderer],
          checked: preferredRenderer === renderer,
          disabled: renderer === 'wgpu' && !hasWebGpu(),
          action: () => chooseRenderer(renderer),
        })),
      },
    ],
  };
}
