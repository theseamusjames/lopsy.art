import { CommandError } from '../command';
import { defineCommand } from '../registry';
import { refusalError } from '../refusal';
import { offsetSpec, requireDocument, requireEngine } from '../context';
import { checkNoOpenSession } from '../gesture/run-gesture';
import { useEditorStore } from '../../app/editor-store';
import { useUIStore } from '../../app/ui-store';
import {
  applyMeshWarp,
  DEFAULT_MESH_WARP_GRID_SIZE,
  MESH_WARP_GRID_SIZES,
  meshWarpBounds,
} from '../../app/MenuBar/mesh-warp-actions';
import { meshPointAt } from '../../app/interactions/mesh-warp-handlers';
import { applyTiltShift, beginTiltShiftSession, cancelTiltShift } from '../../app/MenuBar/tilt-shift-actions';
import { isFilteringMask } from '../../app/MenuBar/filter-target';
import { createIdentityGrid, type MeshWarpGrid } from '../../filters/mesh-warp';
import { pixelWriteRefusal } from '../../layers/paint-target';
import type { Rect } from '../../types';

/** What the session filters write: always the layer's pixels, as their sessions do even in mask edit mode. */
export interface SessionFilterResult {
  layer: string;
  target: 'pixels';
}

export interface MeshWarpResult extends SessionFilterResult {
  /** The document rect the grid covered. */
  bounds: Rect;
}

/** The active layer, refused as the session's start refuses it (with the toast it shows), with the engine running. */
export function requireSessionTarget(): string {
  const doc = requireDocument();
  checkNoOpenSession();
  const layer = doc.layers.find((l) => l.id === doc.activeLayerId);
  const refusal = pixelWriteRefusal(layer);
  if (refusal || !layer) throw refusalError(refusal ?? { reason: 'There is no active layer.', notice: null });
  requireEngine();
  return layer.id;
}

const MIN_GRID_SIZE = Math.min(...MESH_WARP_GRID_SIZES);
const MAX_GRID_SIZE = Math.max(...MESH_WARP_GRID_SIZES);

const gridIndexSpec = (what: string) =>
  ({ type: 'number', integer: true, min: 0, max: MAX_GRID_SIZE - 1, description: `The point's ${what}, from 0 to gridSize - 1.` }) as const;

interface MeshPointParam {
  col: number;
  row: number;
  dx: number;
  dy: number;
}

/** The session's grid with each listed point dragged by its offset, converted to grid units as the drag handler converts the pointer. */
function displacedGrid(size: number, points: readonly MeshPointParam[], bounds: Rect): MeshWarpGrid {
  const grid = createIdentityGrid(size, size);
  const seen = new Set<number>();
  for (const { col, row, dx, dy } of points) {
    if (col >= size || row >= size) {
      throw new CommandError('invalid', `filter.mesh-warp: the point (col ${col}, row ${row}) is outside a ${size} x ${size} grid.`);
    }
    const index = row * size + col;
    if (seen.has(index)) throw new CommandError('invalid', `filter.mesh-warp: the point (col ${col}, row ${row}) is listed twice.`);
    seen.add(index);
    const identity = grid.points[index];
    if (!identity) throw new Error(`filter.mesh-warp: the identity grid has no point ${index}`);
    const dragTo = { x: bounds.x + identity.x * bounds.width + dx, y: bounds.y + identity.y * bounds.height + dy };
    grid.points[index] = meshPointAt(dragTo, bounds);
  }
  return grid;
}

export const filterMeshWarp = defineCommand({
  id: 'filter.mesh-warp',
  summary:
    'Warps the active layer\'s pixels with a grid of control points, as the Move tool\'s Mesh Warp controls do when points are dragged and Apply is pressed with Preview off ("Mesh Warp"). The grid covers the selection\'s bounding box when there is a selection, else the whole document, and pixels outside it are unchanged; its points start evenly spaced, (col 0, row 0) at the top-left, and each point listed moves by (dx, dy), taking the image with it, but never past the grid\'s edge. It applies at once and leaves no session open. Refused while a Liquify, Tilt-Shift or Mesh Warp session is open, and on a text or group layer with the text the controls toast. As in the UI it writes the layer\'s pixels in mask edit mode too. Returns the layer id, target "pixels" and the grid\'s bounds.',
  surface: 'document',
  params: {
    gridSize: {
      type: 'number',
      integer: true,
      min: MIN_GRID_SIZE,
      max: MAX_GRID_SIZE,
      default: DEFAULT_MESH_WARP_GRID_SIZE,
      description: `Points per side, as the Grid size select offers: ${MESH_WARP_GRID_SIZES.join(', ')}.`,
    },
    points: {
      type: 'array',
      default: [],
      maxItems: MAX_GRID_SIZE * MAX_GRID_SIZE,
      description: 'The points to move, each once; points left out stay where they are. An empty list applies the grid unmoved, as Apply with no drag does.',
      items: {
        type: 'object',
        fields: {
          col: gridIndexSpec('column, 0 at the left'),
          row: gridIndexSpec('row, 0 at the top'),
          dx: offsetSpec('How far the point moves right (negative: left), in document pixels; fractions are allowed.'),
          dy: offsetSpec('How far the point moves down (negative: up), in document pixels.'),
        },
      },
    },
  },
  run({ gridSize, points }): MeshWarpResult {
    const layer = requireSessionTarget();
    const { document: doc, selection } = useEditorStore.getState();
    const bounds = meshWarpBounds(selection.active, selection.bounds, doc.width, doc.height);
    const grid = displacedGrid(gridSize, points as readonly MeshPointParam[], bounds);
    applyMeshWarp(grid, bounds);
    return { layer, target: 'pixels', bounds };
  },
});

const unitSpec = (initial: number, description: string) =>
  ({ type: 'number', min: 0, max: 1, default: initial, description }) as const;

export const filterTiltShift = defineCommand({
  id: 'filter.tilt-shift',
  summary:
    'Blurs the active layer\'s pixels outside a sharp band, as Filter > Tilt-Shift Blur... does when its band is dragged on the canvas, its Blur Radius slider set and Apply pressed ("Tilt-Shift Blur"); the blur fades in over a further 0.15 of the document past each edge of the band. The values are those of the on-canvas session, in fractions of the document, and the defaults are what it starts with. It applies at once and leaves no session open. Refused while a Liquify, Tilt-Shift or Mesh Warp session is open, in layer-mask edit mode (where the menu item is disabled), and on a text or group layer with the text the menu toasts. Returns the layer id and target "pixels".',
  surface: 'document',
  params: {
    focusPosition: unitSpec(0.5, 'Where the middle of the sharp band lies across the document: at angle 0, 0 is the top edge, 0.5 the middle and 1 the bottom; at angle 90, 0 is the right edge and 1 the left.'),
    focusWidth: unitSpec(0.4, 'How wide the sharp band is, as a fraction of the document across it: 0 leaves only a line sharp, 1 the whole document.'),
    blurRadius: { type: 'number', integer: true, min: 1, max: 32, default: 12, description: 'The Blur Radius slider: how strong the blur is outside the band, in pixels.' },
    angle: {
      type: 'number',
      min: 0,
      max: 360,
      default: 0,
      description: 'The band\'s turn in degrees, as the overlay\'s rotate handle sets it: 0 is a horizontal band, and a larger angle turns it clockwise (90 is a vertical band). The angle is measured with the document stretched to a square, so on a non-square document the band lies at the angle only at 0, 90, 180 and 270.',
    },
  },
  run({ focusPosition, focusWidth, blurRadius, angle }): SessionFilterResult {
    requireDocument();
    if (isFilteringMask()) {
      throw new CommandError('refused', 'Tilt-Shift Blur writes the layer\'s pixels, and Filter > Tilt-Shift Blur... is disabled in layer-mask edit mode: leave it first (mask.edit with enabled: false).');
    }
    const layer = requireSessionTarget();
    beginTiltShiftSession();
    const ui = useUIStore.getState;
    if (!ui().tiltShift) throw new CommandError('refused', 'The Tilt-Shift session did not start.');
    try {
      ui().updateTiltShift({ focusPosition, focusWidth, blurRadius, angle });
      applyTiltShift();
    } finally {
      if (ui().tiltShift) cancelTiltShift();
    }
    return { layer, target: 'pixels' };
  },
});
