import { CommandError } from './command';
import { useEditorStore, type EditorState } from '../app/editor-store';
import { getEngine } from '../engine-wasm/engine-state';
import type { Engine } from '../engine-wasm/wasm-bridge';
import type { DocumentState, Layer } from '../types';

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
