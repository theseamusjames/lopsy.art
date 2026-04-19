import { useEditorStore } from '../app/editor-store';
import { getEngine } from '../engine-wasm/engine-state';
import { decodeAndUploadDng } from '../engine-wasm/wasm-bridge';
import { resetTrackedState } from '../engine-wasm/engine-sync';
import { notifyError } from '../app/notifications-store';

export function importDngFile(data: Uint8Array, name: string): void {
  const edStore = useEditorStore.getState();
  edStore.createDocument(1, 1, false);

  const engine = getEngine();
  if (!engine) {
    notifyError('Engine not ready');
    return;
  }

  const activeLayerId = useEditorStore.getState().document.activeLayerId;
  if (!activeLayerId) {
    notifyError('No active layer');
    return;
  }

  const dims = decodeAndUploadDng(engine, activeLayerId, data);
  const width = dims[0] ?? 0;
  const height = dims[1] ?? 0;

  if (width === 0 || height === 0) {
    notifyError('DNG decode returned empty image');
    return;
  }

  useEditorStore.setState((s) => {
    const layers = s.document.layers.map((l) => {
      if (l.id === activeLayerId && l.type === 'raster') {
        return { ...l, width, height, name };
      }
      return l;
    });
    return {
      document: { ...s.document, width, height, layers, name },
    };
  });

  resetTrackedState(engine);
  useEditorStore.getState().fitToView();
}
