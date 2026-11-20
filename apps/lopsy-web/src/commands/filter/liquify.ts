import { CommandError } from '../command';
import { defineCommand } from '../registry';
import { requireDocument } from '../context';
import { MAX_GESTURE_POINTS, pointsSpec, runGesture } from '../gesture/run-gesture';
import { useEditorStore } from '../../app/editor-store';
import { useUIStore } from '../../app/ui-store';
import { applyLiquify, cancelLiquify, openLiquify } from '../../app/MenuBar/liquify-actions';
import { isFilteringMask } from '../../app/MenuBar/filter-target';
import { defaultLiquifySettings, type LiquifyMode } from '../../tools/liquify/liquify';
import type { Point } from '../../types';
import { requireSessionTarget, type SessionFilterResult } from './session-filters';

export interface LiquifyResult extends SessionFilterResult {
  /** Brush strokes made. */
  strokes: number;
  /** Dabs applied: one for each point of a stroke after its first. */
  dabs: number;
}

/** The Liquify panel's Mode select. */
export const LIQUIFY_MODES: readonly LiquifyMode[] = ['push', 'twirl-cw', 'twirl-ccw', 'bloat', 'pinch'];

/** The ranges of the Liquify panel's Brush Size and Pressure sliders. */
const SIZE = { min: 4, max: 500 };
const PRESSURE = { min: 1, max: 100 };
const MAX_STROKES = 100;

const DEFAULTS = defaultLiquifySettings();

interface StrokeParam {
  mode: LiquifyMode;
  size: number;
  pressure: number;
  points: Point[];
}

function ui() {
  return useUIStore.getState();
}

function checkTotal(strokes: readonly StrokeParam[]): number {
  const dabs = strokes.reduce((sum, stroke) => sum + stroke.points.length - 1, 0);
  if (dabs > MAX_GESTURE_POINTS) {
    throw new CommandError('invalid', `filter.liquify: the strokes make ${dabs} dabs between them, more than the ${MAX_GESTURE_POINTS} one call may apply: use fewer points, or apply and call again.`);
  }
  return dabs;
}

/** The active raster layer, refused where Filter > Liquify... would not start or its strokes would not land. */
function requireLiquifyTarget(): string {
  requireDocument();
  if (isFilteringMask()) {
    throw new CommandError('refused', 'Liquify writes the layer\'s pixels, and Filter > Liquify... is disabled in layer-mask edit mode: leave it first (mask.edit with enabled: false).');
  }
  const id = requireSessionTarget();
  const layer = useEditorStore.getState().document.layers.find((l) => l.id === id);
  if (layer?.type !== 'raster') throw new CommandError('refused', 'Liquify works on a raster layer.');
  if (layer.locked) throw new CommandError('refused', `"${layer.name}" is locked: unlock it to liquify it (layer.set with locked: false).`);
  return id;
}

/** One brush stroke on the open session: the panel's three controls set, then the drag. */
function stroke({ mode, size, pressure, points }: StrokeParam): void {
  ui().updateLiquifySettings({ mode, brushSize: size, pressure: pressure / 100 });
  runGesture({ points, session: 'liquify' });
}

export const filterLiquify = defineCommand({
  id: 'filter.liquify',
  summary:
    'Warps the active raster layer\'s pixels with brush strokes, as Filter > Liquify... does when its panel\'s Mode, Brush Size and Pressure are set, the brush is dragged on the canvas and Apply is pressed ("Liquify"). Each stroke is one drag: a press at its first point, which warps nothing, then one pointer move, and so one dab, for each further point. push shoves the pixels under the brush along the way the pointer came from the point before, by that distance times the pressure, so space a push stroke\'s points a few pixels apart (a quarter of the brush size or less) for a smooth smear; twirl-cw, twirl-ccw, bloat and pinch turn, swell or shrink the pixels under the brush a little with every dab wherever the pointer came from, so repeat a point to work on one spot. The strokes add up in one session, which is applied at once and never left open, also when a stroke fails (the layer is then as it was). The tool that is active does not change. One history step. Refused while a Liquify, Tilt-Shift or Mesh Warp session is open, in layer-mask edit mode (where the menu item is disabled), on a locked layer, and on a text or group layer with the text the menu toasts. Returns the layer id, target "pixels", and the strokes and dabs made.',
  surface: 'document',
  params: {
    strokes: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_STROKES,
      description: `The brush strokes, made in order on the same session; at most ${MAX_GESTURE_POINTS} dabs between them.`,
      items: {
        type: 'object',
        fields: {
          mode: { type: 'string', enum: LIQUIFY_MODES, default: DEFAULTS.mode, description: 'The panel\'s Mode: push (Push Forward), twirl-cw, twirl-ccw, bloat or pinch.' },
          size: { type: 'number', integer: true, min: SIZE.min, max: SIZE.max, default: DEFAULTS.brushSize, description: 'The panel\'s Brush Size: the diameter of the brush circle, in document pixels.' },
          pressure: {
            type: 'number',
            integer: true,
            min: PRESSURE.min,
            max: PRESSURE.max,
            default: Math.round(DEFAULTS.pressure * 100),
            description: 'The panel\'s Pressure, in percent: how far each dab moves the pixels at the middle of the brush.',
          },
          points: { ...pointsSpec('The stroke\'s path: the press, then one pointer move and one dab per further point, released at the last.'), minItems: 2 },
        },
      },
    },
  },
  run({ strokes }): LiquifyResult {
    const dabs = checkTotal(strokes);
    const layer = requireLiquifyTarget();
    openLiquify();
    if (!ui().liquify) throw new CommandError('refused', 'The Liquify session did not start.');
    try {
      for (const each of strokes) stroke(each);
      applyLiquify();
    } finally {
      if (ui().liquify) cancelLiquify();
    }
    return { layer, target: 'pixels', strokes: strokes.length, dabs };
  },
});
