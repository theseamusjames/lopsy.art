import { CommandError } from '../command';
import { defineCommand } from '../registry';
import { requireDocument } from '../context';
import { docPointSpec, gestureNote, pointsSpec, runGesture, runPacedGesture } from '../gesture/run-gesture';
import { useEditorStore } from '../../app/editor-store';
import { useUIStore } from '../../app/ui-store';
import { stampSourceState } from '../../tools/common/stamp-source-state';
import type { Point, ToolId } from '../../types';

export const STROKE_TOOLS = ['brush', 'pencil', 'eraser', 'smudge', 'dodge', 'sponge', 'stamp', 'healing', 'spray'] as const;

/** The longest the pointer may rest at one point of a spray stroke, and in one stroke altogether, in milliseconds. */
export const MAX_DWELL_MS = 2000;
export const MAX_STROKE_DWELL_MS = 10_000;

type StrokeTool = (typeof STROKE_TOOLS)[number];

const CLONE_TOOLS: ReadonlySet<ToolId> = new Set<ToolId>(['stamp', 'healing']);

export interface StrokeResult {
  tool: StrokeTool;
  layer: string;
  /** Whether the press was joined to the previous stroke's end by a straight line. */
  line: boolean;
}

function joinsPreviousStroke(isLine: boolean): boolean {
  if (!isLine) return false;
  const last = useUIStore.getState().lastPaintPoint;
  return last !== null && last.layerId === useEditorStore.getState().document.activeLayerId;
}

function checkCloneSource(tool: StrokeTool, source: Point | undefined): void {
  if (!CLONE_TOOLS.has(tool)) {
    if (source) throw new CommandError('invalid', `paint.stroke: source is only for the stamp and healing tools, not ${tool}.`);
    return;
  }
  if (!source && !stampSourceState.source) {
    throw new CommandError('refused', `No clone source is set for the ${tool} tool: pass source, the point to sample from, as an Alt-click sets it in the UI.`);
  }
}

/** Spray reads no Shift key and is the one tool that works while held still; `dwell` is real time, so it is bounded. */
function checkSpray(tool: StrokeTool, isLine: boolean, dwell: number, points: number): void {
  if (tool !== 'spray') {
    if (dwell > 0) throw new CommandError('invalid', `paint.stroke: dwell is only for the spray tool, which deposits while it is held still; a ${tool} stroke is instantaneous.`);
    return;
  }
  if (isLine) throw new CommandError('invalid', 'paint.stroke: line is not for the spray tool, which has no Shift-click line: list the points to spray along instead.');
  if (dwell * points > MAX_STROKE_DWELL_MS) {
    throw new CommandError(
      'invalid',
      `paint.stroke: a dwell of ${dwell} ms at each of ${points} points is ${dwell * points} ms, more than the ${MAX_STROKE_DWELL_MS} ms one stroke may rest: use fewer points or a shorter dwell.`,
    );
  }
}

function rest(ms: number): () => Promise<void> {
  return () => new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export const paintStroke = defineCommand({
  id: 'paint.stroke',
  summary:
    'Paints a stroke through `points` with a painting tool, as dragging it on the canvas does (one point is a single dab or click), using the tool\'s current options and colours (set them first with tool.set and color.set). In layer-mask edit mode (mask.edit) or Quick Mask mode (quickmask.set) the brush, pencil, eraser and spray paint the mask instead, as in the UI. `line` is a Shift-press: it joins the first point to where the previous stroke on this layer ended; with no previous stroke on the layer it is a plain dab, as in the UI. For stamp and healing, `source` is the Alt-click that sets the point to clone from, made before the stroke; without it the source set last is used. The stroke is instantaneous: the brush\'s speed-based size (off by default) sees a very fast stroke, and hold-to-smooth never fires. spray is the exception. It scatters a burst of dots (its Density) inside its Size at the press and along each move, and while the button is held it adds a burst every 166 ms where the pointer is; `dwell` holds the pointer still for that many milliseconds of real time at every point, the press included, so the paint builds up there as it does under a hand that lingers, and the command takes that long to return. Its dots are random, so no two spray strokes are alike. One history step, labelled as the UI labels it. Refused on a locked layer and on a text or group layer. Returns the tool, the layer id and whether a line was drawn.' + gestureNote('the chosen painting tool'),
  surface: 'document',
  params: {
    tool: { type: 'string', enum: STROKE_TOOLS, default: 'brush', description: 'The painting tool.' },
    points: pointsSpec('The stroke\'s path: the press, then one pointer move per further point, released at the last.'),
    line: { type: 'boolean', default: false, description: 'Hold Shift on the press: a straight line from the previous stroke\'s end on this layer to the first point. Not for spray.' },
    source: { ...docPointSpec('stamp and healing only: the Alt-click that sets the clone source, made before the stroke.'), optional: true },
    dwell: {
      type: 'number',
      integer: true,
      min: 0,
      max: MAX_DWELL_MS,
      default: 0,
      description: `spray only: milliseconds of real time the pointer rests at every point, the press included, while the spray keeps depositing (a burst about every 166 ms). 0 to ${MAX_DWELL_MS}, and at most ${MAX_STROKE_DWELL_MS} ms over the whole stroke. Default 0: only the bursts of the press and the moves.`,
    },
  },
  run({ tool, points, line, source, dwell }): StrokeResult | Promise<StrokeResult> {
    requireDocument();
    checkSpray(tool, line, dwell, points.length);
    checkCloneSource(tool, source);
    if (dwell > 0) return runPacedGesture({ tool, points }, rest(dwell)).then(({ layer }) => ({ tool, layer, line: false }));
    if (source) runGesture({ tool, points: [source], alt: true });
    const isLine = joinsPreviousStroke(line);
    const { layer } = runGesture({ tool, points, shift: line });
    return { tool, layer, line: isLine };
  },
});
