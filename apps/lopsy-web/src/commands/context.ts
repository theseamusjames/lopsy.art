import { CommandError } from './command';
import { hasOwnKey } from './params';
import { settled } from './settled';
import { useEditorStore, type EditorState } from '../app/editor-store';
import { activateLayerFromPanel, editLayerMaskFromPanel } from '../app/interactions/layer-activation';
import { getEngine, isGpuContextLost } from '../engine-wasm/engine-state';
import type { Engine } from '../engine-wasm/wasm-bridge';
import { hexToRgb, rgbToHex } from '../utils/color';
import { MAX_GRADIENT_STOPS, MIN_GRADIENT_STOPS } from '../tools/gradient/gradient-settings';
import type { GradientStop } from '../tools/gradient/gradient';
import type { Color, DocumentState, Layer } from '../types';
import { MAX_DOCUMENT_SIDE } from '../utils/document-size';

/**
 * `table[key]` for a key the caller chose, counting only the table's own
 * entries: `toString`, `constructor` or `__proto__` would otherwise find
 * what Object.prototype has.
 */
export function ownEntry<T>(table: Readonly<Record<string, T>>, key: string): T | undefined {
  return hasOwnKey(table, key) ? table[key] : undefined;
}

export function requireDocument(): DocumentState {
  const state = useEditorStore.getState();
  if (!state.documentReady) {
    throw new CommandError('unavailable', 'No document is open: create one with doc.new first.');
  }
  return state.document;
}

export function requireEngine(): Engine {
  const engine = getEngine();
  if (!engine) {
    throw new CommandError(
      'unavailable',
      'The rendering engine has not started: it starts once a document is open and its canvas is on screen.',
    );
  }
  return engine;
}

/**
 * The API's preflight (registry setPreflight): refuses while the engine's
 * graphics context is lost, where GPU work would be dropped. Only once an
 * engine exists: before the first document there is none, and doc.new and
 * the commands that never touch the engine must still run. The UI does not
 * consult it, so a menu item or key still runs its function as before.
 */
export function gpuContextPreflight(): void {
  if (getEngine() && isGpuContextLost()) {
    throw new CommandError('unavailable', 'The graphics context is lost; the editor is restoring it. Try again once the canvas is back.');
  }
}

/**
 * The range a document coordinate a command takes may lie in: the largest
 * document's side beyond each edge, so a drag may start or end well outside
 * the canvas, while a value that would make a tool loop or allocate without
 * end is refused.
 */
export const MIN_COORDINATE = -MAX_DOCUMENT_SIDE;
export const MAX_COORDINATE = 2 * MAX_DOCUMENT_SIDE;
/** The longest offset or extent within that range. */
export const MAX_SPAN = MAX_COORDINATE - MIN_COORDINATE;

const COORDINATE_RANGE = `From ${MIN_COORDINATE} to ${MAX_COORDINATE}: points outside the document are allowed.`;

export interface NumberSpecOptions {
  readonly integer?: boolean;
  /** extentSpec only: the smallest extent; 1 when omitted. */
  readonly min?: number;
}

/** A document x or y. */
export const coordinateSpec = (description: string, { integer = false }: NumberSpecOptions = {}) =>
  ({
    type: 'number',
    min: MIN_COORDINATE,
    max: MAX_COORDINATE,
    ...(integer ? { integer: true } : {}),
    description: `${description} ${COORDINATE_RANGE}`,
  }) as const;

/** A document point; each coordinate bounded as coordinateSpec's. */
export const boundedPointSpec = (description: string) =>
  ({ type: 'point', min: MIN_COORDINATE, max: MAX_COORDINATE, description: `${description} ${COORDINATE_RANGE}` }) as const;

/** A signed distance in document pixels, such as a move's dx. */
export const offsetSpec = (description: string, { integer = false }: NumberSpecOptions = {}) =>
  ({
    type: 'number',
    min: -MAX_SPAN,
    max: MAX_SPAN,
    ...(integer ? { integer: true } : {}),
    description: `${description} From ${-MAX_SPAN} to ${MAX_SPAN}.`,
  }) as const;

/** A width or height in document pixels. */
export const extentSpec = (description: string, { integer = false, min = 1 }: NumberSpecOptions = {}) =>
  ({
    type: 'number',
    min,
    max: MAX_SPAN,
    ...(integer ? { integer: true } : {}),
    description: `${description} From ${min} to ${MAX_SPAN}.`,
  }) as const;

export const layerRefSpec = {
  type: 'string',
  optional: true,
  description: 'A layer id, or an exact layer name. Omitted means the active layer.',
} as const;

/** A layer by id, or by exact name when no id matches; omitted means the active layer. */
export function resolveLayer(ref?: string): Layer {
  const doc = requireDocument();
  if (ref === undefined) {
    const active = doc.layers.find((layer) => layer.id === doc.activeLayerId);
    if (!active) throw new CommandError('not-found', 'No layer is active: pass a layer id or name.');
    return active;
  }
  const byId = doc.layers.find((layer) => layer.id === ref);
  if (byId) return byId;
  const byName = doc.layers.filter((layer) => layer.name === ref);
  const [only] = byName;
  if (byName.length === 1 && only) return only;
  if (byName.length > 1) {
    const candidates = byName.map((layer) => `${layer.id} (${layer.type})`).join(', ');
    throw new CommandError('invalid', `${byName.length} layers are named ${JSON.stringify(ref)}: pass one of their ids: ${candidates}`);
  }
  throw new CommandError('not-found', `No layer has the id or name ${JSON.stringify(ref)}.`);
}

/** A plain click on a layer row: a pending Move float or layer transform is committed, the layer becomes active and mask edit mode ends. */
export function selectReplace(id: string): void {
  activateLayerFromPanel(id);
}

/** A click on a layer's mask thumbnail: as a row click, but the layer's mask is then edited. */
export function enterMaskEdit(id: string): void {
  editLayerMaskFromPanel(id);
}

function activeLayerId(): string | null {
  return useEditorStore.getState().document.activeLayerId;
}

/**
 * Runs `activate` (a row click, a mask-thumbnail click, a change of the
 * selected layers), then `act`. When the active layer is the same after
 * `activate` as before, `act` runs at once, in the caller's tick. When it
 * changed, `act` runs once the engine has settled: in the editor the render
 * loop draws a frame between the click on a row and the next press, and in
 * it expands the layer switched to (cropped to its content while it was
 * inactive), schedules the crop of the layer left and syncs both to the
 * engine. Acting in the click's tick would act on the cropped layer, and
 * that frame's expansion would then land on the result. `wait` is the
 * settle wait, replaceable for tests.
 */
export function afterActivation<T>(
  activate: () => void,
  act: () => T | Promise<T>,
  wait: () => Promise<void> = settled,
): T | Promise<T> {
  const before = activeLayerId();
  activate();
  const switchedTo = activeLayerId();
  if (switchedTo === before) return act();
  return wait().then(() => {
    if (activeLayerId() !== switchedTo) {
      throw new CommandError('refused', 'The active layer changed while the switch to the named layer was being drawn: nothing else was done.');
    }
    return act();
  });
}

/** `act` on layer `id` as the active layer: a row click on it first unless it is active already (see afterActivation). */
export function actOnLayer<T>(id: string, act: () => T | Promise<T>, wait?: () => Promise<void>): T | Promise<T> {
  return afterActivation(() => {
    if (activeLayerId() !== id) selectReplace(id);
  }, act, wait);
}

export interface LayerSummary {
  id: string;
  name: string;
  type: Layer['type'];
}

export function layerSummary(layer: Layer): LayerSummary {
  return { id: layer.id, name: layer.name, type: layer.type };
}

export interface WaitForEditorOptions {
  readonly timeoutMs: number;
  /** Completes "Timed out after N ms waiting for ...". */
  readonly waitingFor: string;
}

/** Resolves once `isReady` holds for the editor state; rejects `unavailable` on timeout. */
export function waitForEditorState(
  isReady: (state: EditorState) => boolean,
  { timeoutMs, waitingFor }: WaitForEditorOptions,
): Promise<void> {
  if (isReady(useEditorStore.getState())) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new CommandError('unavailable', `Timed out after ${timeoutMs} ms waiting for ${waitingFor}.`));
    }, timeoutMs);
    const unsubscribe = useEditorStore.subscribe((state) => {
      if (!isReady(state)) return;
      clearTimeout(timer);
      unsubscribe();
      resolve();
    });
  });
}

/** A colour as "#rrggbb", or "#rrggbbaa" when it is not opaque. */
export function colorHex(color: Color): string {
  return rgbToHex(color);
}

const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Parses "#rgb", "#rrggbb" or "#rrggbbaa" (alpha 00-ff) into a Color; throws `invalid` naming `path` otherwise. */
export function parseHexColor(commandId: string, path: string, value: unknown): Color {
  const color = typeof value === 'string' && HEX_COLOR.test(value) ? hexToRgb(value) : null;
  if (!color) {
    throw new CommandError('invalid', `${commandId}: ${path} must be a colour "#rgb", "#rrggbb" or "#rrggbbaa", got ${JSON.stringify(value)}`);
  }
  return color;
}

/** A gradient stop as commands take and return it: position 0-1, colour as hex with alpha when not opaque. */
export interface GradientStopJSON {
  position: number;
  color: string;
}

export function gradientStopsJson(stops: readonly GradientStop[]): GradientStopJSON[] {
  return stops.map((stop) => ({ position: stop.position, color: colorHex(stop.color) }));
}

function parseStop(commandId: string, path: string, value: unknown): GradientStop {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CommandError('invalid', `${commandId}: ${path} must be an object { position, color }`);
  }
  const { position, color, ...rest } = value as Record<string, unknown>;
  const [extra] = Object.keys(rest);
  if (extra !== undefined) {
    throw new CommandError('invalid', `${commandId}: ${path} has unknown key ${JSON.stringify(extra)}; allowed: position, color`);
  }
  if (typeof position !== 'number' || !Number.isFinite(position) || position < 0 || position > 1) {
    throw new CommandError('invalid', `${commandId}: ${path}.position must be a number from 0 to 1, got ${JSON.stringify(position)}`);
  }
  return { position, color: parseHexColor(commandId, `${path}.color`, color) };
}

/** Gradient stops from JSON: 2 to 16 of them, sorted by position as the gradient editors hold them. */
export function parseGradientStops(commandId: string, path: string, value: unknown): GradientStop[] {
  if (!Array.isArray(value) || value.length < MIN_GRADIENT_STOPS || value.length > MAX_GRADIENT_STOPS) {
    throw new CommandError(
      'invalid',
      `${commandId}: ${path} must be an array of ${MIN_GRADIENT_STOPS} to ${MAX_GRADIENT_STOPS} stops { position: 0-1, color: hex }`,
    );
  }
  const stops = value.map((stop: unknown, index) => parseStop(commandId, `${path}[${index}]`, stop));
  return stops.sort((a, b) => a.position - b.position);
}

/**
 * The longest base64 string a command takes: 256 Mi characters, which is
 * 192 MiB of file. That is more than a PNG, PSD or .lopsy of an 8192x8192
 * document needs, and half of V8's longest string, so the decoded binary
 * string and its bytes still fit beside it.
 */
export const MAX_BASE64_LENGTH = 256 * 1024 * 1024;

export const base64Spec = (what: string) =>
  ({
    type: 'string',
    minLength: 1,
    maxLength: MAX_BASE64_LENGTH,
    description: `${what}, base64-encoded (standard alphabet; padding optional).`,
  }) as const;

const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

function binaryFromBase64(value: string): string | null {
  const compact = value.replace(/\s+/g, '');
  if (!BASE64_PATTERN.test(compact) || compact.length % 4 === 1) return null;
  try {
    return atob(compact);
  } catch {
    return null;
  }
}

/** Bytes from base64; throws `invalid` naming `path` when it is not base64 or decodes to nothing. */
export function decodeBase64(commandId: string, path: string, value: string): Uint8Array {
  const binary = binaryFromBase64(value);
  if (!binary) throw new CommandError('invalid', `${commandId}: ${path} is not valid base64`);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const BASE64_CHUNK = 0x8000;

/** The most bytes a command returns as base64: what MAX_BASE64_LENGTH characters encode. */
export const MAX_ENCODED_BYTES = (MAX_BASE64_LENGTH / 4) * 3;

const MIB = 1024 * 1024;

function mib(bytes: number): string {
  return `${(bytes / MIB).toFixed(1)} MiB`;
}

/** Base64 of `bytes`; refused before any encoding when the string would be longer than a command returns. */
export function encodeBase64(bytes: Uint8Array): string {
  if (bytes.length > MAX_ENCODED_BYTES) {
    throw new CommandError(
      'refused',
      `The file is ${mib(bytes.length)}, more than the ${mib(MAX_ENCODED_BYTES)} a command can return as base64: use view.render with maxSize, a lossy format (jpeg or webp with doc.export), or a smaller document.`,
    );
  }
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK)));
  }
  return btoa(chunks.join(''));
}
