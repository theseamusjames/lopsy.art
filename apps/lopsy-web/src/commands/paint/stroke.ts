import { CommandError } from '../command';
import { defineCommand } from '../registry';
import { requireDocument } from '../context';
import { docPointSpec, gestureNote, pointsSpec, runGesture } from '../gesture/run-gesture';
import { useEditorStore } from '../../app/editor-store';
import { useUIStore } from '../../app/ui-store';
import { stampSourceState } from '../../tools/common/stamp-source-state';
import type { Point, ToolId } from '../../types';

/** Spray is left out: it deposits on a timer while the button is held, and a command's stroke is instantaneous. */
export const STROKE_TOOLS = ['brush', 'pencil', 'eraser', 'smudge', 'dodge', 'sponge', 'stamp', 'healing'] as const;

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

export const paintStroke = defineCommand({
  id: 'paint.stroke',
  summary:
    'Paints a stroke through `points` with a painting tool, as dragging it on the canvas does (one point is a single dab or click), using the tool\'s current options and colours (set them first with tool.set and color.set). In layer-mask edit mode (mask.edit) or Quick Mask mode (quickmask.set) the brush, pencil and eraser paint the mask instead, as in the UI. `line` is a Shift-press: it joins the first point to where the previous stroke on this layer ended; with no previous stroke on the layer it is a plain dab, as in the UI. For stamp and healing, `source` is the Alt-click that sets the point to clone from, made before the stroke; without it the source set last is used. The stroke is instantaneous: the brush\'s speed-based size (off by default) sees a very fast stroke, and hold-to-smooth never fires. One history step, labelled as the UI labels it. Refused on a locked layer and on a text or group layer. Returns the tool, the layer id and whether a line was drawn.' + gestureNote('the chosen painting tool'),
  surface: 'document',
  params: {
    tool: { type: 'string', enum: STROKE_TOOLS, default: 'brush', description: 'The painting tool. spray is not offered: it paints on a timer while held.' },
    points: pointsSpec('The stroke\'s path: the press, then one pointer move per further point, released at the last.'),
    line: { type: 'boolean', default: false, description: 'Hold Shift on the press: a straight line from the previous stroke\'s end on this layer to the first point.' },
    source: { ...docPointSpec('stamp and healing only: the Alt-click that sets the clone source, made before the stroke.'), optional: true },
  },
  run({ tool, points, line, source }): StrokeResult {
    requireDocument();
    checkCloneSource(tool, source);
    if (source) runGesture({ tool, points: [source], alt: true });
    const isLine = joinsPreviousStroke(line);
    const { layer } = runGesture({ tool, points, shift: line });
    return { tool, layer, line: isLine };
  },
});
