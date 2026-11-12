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

export async function parityCheckpoint(page: Page, composition: string, name: string): Promise<void> {
  const outDir = process.env.PARITY_OUT;
  if (!outDir) return;

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
    const composite = w.__wasmBridge.compositeForExport(engine);
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
