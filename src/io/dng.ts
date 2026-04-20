import { useEditorStore } from '../app/editor-store';
import { useUIStore } from '../app/ui-store';
import { getEngine } from '../engine-wasm/engine-state';
import { decodeAndUploadDng, initWasm } from '../engine-wasm/wasm-bridge';
import { resetTrackedState } from '../engine-wasm/engine-sync';
import { notifyError } from '../app/notifications-store';

interface DngMeta {
  width: number;
  height: number;
  baselineExposure: number;
  toneCurve: [number, number][];
}

export async function importDngFile(data: Uint8Array, name: string): Promise<void> {
  const ui = useUIStore.getState();
  ui.openModal({ kind: 'loading', message: 'Opening DNG…' });

  try {
    await importDngFileInner(data, name);
  } finally {
    useUIStore.getState().closeModalOfKind('loading');
  }
}

async function importDngFileInner(data: Uint8Array, name: string): Promise<void> {
  await initWasm();

  useEditorStore.getState().createDocument(1, 1, false);

  const engine = await waitForEngine();
  if (!engine) {
    notifyError('Engine not ready');
    return;
  }

  const activeLayerId = useEditorStore.getState().document.activeLayerId;
  if (!activeLayerId) {
    notifyError('No active layer');
    return;
  }

  // Yield one frame so the render loop can sync the initial document size
  // before we take a long &mut Engine borrow for the DNG decode. Without
  // this, the render loop fires during decode and hits a recursive borrow.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  const metaJson = decodeAndUploadDng(engine, activeLayerId, data);
  const meta: DngMeta = JSON.parse(metaJson);

  if (meta.width === 0 || meta.height === 0) {
    notifyError('DNG decode returned empty image');
    return;
  }

  useEditorStore.setState((s) => {
    const layers = s.document.layers.map((l) => {
      if (l.id === activeLayerId && l.type === 'raster') {
        return { ...l, width: meta.width, height: meta.height, name };
      }
      return l;
    });
    return {
      document: { ...s.document, width: meta.width, height: meta.height, layers, name },
    };
  });

  resetTrackedState(engine);
  useEditorStore.getState().fitToView();
}

async function waitForEngine(maxFrames = 60): Promise<ReturnType<typeof getEngine>> {
  for (let i = 0; i < maxFrames; i++) {
    const engine = getEngine();
    if (engine) return engine;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
  return getEngine();
}


