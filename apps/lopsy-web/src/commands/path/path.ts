import { CommandError } from '../command';
import { defineCommand } from '../registry';
import { refusalError } from '../refusal';
import { boundedPointSpec, requireDocument, requireEngine } from '../context';
import { MAX_GESTURE_POINTS } from '../gesture/run-gesture';
import type { Point } from '../params';
import { useEditorStore } from '../../app/editor-store';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import { addPathWithHistory, rasterizePathToLayer } from '../../app/interactions/path-stroke';
import { applyBooleanOp, booleanOpRefusal, type BooleanOp } from '../../app/path-boolean-ops';
import {
  clampStrokePathWidth,
  MAX_STROKE_PATH_WIDTH,
  MIN_STROKE_PATH_WIDTH,
} from '../../components/StrokePathModal/stroke-path-width';
import { pixelWriteRefusal } from '../../layers/paint-target';
import { pathToSelection } from '../../panels/PathsPanel/path-to-selection';
import type { PathAnchor } from '../../tools/path/path';
import type { StoredPath } from '../../types/paths';

export interface PathSummary {
  id: string;
  name: string;
  closed: boolean;
  anchors: PathAnchor[];
}

export interface PathListResult {
  paths: PathSummary[];
  /** The id of the selected path (the one the Paths panel highlights), or null. */
  selected: string | null;
}

export interface PathRef {
  id: string;
  name: string;
}

function store() {
  return useEditorStore.getState();
}

function pathSummary(path: StoredPath): PathSummary {
  return {
    id: path.id,
    name: path.name,
    closed: path.closed,
    anchors: path.anchors.map((a) => ({
      point: { ...a.point },
      handleIn: a.handleIn ? { ...a.handleIn } : null,
      handleOut: a.handleOut ? { ...a.handleOut } : null,
    })),
  };
}

function pathRef(path: StoredPath): PathRef {
  return { id: path.id, name: path.name };
}

/** A path by id, or by exact name when no id matches. */
export function resolvePath(ref: string): StoredPath {
  const { paths } = store();
  const byId = paths.find((p) => p.id === ref);
  if (byId) return byId;
  const byName = paths.filter((p) => p.name === ref);
  const [only] = byName;
  if (byName.length === 1 && only) return only;
  if (byName.length > 1) {
    const candidates = byName.map((p) => p.id).join(', ');
    throw new CommandError('invalid', `${byName.length} paths are named ${JSON.stringify(ref)}: pass one of their ids: ${candidates}`);
  }
  throw new CommandError('not-found', `No path has the id or name ${JSON.stringify(ref)}.`);
}

function selectedPath(): StoredPath {
  const { paths, selectedPathId } = store();
  const path = paths.find((p) => p.id === selectedPathId);
  if (!path) throw new CommandError('refused', 'No path is selected: pass path, or select one with path.select.');
  return path;
}

const pathRefSpec = {
  type: 'string',
  description: 'A path id, or an exact path name ("Path 1").',
} as const;

const pointSpec = (what: string) =>
  ({ ...boundedPointSpec(`${what}, in document pixels. Omitted means none (null in path.list): the curve meets the anchor straight.`), optional: true }) as const;

const anchorSpec = {
  type: 'object',
  fields: {
    point: boundedPointSpec('The anchor, in document pixels with (0,0) at the top-left.'),
    handleIn: pointSpec('The bezier handle the curve arrives along'),
    handleOut: pointSpec('The bezier handle the curve leaves along'),
  },
} as const;

interface AnchorParam {
  point: Point;
  handleIn?: Point;
  handleOut?: Point;
}

function toAnchor({ point, handleIn, handleOut }: AnchorParam): PathAnchor {
  return { point: { ...point }, handleIn: handleIn ? { ...handleIn } : null, handleOut: handleOut ? { ...handleOut } : null };
}

export const pathList = defineCommand({
  id: 'path.list',
  summary:
    'Lists the document\'s vector paths as the Paths panel shows them, in order, with each anchor\'s point and bezier handles in document pixels, and which path is selected. Changes nothing.',
  surface: 'document',
  settles: 'before',
  check: requireDocument,
  params: {},
  run(): PathListResult {
    requireDocument();
    const { paths, selectedPathId } = store();
    return { paths: paths.map(pathSummary), selected: selectedPathId };
  },
});

export const pathAdd = defineCommand({
  id: 'path.add',
  summary:
    'Adds a vector path to the Paths panel, as committing a Pen-tool draft does ("Add Path"), without stroking it: it is named "Path N" and becomes the selected path. Stroke it with path.stroke. Returns its id and name.',
  surface: 'document',
  params: {
    anchors: { type: 'array', items: anchorSpec, minItems: 2, maxItems: MAX_GESTURE_POINTS, description: `The anchors in order: at least two, as the Pen tool needs to commit a path, and at most ${MAX_GESTURE_POINTS}.` },
    closed: { type: 'boolean', default: false, description: 'true joins the last anchor back to the first.' },
  },
  run({ anchors, closed }): PathRef {
    requireDocument();
    addPathWithHistory(anchors.map(toAnchor), closed);
    return pathRef(selectedPath());
  },
});

export const pathRemove = defineCommand({
  id: 'path.remove',
  summary:
    'Deletes a path, as the Paths panel\'s Delete Path button does for the selected one ("Delete Path"). Text set on the path goes back to straight text. Returns the deleted path\'s id and name.',
  surface: 'document',
  params: { path: pathRefSpec },
  run({ path: ref }): PathRef {
    requireDocument();
    const path = resolvePath(ref);
    store().removePath(path.id);
    return pathRef(path);
  },
});

export const pathSelect = defineCommand({
  id: 'path.select',
  summary:
    'Selects a path, as clicking its row in the Paths panel does, or selects none when path is omitted (a click on the selected row). The selected path is what path.stroke and the boolean path commands act on. No history step. Returns the selected path\'s id and name, or null.',
  surface: 'document',
  params: { path: { ...pathRefSpec, optional: true, description: 'A path id or exact name. Omitted selects no path.' } },
  run({ path: ref }): PathRef | null {
    requireDocument();
    const path = ref === undefined ? null : resolvePath(ref);
    store().selectPath(path ? path.id : null);
    return path ? pathRef(path) : null;
  },
});

export const pathRename = defineCommand({
  id: 'path.rename',
  summary:
    'Renames a path ("Rename Path"). The Paths panel has no rename control today; the store action it would call is this one. Refused when the path already has that name. Returns its id and new name.',
  surface: 'document',
  params: { path: pathRefSpec, name: { type: 'string', minLength: 1, description: 'The new name.' } },
  run({ path: ref, name }): PathRef {
    requireDocument();
    const path = resolvePath(ref);
    if (path.name === name) throw new CommandError('refused', `The path is already named ${JSON.stringify(name)}.`);
    store().renamePath(path.id, name);
    return { id: path.id, name };
  },
});

export interface StrokeResult {
  path: string;
  layer: string;
  width: number;
}

export const pathStroke = defineCommand({
  id: 'path.stroke',
  summary: `Strokes a path onto the active layer's pixels with the foreground colour, as the Paths panel's Stroke Path dialog does ("Stroke Path"); the width is rounded and clamped to ${MIN_STROKE_PATH_WIDTH}-${MAX_STROKE_PATH_WIDTH} as the dialog does, and defaults to what the dialog opens with (the Pen tool's options-bar stroke width). Pressing Enter with the Pen tool is a different path: it skips a repeat stroke and does not clamp. Refused on a text or group layer with the text the dialog toasts. Returns the path id, the layer id and the width used.`,
  surface: 'document',
  params: {
    path: { ...pathRefSpec, optional: true, description: 'A path id or exact name. Omitted means the selected path, as the Paths panel strokes.' },
    width: { type: 'number', optional: true, min: MIN_STROKE_PATH_WIDTH, max: MAX_STROKE_PATH_WIDTH, description: 'Stroke width in pixels (rounded to a whole pixel).' },
  },
  run({ path: ref, width }): StrokeResult {
    const doc = requireDocument();
    const path = ref === undefined ? selectedPath() : resolvePath(ref);
    const layer = doc.layers.find((l) => l.id === doc.activeLayerId);
    const refusal = pixelWriteRefusal(layer);
    if (refusal || !layer) throw refusalError(refusal ?? { reason: 'There is no active layer.', notice: null });
    requireEngine();
    const tools = useToolSettingsStore.getState();
    const strokeWidth = clampStrokePathWidth(width ?? tools.settings.path.strokeWidth);
    if (!rasterizePathToLayer(path.anchors, path.closed, layer.id, strokeWidth, tools.foregroundColor)) {
      throw new CommandError('refused', 'The path was not stroked.');
    }
    return { path: path.id, layer: layer.id, width: strokeWidth };
  },
});

export const pathToSelectionCommand = defineCommand({
  id: 'path.to-selection',
  summary:
    'Replaces the selection with the area a path encloses, as the Paths panel\'s Path to Selection button does for the selected path ("Path to Selection"): an open path is closed with a straight line from its last anchor to its first, and the edge is antialiased. Fill it with paint.fill. Refused for a path with fewer than two anchors, where the button does nothing. Returns the path\'s id and name.',
  surface: 'document',
  params: {
    path: { ...pathRefSpec, optional: true, description: 'A path id or exact name. Omitted means the selected path, as the Paths panel converts.' },
  },
  run({ path: ref }): PathRef {
    requireDocument();
    const path = ref === undefined ? selectedPath() : resolvePath(ref);
    if (path.anchors.length < 2) {
      throw new CommandError('refused', `"${path.name}" has fewer than two anchors, so it encloses nothing: Path to Selection does nothing with it.`);
    }
    const before = store().selection.mask;
    pathToSelection(path);
    if (store().selection.mask === before) throw new CommandError('refused', 'The path was not turned into a selection.');
    return pathRef(path);
  },
});

export interface BooleanResult {
  /** The paths the operation made, in order; the last is selected. */
  paths: PathRef[];
}

function defineBoolean(op: BooleanOp, id: string, item: string, what: string) {
  return defineCommand({
    id,
    summary: `${what} as Path > ${item} does ("${item}"): it combines the selected path with the most recently added other path, deletes both and adds the result, one closed path per contour, the last selected. Refused with fewer than two paths, with no path selected, and when the result has no area, where the menu does nothing. Returns the new paths.`,
    surface: 'document',
    params: {},
    run(): BooleanResult {
      requireDocument();
      const { paths, selectedPathId } = store();
      const refusal = booleanOpRefusal(paths, selectedPathId);
      if (refusal) throw refusalError(refusal);
      const before = new Set(paths.map((p) => p.id));
      if (!applyBooleanOp(op)) {
        throw new CommandError('refused', `${item}: the result has no area, so the paths are unchanged.`);
      }
      return { paths: store().paths.filter((p) => !before.has(p.id)).map(pathRef) };
    },
  });
}

export const pathUnite = defineBoolean('union', 'path.unite', 'Unite Paths', 'Replaces two paths with their union,');
export const pathSubtract = defineBoolean('subtract', 'path.subtract', 'Subtract Paths', 'Replaces two paths with the selected one minus the other,');
export const pathIntersect = defineBoolean('intersect', 'path.intersect', 'Intersect Paths', 'Replaces two paths with their overlap,');
export const pathExclude = defineBoolean('exclude', 'path.exclude', 'Exclude Paths', 'Replaces two paths with the areas only one of them covers,');
