import { useEditorStore } from '../app/editor-store';
import { getEngine } from '../engine-wasm/engine-state';
import { decodeAndUploadDng, initWasm } from '../engine-wasm/wasm-bridge';
import { resetTrackedState } from '../engine-wasm/engine-sync';
import { notifyError } from '../app/notifications-store';
import { DEFAULT_ADJUSTMENTS } from '../filters/image-adjustments';
import { IDENTITY_CURVES, type CurvePoint, type Curves } from '../filters/curves';

interface DngMeta {
  width: number;
  height: number;
  baselineExposure: number;
  toneCurve: [number, number][];
}

export async function importDngFile(data: Uint8Array, name: string): Promise<void> {
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

  const rootGroupId = useEditorStore.getState().document.rootGroupId;
  if (rootGroupId && (meta.baselineExposure !== 0 || meta.toneCurve.length > 0)) {
    const curves = buildCurvesFromToneCurve(meta.toneCurve);
    const adjustments = {
      ...DEFAULT_ADJUSTMENTS,
      exposure: meta.baselineExposure,
      ...(curves ? { curves } : {}),
    };
    useEditorStore.getState().setGroupAdjustments(rootGroupId, adjustments);
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

function buildCurvesFromToneCurve(toneCurve: [number, number][]): Curves | null {
  if (toneCurve.length < 2) return null;

  const points: CurvePoint[] = toneCurve.map(([x, y]) => ({
    x: Math.max(0, Math.min(1, x)),
    y: Math.max(0, Math.min(1, y)),
  }));

  if (points[0]!.x > 0.001) {
    points.unshift({ x: 0, y: 0 });
  }
  if (points[points.length - 1]!.x < 0.999) {
    points.push({ x: 1, y: 1 });
  }

  return {
    ...IDENTITY_CURVES,
    rgb: points,
  };
}
