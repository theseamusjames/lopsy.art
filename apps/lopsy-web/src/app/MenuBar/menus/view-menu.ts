import { RULER_UNITS, RULER_UNIT_LABELS } from '../../rendering/ruler-units';
import type { Renderer } from '../../../engine-wasm/renderer-choice';
import { commandItem } from './command-item';
import type { MenuDef } from './types';

const RENDERER_LABELS: Record<Renderer, string> = { webgl: 'WebGL', wgpu: 'WebGPU (Experimental)' };

export function createViewMenu(): MenuDef {
  return {
    label: 'View',
    items: [
      commandItem('Zoom In', 'ui.view.zoom-in', undefined, '⌘='),
      commandItem('Zoom Out', 'ui.view.zoom-out', undefined, '⌘-'),
      commandItem('Fit to Screen', 'ui.view.fit', undefined, '⌘0'),
      commandItem('Actual Size', 'ui.view.actual-size', undefined, '⌘1'),
      { separator: true, label: '' },
      commandItem('Show Rulers', 'ui.view.rulers', undefined, '⌘R'),
      {
        label: 'Units',
        submenu: RULER_UNITS.map((unit) => commandItem(RULER_UNIT_LABELS[unit], 'ui.view.ruler-unit', { unit })),
      },
      commandItem('Show Grid', 'ui.view.grid', undefined, "⌘'"),
      commandItem('Show Pixel Grid', 'ui.view.pixel-grid'),
      commandItem('Show Guides', 'ui.view.guides', undefined, '⌘;'),
      { separator: true, label: '' },
      commandItem('Snap to Grid', 'ui.view.snap-to-grid'),
      commandItem('Snap to Layers', 'ui.view.snap-to-layers'),
      commandItem('Snap to Guides', 'ui.view.snap-to-guides'),
      { separator: true, label: '' },
      commandItem('Show Seamless Pattern', 'ui.view.seamless-pattern'),
      { separator: true, label: '' },
      {
        label: 'Renderer',
        submenu: (['webgl', 'wgpu'] as const).map((renderer) =>
          commandItem(RENDERER_LABELS[renderer], 'ui.view.renderer', { renderer }),
        ),
      },
    ],
  };
}
