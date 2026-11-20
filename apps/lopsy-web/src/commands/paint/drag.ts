import { CommandError } from '../command';
import { defineCommand } from '../registry';
import { coordinateSpec, requireDocument } from '../context';
import { docPointSpec, gestureNote, runGesture, type GestureResult } from '../gesture/run-gesture';
import { useEditorStore } from '../../app/editor-store';
import { useUIStore } from '../../app/ui-store';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import { refusalError } from '../refusal';
import { CLICK_THRESHOLD as SHAPE_CLICK_THRESHOLD } from '../../tools/shape/shape-interaction';
import { isSymmetryOn } from '../../tools/symmetry';
import { bucketSeedRefusal } from '../../tools/fill/fill-interaction';
import type { Point } from '../../types';

function rounded(p: Point): Point {
  return { x: Math.round(p.x), y: Math.round(p.y) };
}

export const paintGradient = defineCommand({
  id: 'paint.gradient',
  summary:
    'Draws a gradient with the Gradient tool by dragging from `from` to `to`, as on the canvas: linear along the drag, radial centred on `from` with the drag as radius, with the type, stops and reverse from the tool\'s options (set them with tool.set). It fills the selection when one is active, else the whole layer; in mask edit or Quick Mask mode it draws into the mask. One history step ("Linear Gradient" or "Radial Gradient"). Refused on a locked layer and on a text or group layer. Returns the tool and the layer id.' + gestureNote('the Gradient tool'),
  surface: 'document',
  params: {
    from: docPointSpec('Where the drag starts: the gradient\'s first stop, or a radial gradient\'s centre.'),
    to: docPointSpec('Where the drag ends: the last stop, or the radial gradient\'s edge.'),
  },
  run({ from, to }): GestureResult {
    requireDocument();
    const [a, b] = [rounded(from), rounded(to)];
    if (a.x === b.x && a.y === b.y) {
      throw new CommandError('invalid', 'paint.gradient: from and to land on the same pixel; a click without a drag draws nothing.');
    }
    return runGesture({ tool: 'gradient', points: [from, to] });
  },
});

export interface ShapeResult extends GestureResult {
  /** Pixels on the layer, or a new closed path, as the tool's Output option says. */
  output: 'pixels' | 'path';
  /** The new path's id with path output, else null. */
  path: string | null;
}

function checkShapeDrag(from: Point, to: Point, constrain: boolean): void {
  const [a, b] = [rounded(from), rounded(to)];
  if (Math.hypot(b.x - a.x, b.y - a.y) < SHAPE_CLICK_THRESHOLD) {
    throw new CommandError('invalid', `paint.shape: from and to must be at least ${SHAPE_CLICK_THRESHOLD} px apart; a shorter drag is a click, which opens the Shape Size dialog in the UI.`);
  }
  if (a.x === b.x || a.y === b.y) {
    throw new CommandError('invalid', 'paint.shape: from and to must differ in both x and y, or the shape has no width or height.');
  }
  if (constrain && isSymmetryOn(useToolSettingsStore.getState())) {
    throw new CommandError('refused', 'With symmetry on, the Cmd/Ctrl press that constrains a shape sets the symmetry centre instead: turn symmetry off to draw a constrained shape.');
  }
}

function newPathId(before: number): string | null {
  const { paths } = useEditorStore.getState();
  return paths.length > before ? (paths[paths.length - 1]?.id ?? null) : null;
}

export const paintShape = defineCommand({
  id: 'paint.shape',
  summary:
    'Draws a shape with the Shape tool by dragging from `from` to `to`, as on the canvas. The shape grows from its centre: `from` is the centre and `to` a corner of its bounding box. Kind, fill, stroke, corner radius, sides and Output come from the tool\'s options (tool.set): with pixel output it paints the active layer ("Shape"), with path output it adds a closed path ("Add Path") and leaves the pixels alone. `constrain` is the Cmd/Ctrl press that makes the box square (a circle for the ellipse). Grid and guide snapping apply as in the UI. Refused on a locked layer, and with pixel output on a text or group layer. Returns the tool, the layer id, the output and the new path\'s id (null for pixels).' + gestureNote('the Shape tool'),
  surface: 'document',
  params: {
    from: docPointSpec('The press: the shape\'s centre.'),
    to: docPointSpec('The release: a corner of the shape\'s bounding box.'),
    constrain: { type: 'boolean', default: false, description: 'Hold Cmd/Ctrl: a square box, so a square or circle.' },
  },
  run({ from, to, constrain }): ShapeResult {
    requireDocument();
    checkShapeDrag(from, to, constrain);
    const output = useToolSettingsStore.getState().settings.shape.output === 'path' ? 'path' : 'pixels';
    const pathsBefore = useEditorStore.getState().paths.length;
    const result = runGesture({ tool: 'shape', points: [from, to], meta: constrain });
    return { ...result, output, path: output === 'path' ? newPathId(pathsBefore) : null };
  },
});

function fillsLayerPixels(): boolean {
  const { maskMode } = useUIStore.getState();
  if (maskMode === 'quickMask') return false;
  if (maskMode !== 'layerMask') return true;
  const doc = useEditorStore.getState().document;
  return !doc.layers.find((l) => l.id === doc.activeLayerId)?.mask;
}

function checkBucketSeed(x: number, y: number): void {
  if (!fillsLayerPixels()) return;
  const { document, selection } = useEditorStore.getState();
  const refusal = bucketSeedRefusal({ x: Math.floor(x), y: Math.floor(y) }, document.width, document.height, selection);
  if (refusal) throw refusalError(refusal);
}

export const paintBucket = defineCommand({
  id: 'paint.bucket',
  summary:
    'Clicks the Paint Bucket at (x, y): floods the region around that pixel with the foreground colour, as the tool does, using its tolerance and contiguous options (tool.set) and staying inside the selection; in mask edit or Quick Mask mode it floods the mask. The fill reads the layer\'s pixels first; the command resolves once it has landed. One history step ("Bucket Fill"). Refused on a locked layer, on a text or group layer, and (outside the mask modes) for a pixel outside the document or the selection, where a click does nothing. Returns the tool and the layer id.' + gestureNote('the Paint Bucket'),
  surface: 'document',
  params: {
    x: coordinateSpec('Document x of the clicked pixel; (0,0) is the top-left.'),
    y: coordinateSpec('Document y of the clicked pixel.'),
  },
  run({ x, y }): GestureResult {
    requireDocument();
    checkBucketSeed(x, y);
    return runGesture({ tool: 'fill', points: [{ x, y }] });
  },
});
