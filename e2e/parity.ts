import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

/**
 * Engine-output checkpoints for the migration parity check
 * (docs/engine-migration-plan.md, "Verification").
 *
 * When PARITY_OUT is set, `parityCheckpoint` writes what the engine has
 * rendered so far: the export composite as raw RGBA bytes, plus a SHA-256
 * of every layer's pixels. `scripts/parity-compare.mjs` then diffs two
 * such directories — one recorded on `main`, one on the branch under test.
 *
 * It records engine output, not page screenshots, so UI chrome, cursors
 * and marching ants never show up as differences.
 *
 * Without PARITY_OUT this is a no-op, so the specs that call it behave
 * exactly as before in normal runs.
 */

interface LayerRecord {
  name: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  sha256: string | null;
}

interface CheckpointRecord {
  width: number;
  height: number;
  compositeBase64: string;
  layers: LayerRecord[];
}

/**
 * Wait for the engine to be where a WebGL engine already is when a spec
 * next looks at it. Two things take time on wgpu and none on WebGL:
 *
 * - Starting. WebGL creates the engine in one blocking call, so a spec
 *   cannot act between a document appearing and its engine existing. The
 *   wgpu engine waits for an adapter and a device first.
 * - Readbacks. One answers some frames later, and what follows it (a
 *   bucket fill, the crop of a layer left behind, a thumbnail) has not
 *   happened until it does.
 *
 * Recording or asserting before then compares a document mid-change with
 * a finished one.
 */
export async function settleEngine(
  page: Page,
  evaluate: Page['evaluate'] = page.evaluate.bind(page),
): Promise<void> {
  await evaluate(async () => {
    const w = window as unknown as { __parkedReadbacks?: () => number; __engineStarted?: () => Promise<unknown> };
    await w.__engineStarted?.();
    const parked = w.__parkedReadbacks;
    if (!parked || parked() === 0) return;
    const deadline = performance.now() + 30_000;
    // What a readback's answer sets off may read back in turn.
    while (parked() > 0 && performance.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  });
}

const settledPages = new WeakSet<Page>();

/**
 * On WebGL a bucket fill, Define Pattern, a mode conversion or the crop of
 * a layer left behind has finished by the time the call that asked for it
 * returns, and specs lean on that: they act, then look. On wgpu the
 * readback behind each of those answers some frames later. So with
 * `LOPSY_RENDERER=wgpu`, before a spec looks at the page (`evaluate`) and
 * after it waits (`waitForTimeout`, `waitForSelector`), the engine is
 * settled first (`settleEngine`). Does nothing on WebGL, or twice.
 */
export function installSettledWaits(page: Page): void {
  if (process.env.LOPSY_RENDERER !== 'wgpu' || settledPages.has(page)) return;
  settledPages.add(page);
  const evaluate = page.evaluate.bind(page);
  const wait = page.waitForTimeout.bind(page);
  const waitForSelector = page.waitForSelector.bind(page);
  const settle = () => settleEngine(page, evaluate).catch(() => undefined);
  page.evaluate = (async (...args: Parameters<typeof evaluate>) => {
    await settle();
    return evaluate(...args);
  }) as typeof page.evaluate;
  page.waitForTimeout = async (timeout: number) => {
    await wait(timeout);
    await settle();
  };
  page.waitForSelector = (async (...args: Parameters<typeof waitForSelector>) => {
    const found = await waitForSelector(...args);
    await settle();
    return found;
  }) as typeof page.waitForSelector;
}

export async function parityCheckpoint(page: Page, composition: string, name: string): Promise<void> {
  const outDir = process.env.PARITY_OUT;
  if (!outDir) return;
  await settleEngine(page);

  const record = await page.evaluate(async (): Promise<CheckpointRecord> => {
    interface ReadResult { width: number; height: number; pixels: number[] }
    interface DocLayer { id: string; name: string; type: string; x: number; y: number }
    interface EditorStore {
      getState: () => { document: { layerOrder: string[]; layers: DocLayer[] } };
    }
    interface Bridge {
      compositeForExport: (engine: unknown) => Uint8Array;
      getCompositeSize: (engine: unknown) => Uint32Array;
    }
    const w = window as unknown as {
      __editorStore: EditorStore;
      __readLayerPixels: (id?: string) => Promise<ReadResult | null>;
      __engineState: { getEngine: () => unknown };
      __wasmBridge: Bridge;
    };

    const sha256 = async (bytes: Uint8Array<ArrayBuffer>): Promise<string> => {
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
      return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
    };
    const toBase64 = (bytes: Uint8Array): string => {
      let binary = '';
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      return btoa(binary);
    };

    // Reading a layer syncs pending state into the engine first, so the
    // layer pass also guarantees the composite below is current.
    const doc = w.__editorStore.getState().document;
    const layers: LayerRecord[] = [];
    for (const id of doc.layerOrder) {
      const layer = doc.layers.find((l) => l.id === id);
      if (!layer) continue;
      const read = await w.__readLayerPixels(id);
      layers.push({
        name: layer.name,
        type: layer.type,
        x: layer.x,
        y: layer.y,
        width: read?.width ?? 0,
        height: read?.height ?? 0,
        sha256: read ? await sha256(Uint8Array.from(read.pixels)) : null,
      });
    }

    const engine = w.__engineState.getEngine();
    const size = w.__wasmBridge.getCompositeSize(engine);
    const composite = await w.__wasmBridge.compositeForExport(engine);
    return {
      width: size[0] ?? 0,
      height: size[1] ?? 0,
      compositeBase64: toBase64(composite),
      layers,
    };
  });

  const dir = join(outDir, composition);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.rgba`), Buffer.from(record.compositeBase64, 'base64'));
  writeFileSync(
    join(dir, `${name}.json`),
    `${JSON.stringify({ width: record.width, height: record.height, layers: record.layers }, null, 2)}\n`,
  );
}
