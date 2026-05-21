import { getEngine } from '../../engine-wasm/engine-state';
import { endStroke, endDodgeBurnStroke, endSpongeStroke } from '../../engine-wasm/wasm-bridge';
import { clearJsPixelData } from '../store/clear-js-pixel-data';
import { useEditorStore } from '../editor-store';

/**
 * Pending-stroke registry: tracks which layer (if any) has an in-flight
 * GPU stroke per stroke kind. Previously a trio of parallel
 * `let pending...LayerId: string | null` globals; the Map shape makes
 * adding a new stroke kind a one-line change and keeps the
 * "all-globals are equally suspect" smell from spreading.
 */
type PendingStrokeKind = 'brush' | 'dodge' | 'sponge';

const pendingByKind = new Map<PendingStrokeKind, string>();

export function setPendingStroke(layerId: string): void {
  pendingByKind.set('brush', layerId);
}

export function clearPendingStroke(): void {
  pendingByKind.delete('brush');
}

export function hasPendingStroke(): boolean {
  return pendingByKind.has('brush');
}

export function setPendingDodgeStroke(layerId: string): void {
  pendingByKind.set('dodge', layerId);
}

export function clearPendingDodgeStroke(): void {
  pendingByKind.delete('dodge');
}

export function setPendingSpongeStroke(layerId: string): void {
  pendingByKind.set('sponge', layerId);
}

export function clearPendingSpongeStroke(): void {
  pendingByKind.delete('sponge');
}

/**
 * Finalize any deferred GPU stroke. Called before undo/redo to ensure
 * the most recent stroke is committed before taking a snapshot.
 */
export function finalizePendingStrokeGlobal(): void {
  if (pendingByKind.size === 0) return;
  const engine = getEngine();

  const brushLayer = pendingByKind.get('brush');
  if (brushLayer !== undefined) {
    pendingByKind.delete('brush');
    if (engine) {
      endStroke(engine, brushLayer);
      clearJsPixelData(brushLayer);
    }
  }

  const dodgeLayer = pendingByKind.get('dodge');
  if (dodgeLayer !== undefined) {
    pendingByKind.delete('dodge');
    if (engine) {
      endDodgeBurnStroke(engine, dodgeLayer);
    }
  }

  const spongeLayer = pendingByKind.get('sponge');
  if (spongeLayer !== undefined) {
    pendingByKind.delete('sponge');
    if (engine) {
      endSpongeStroke(engine, spongeLayer);
    }
  }

  useEditorStore.getState().notifyRender();
}
