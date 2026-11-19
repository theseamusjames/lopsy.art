import { CommandError } from './command';
import { useEditorStore, type EditorState } from '../app/editor-store';
import { useUIStore } from '../app/ui-store';
import { getEngine } from '../engine-wasm/engine-state';
import type { Engine } from '../engine-wasm/wasm-bridge';
import { hexToRgb, rgbToHex } from '../utils/color';
import { MAX_GRADIENT_STOPS, MIN_GRADIENT_STOPS } from '../tools/gradient/gradient-settings';
import type { GradientStop } from '../tools/gradient/gradient';
import type { Color, DocumentState, Layer } from '../types';

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

/** What a plain click on a layer row does that a plain module can reach. */
export function selectReplace(id: string): void {
  useEditorStore.getState().setActiveLayer(id);
  useUIStore.getState().setMaskEditMode(false);
}

/** A row click on `id` unless it is already the active layer, as commands that act on the active layer need. */
export function activateIfOther(id: string): void {
  if (useEditorStore.getState().document.activeLayerId !== id) selectReplace(id);
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
