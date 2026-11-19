import { CommandError } from '../command';
import { defineCommand } from '../registry';
import { coordinateSpec, requireDocument } from '../context';
import { gestureNote, pointsSpec, runGesture } from '../gesture/run-gesture';
import { useEditorStore } from '../../app/editor-store';
import type { SelectionCombineMode } from '../../selection/selection';
import type { ToolId } from '../../types';

export interface ToolSelectResult {
  tool: ToolId;
}

const MODE_KEYS: Record<SelectionCombineMode, { shift: boolean; alt: boolean }> = {
  replace: { shift: false, alt: false },
  add: { shift: true, alt: false },
  subtract: { shift: false, alt: true },
  intersect: { shift: true, alt: true },
};

/** As paint.bucket refuses a seed outside the document (bucketSeedRefusal): the click does nothing there. */
function checkInDocument(x: number, y: number): void {
  const { width, height } = useEditorStore.getState().document;
  const px = Math.floor(x);
  const py = Math.floor(y);
  if (px < 0 || px >= width || py < 0 || py >= height) {
    throw new CommandError('refused', `(${px}, ${py}) is outside the ${width}x${height} document: a Magic Wand click there selects nothing.`);
  }
}

export const selectWand = defineCommand({
  id: 'select.wand',
  summary:
    'Clicks the Magic Wand at (x, y): selects the pixels of the active layer that match the clicked one, using the tool\'s tolerance, contiguous and graduated options (tool.set), combined with the current selection by `mode` as Shift / Alt / Shift+Alt do. The wand reads the layer\'s pixels before it selects, so the result is not known when the command returns: read the selection afterwards with doc.info. Works on a locked layer, as the tool does. Returns the tool.' + gestureNote('the Magic Wand'),
  surface: 'document',
  params: {
    x: coordinateSpec('Document x of the clicked pixel; (0,0) is the top-left.'),
    y: coordinateSpec('Document y of the clicked pixel.'),
    mode: {
      type: 'string',
      enum: ['replace', 'add', 'subtract', 'intersect'],
      default: 'replace',
      description: 'How the region combines with the current selection, as the modifier keys do: replace (no key), add (Shift), subtract (Alt), intersect (Shift+Alt). With nothing selected every mode replaces.',
    },
  },
  run({ x, y, mode }): ToolSelectResult {
    requireDocument();
    checkInDocument(x, y);
    const { tool } = runGesture({ tool: 'wand', points: [{ x, y }], ...MODE_KEYS[mode] });
    return { tool };
  },
});

export const selectQuick = defineCommand({
  id: 'select.quick',
  summary:
    'Drags the Quick Selection tool through `points`: grows the selection over similar pixels around the path, or shrinks it, as the tool\'s Add / Subtract option says, with its size, tolerance and edge options (tool.set; the tool takes no modifier keys). It reads the layer\'s pixels before it selects, so the result is not known when the command returns: read the selection afterwards with doc.info. Works on a locked layer. Returns the tool.' + gestureNote('the Quick Selection tool'),
  surface: 'document',
  params: {
    points: pointsSpec('The drag\'s path: the press, one pointer move per further point, released at the last.'),
  },
  run({ points }): ToolSelectResult {
    requireDocument();
    const { tool } = runGesture({ tool: 'quick-select', points });
    return { tool };
  },
});
