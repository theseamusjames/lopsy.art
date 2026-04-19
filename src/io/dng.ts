import { useEditorStore } from '../app/editor-store';
import { useUIStore } from '../app/ui-store';
import { getEngine } from '../engine-wasm/engine-state';
import { decodeAndUploadDng, initWasm } from '../engine-wasm/wasm-bridge';
import { resetTrackedState } from '../engine-wasm/engine-sync';
import { notifyError } from '../app/notifications-store';
import { DEFAULT_ADJUSTMENTS } from '../filters/image-adjustments';
import { IDENTITY_CURVES, type Curves } from '../filters/curves';

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

  // When no DNG tone curve was found, the Rust pipeline applies sRGB gamma
  // instead — but the result still benefits from a gentle contrast curve.
  // When a tone curve IS found, it's baked into the pixels (it replaces
  // sRGB gamma), so we don't need a group adjustment for it.
  const rootGroupId = useEditorStore.getState().document.rootGroupId;
  if (rootGroupId && meta.toneCurve.length === 0) {
    const store = useEditorStore.getState();
    store.setGroupAdjustments(rootGroupId, {
      ...DEFAULT_ADJUSTMENTS,
      curves: DEFAULT_RAW_CURVES,
    });
    store.setGroupAdjustmentsEnabled(rootGroupId, true);
  }

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

const DEFAULT_RAW_CURVES: Curves = {
  ...IDENTITY_CURVES,
  rgb: [
    { x: 0, y: 0 },
    { x: 0.25, y: 0.20 },
    { x: 0.50, y: 0.55 },
    { x: 0.75, y: 0.82 },
    { x: 1, y: 1 },
  ],
};

