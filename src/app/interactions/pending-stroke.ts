import { getEngine } from '../../engine-wasm/engine-state';
import { endStroke } from '../../engine-wasm/wasm-bridge';
import { clearJsPixelData } from '../store/clear-js-pixel-data';
import { useEditorStore } from '../editor-store';

let pendingLayerId: string | null = null;

export function setPendingStroke(layerId: string): void {
  pendingLayerId = layerId;
}

export function clearPendingStroke(): void {
  pendingLayerId = null;
}

export function hasPendingStroke(): boolean {
  return pendingLayerId !== null;
}

/**
 * Finalize any deferred GPU stroke. Called before undo/redo to ensure
 * the most recent stroke is committed before taking a snapshot.
 */
export function finalizePendingStrokeGlobal(): void {
  if (!pendingLayerId) return;
  const layerId = pendingLayerId;
  pendingLayerId = null;

  const engine = getEngine();
  if (!engine) return;

  endStroke(engine, layerId);
  clearJsPixelData(layerId);
  useEditorStore.getState().notifyRender();
}
