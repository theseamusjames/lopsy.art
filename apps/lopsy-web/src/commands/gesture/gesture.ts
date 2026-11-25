import { defineCommand } from '../registry';
import { SELECTABLE_TOOLS } from '../tool/tool';
import { OPEN_SESSION_NOTE, pointsSpec, runGesture, type GestureResult } from './run-gesture';

export const toolGesture = defineCommand({
  id: 'tool.gesture',
  summary:
    'The low-level escape hatch: performs a raw canvas gesture with a tool (default: the active tool) for anything no named command covers (a Crop drag, Pen clicks, an Eyedropper click, a Text click, Shift/Alt/Cmd variants, a Move drag of selected pixels...). Coordinates are document pixels, not screen pixels: the press is at the first point, each further point is one pointer move, and the release is at the last; one point is a click. It runs through the same dispatcher as the pointer, with the tool\'s current options, and does whatever that gesture does in the UI, dialogs included. It is instantaneous, so time-based behaviour (hold-to-smooth, spray build-up, brush speed) does not happen. Prefer the named commands (paint.stroke, paint.gradient, paint.shape, paint.bucket, select.wand, select.quick, layer.move), which check their inputs and say what they made. Refused on a locked layer for tools the lock applies to, and on a text or group layer for tools that write pixels. Returns the tool and the layer that was active at the press.' + ' ' + OPEN_SESSION_NOTE,
  surface: 'document',
  params: {
    tool: { type: 'string', enum: SELECTABLE_TOOLS, optional: true, description: 'The tool to gesture with, selected first as tool.select does. Omitted means the active tool.' },
    points: pointsSpec('The gesture\'s path: the press, one pointer move per further point, released at the last.'),
    shift: { type: 'boolean', default: false, description: 'Shift held through the gesture.' },
    alt: { type: 'boolean', default: false, description: 'Alt/Option held through the gesture.' },
    meta: { type: 'boolean', default: false, description: 'Cmd (Ctrl on Windows/Linux) held through the gesture.' },
    clicks: { type: 'number', integer: true, min: 1, max: 3, optional: true, description: 'The press\'s click count: 2 for a double-click.' },
  },
  run({ tool, points, shift, alt, meta, clicks }): GestureResult {
    return runGesture({ tool, points, shift, alt, meta, clicks });
  },
});
