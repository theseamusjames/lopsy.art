import { CommandError } from '../command';
import { refusalError } from '../refusal';
import { MAX_COORDINATE, MIN_COORDINATE, boundedPointSpec, requireDocument, requireEngine } from '../context';
import { useEditorStore } from '../../app/editor-store';
import { useUIStore } from '../../app/ui-store';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import {
  gestureDown,
  gestureMove,
  gestureUp,
  type GestureEnvironment,
  type ToolEvent,
} from '../../app/interactions/gesture-session';
import { pixelWriteRefusal, toolIgnoresLayerLock, toolWritesRasterPixels } from '../../layers/paint-target';
import { toolRegistry } from '../../tools/tool-registry';
import type { Layer, Point, ToolId } from '../../types';

export interface GestureInput {
  /** Switched to first, as tool.select does, when it is not the active tool. */
  readonly tool?: ToolId;
  /** Document coordinates: the press, each move, and the release at the last point. */
  readonly points: readonly Point[];
  readonly shift?: boolean;
  readonly alt?: boolean;
  readonly meta?: boolean;
  /** MouseEvent.detail of the press: 2 for a double-click. */
  readonly clicks?: number;
}

export const MAX_GESTURE_POINTS = 10_000;

export const pointsSpec = (what: string) =>
  ({
    type: 'array',
    items: boundedPointSpec('A point of the path.'),
    minItems: 1,
    maxItems: MAX_GESTURE_POINTS,
    description: `${what} Document pixels, (0,0) at the top-left of the document; fractions land between pixels as a pointer would. Each coordinate from ${MIN_COORDINATE} to ${MAX_COORDINATE}: a drag may start or end outside the canvas.`,
  }) as const;

export const docPointSpec = (what: string) =>
  boundedPointSpec(`${what} In document pixels, (0,0) at the top-left of the document.`);

export const OPEN_SESSION_NOTE = 'Refused while a Liquify, Tilt-Shift or Mesh Warp session is open (apply or cancel it first).';

/** What a gesture command's summary says about the tool it switches to and the sessions that refuse it. */
export function gestureNote(tool: string): string {
  return ` It makes ${tool} active first, as tool.select does, which commits text being edited or a pending Move float. ${OPEN_SESSION_NOTE}`;
}

export interface GestureResult {
  tool: ToolId;
  /** The layer that was active at the press. */
  layer: string;
}

/**
 * The client point IS the document point, so the canvas mapping is the
 * rounding and flooring the UI applies after its viewport transform
 * (App.tsx screenToCanvas / screenToPixel).
 */
export const documentEnvironment: GestureEnvironment = {
  toCanvas: (x, y) => ({ x: Math.round(x), y: Math.round(y) }),
  toPixel: (x, y) => ({ x: Math.floor(x), y: Math.floor(y) }),
};

function activeLayer(): Layer {
  const doc = useEditorStore.getState().document;
  const layer = doc.activeLayerId ? doc.layers.find((l) => l.id === doc.activeLayerId) : undefined;
  if (!layer) throw new CommandError('refused', 'There is no active layer.');
  return layer;
}

/**
 * The canvas session that would claim a press before any tool: an open
 * Liquify session takes every press, and the Tilt-Shift and Mesh Warp
 * overlays take presses on their handles (gesture-session's pre-tool
 * guards, which read the same store fields).
 */
export function openSessionRefusal(): string | null {
  const { liquify, tiltShift, meshWarp } = useUIStore.getState();
  const open = liquify ? 'Liquify' : tiltShift ? 'Tilt-Shift' : meshWarp ? 'Mesh Warp' : null;
  if (!open) return null;
  return `A ${open} session is open, and it would take the press instead of the tool: apply or cancel it first.`;
}

/** Throws `refused` while a canvas session would claim the gesture's press. */
export function checkNoOpenSession(): void {
  const refusal = openSessionRefusal();
  if (refusal) throw new CommandError('refused', refusal);
}

/** Throws for a press gestureDown would drop without acting, using the same predicates it does. */
export function checkGesturePress(tool: ToolId, layer: Layer): void {
  if (layer.locked && !toolIgnoresLayerLock(tool)) {
    throw new CommandError('refused', `"${layer.name}" is locked: unlock it to use the ${toolRegistry[tool].label} tool on it.`);
  }
  const shapeOutput = useToolSettingsStore.getState().settings.shape.output;
  if (!toolWritesRasterPixels(tool, { shapeOutput })) return;
  const refusal = pixelWriteRefusal(layer);
  if (refusal) throw refusalError(refusal);
}

function toolEvent(point: Point, input: GestureInput, detail?: number): ToolEvent {
  return {
    clientX: point.x,
    clientY: point.y,
    button: 0,
    shiftKey: input.shift ?? false,
    altKey: input.alt ?? false,
    metaKey: input.meta ?? false,
    ctrlKey: false,
    detail,
  };
}

/**
 * Performs a canvas gesture through the same dispatcher the pointer layer
 * calls (gesture-session.ts), synchronously: press at the first point, one
 * move per further point, release at the last. Around the calls it does what
 * useCanvasPointerHandlers does for a left-button press on the canvas: the
 * interacting flag on press and off on release, and the status bar's cursor
 * position at the last point. Once the press has landed, the release and
 * the interacting flag's reset happen even when a move throws, so no stroke
 * or session is left open; the error is then rethrown.
 */
export function runGesture(input: GestureInput): GestureResult {
  const [first, ...rest] = input.points;
  if (!first) throw new CommandError('invalid', 'A gesture needs at least one point.');
  requireDocument();
  requireEngine();
  checkNoOpenSession();
  const ui = useUIStore.getState();
  if (input.tool && input.tool !== ui.activeTool) ui.setActiveTool(input.tool);
  const tool = useUIStore.getState().activeTool;
  const layer = activeLayer();
  checkGesturePress(tool, layer);

  gestureDown(toolEvent(first, input, input.clicks), documentEnvironment);
  let lastDelivered = first;
  try {
    useUIStore.getState().setIsInteracting(true);
    for (const point of rest) {
      gestureMove(toolEvent(point, input), documentEnvironment);
      lastDelivered = point;
    }
    const cursor = documentEnvironment.toCanvas(lastDelivered.x, lastDelivered.y);
    if (cursor) useUIStore.getState().setCursorPosition(cursor);
  } finally {
    try {
      gestureUp(toolEvent(lastDelivered, input), documentEnvironment);
    } finally {
      useUIStore.getState().setIsInteracting(false);
    }
  }
  return { tool, layer: layer.id };
}
