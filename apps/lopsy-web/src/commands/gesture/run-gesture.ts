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
  /**
   * The open canvas session this gesture is for, given only by the command
   * that opened it: the press is meant for that session, not a tool. A
   * gesture without it is refused while any session is open; one with it is
   * refused unless exactly that session is.
   */
  readonly session?: 'liquify';
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

/** Throws `refused` unless the Liquify session a gesture is for is open: its press would go to a tool instead. */
function checkSessionOpen(): void {
  if (!useUIStore.getState().liquify) {
    throw new CommandError('refused', 'No Liquify session is open, and the press would go to the active tool instead.');
  }
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

interface Pressed {
  readonly result: GestureResult;
  readonly first: Point;
  readonly rest: readonly Point[];
}

/** The checks before a press, then the press itself at the first point. */
function press(input: GestureInput): Pressed {
  const [first, ...rest] = input.points;
  if (!first) throw new CommandError('invalid', 'A gesture needs at least one point.');
  requireDocument();
  requireEngine();
  if (input.session) checkSessionOpen();
  else checkNoOpenSession();
  const ui = useUIStore.getState();
  if (input.tool && input.tool !== ui.activeTool) ui.setActiveTool(input.tool);
  const tool = useUIStore.getState().activeTool;
  const layer = activeLayer();
  checkGesturePress(tool, layer);
  gestureDown(toolEvent(first, input, input.clicks), documentEnvironment);
  return { result: { tool, layer: layer.id }, first, rest };
}

/** One move per point; `delivered.at` follows the last point a move was delivered for, so a throw still releases there. */
function moveThrough(input: GestureInput, points: readonly Point[], delivered: { at: Point }): void {
  for (const point of points) {
    gestureMove(toolEvent(point, input), documentEnvironment);
    delivered.at = point;
  }
  const cursor = documentEnvironment.toCanvas(delivered.at.x, delivered.at.y);
  if (cursor) useUIStore.getState().setCursorPosition(cursor);
}

function release(input: GestureInput, at: Point): void {
  try {
    gestureUp(toolEvent(at, input), documentEnvironment);
  } finally {
    useUIStore.getState().setIsInteracting(false);
  }
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
  const pressed = press(input);
  const delivered = { at: pressed.first };
  try {
    useUIStore.getState().setIsInteracting(true);
    moveThrough(input, pressed.rest, delivered);
  } finally {
    release(input, delivered.at);
  }
  return pressed.result;
}

/**
 * runGesture with the button held still after the press until `hold`
 * resolves, as a pointer that presses and waits before it moves: for a
 * press whose handler finishes its work once a read it started is in (a
 * multi-layer transform box whose content bounds are still being read
 * begins its session then, and ignores moves until it has). The release
 * still happens however the hold or a move ends.
 */
export async function runHeldGesture(input: GestureInput, hold: () => Promise<void>): Promise<GestureResult> {
  const pressed = press(input);
  const delivered = { at: pressed.first };
  try {
    useUIStore.getState().setIsInteracting(true);
    await hold();
    moveThrough(input, pressed.rest, delivered);
  } finally {
    release(input, delivered.at);
  }
  return pressed.result;
}

/**
 * runGesture with the pointer resting at the press and after every move
 * until `rest` resolves, as a hand that pauses along a drag: for a tool that
 * keeps working while the button is held still (Spray deposits on a timer).
 * The release still happens however a rest or a move ends.
 */
export async function runPacedGesture(input: GestureInput, rest: () => Promise<void>): Promise<GestureResult> {
  const pressed = press(input);
  const delivered = { at: pressed.first };
  try {
    useUIStore.getState().setIsInteracting(true);
    await rest();
    for (const point of pressed.rest) {
      moveThrough(input, [point], delivered);
      await rest();
    }
  } finally {
    release(input, delivered.at);
  }
  return pressed.result;
}
