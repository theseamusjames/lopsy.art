import { getEngine } from '../../engine-wasm/engine-state';
import { endStroke, endDodgeBurnStroke } from '../../engine-wasm/wasm-bridge';
import { clearJsPixelData } from '../store/clear-js-pixel-data';
import { useEditorStore } from '../editor-store';

let pendingLayerId: string | null = null;
let pendingDodgeLayerId: string | null = null;

export function setPendingStroke(layerId: string): void {
  pendingLayerId = layerId;
}

export function clearPendingStroke(): void {
  pendingLayerId = null;
}

export function hasPendingStroke(): boolean {
  return pendingLayerId !== null;
}

export function setPendingDodgeStroke(layerId: string): void {
  pendingDodgeLayerId = layerId;
}

export function clearPendingDodgeStroke(): void {
  pendingDodgeLayerId = null;
}

/**
 * Finalize any deferred GPU stroke. Called before undo/redo to ensure
 * the most recent stroke is committed before taking a snapshot.
 */
export function finalizePendingStrokeGlobal(): void {
  if (!pendingLayerId && !pendingDodgeLayerId) return;
  const engine = getEngine();

  if (pendingLayerId) {
    const layerId = pendingLayerId;
    pendingLayerId = null;
    if (engine) {
      endStroke(engine, layerId);
      clearJsPixelData(layerId);
    }
  }

  if (pendingDodgeLayerId) {
    const layerId = pendingDodgeLayerId;
    pendingDodgeLayerId = null;
    if (engine) {
      endDodgeBurnStroke(engine, layerId);
    }
  }

  useEditorStore.getState().notifyRender();
}
