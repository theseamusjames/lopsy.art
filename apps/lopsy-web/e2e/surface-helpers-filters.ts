/**
 * Helpers for the Filter, Image and Path menu characterization specs, on top
 * of `surface-helpers.ts`. Each one drives the real UI or only reads state.
 *
 *   docPixelHash(page, layerId?)       FNV-1a over a layer's pixels placed in a
 *                                      document-sized buffer, so a texture that
 *                                      grows to the document (a filter preview)
 *                                      or shrinks to its content hashes alike
 *                                      when what it shows is the same.
 *   docPixel(page, x, y, layerId?)     One RGBA pixel of a layer at doc (x, y).
 *   openMenuDialog(page, top, item, dialogName)
 *                                      Click Top > Item and wait for the
 *                                      role="dialog" named `dialogName`.
 *   setFilterValue(dialog, label, v)   Type into a FilterDialog slider's value
 *                                      box and Tab out (Enter would Apply).
 *   maskByteAt(page, layerId, x, y)    A layer mask's byte at doc (x, y).
 *   showPathsPanel(page)               Open the Paths panel if it is hidden.
 *   pathSummaries(page)                Paths with anchor bounds, plus the selected id.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { clickMenu, settle } from './surface-helpers';

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export async function docPixelHash(page: Page, layerId?: string): Promise<string> {
  return page.evaluate(async (id) => {
    const w = window as unknown as Record<string, unknown>;
    const store = w.__editorStore as {
      getState: () => {
        document: {
          width: number; height: number; activeLayerId: string | null;
          layers: Array<{ id: string; x: number; y: number }>;
        };
      };
    };
    const read = w.__readLayerPixels as (id?: string) => Promise<{ width: number; height: number; pixels: ArrayLike<number> } | null>;
    const target = id ?? store.getState().document.activeLayerId ?? undefined;
    const result = await read(target);
    const doc = store.getState().document;
    const layer = doc.layers.find((l) => l.id === target);
    const out = new Uint8Array(doc.width * doc.height * 4);
    if (result && layer && result.width > 0) {
      for (let y = 0; y < result.height; y++) {
        const dy = y + layer.y;
        if (dy < 0 || dy >= doc.height) continue;
        for (let x = 0; x < result.width; x++) {
          const dx = x + layer.x;
          if (dx < 0 || dx >= doc.width) continue;
          const s = (y * result.width + x) * 4;
          const d = (dy * doc.width + dx) * 4;
          for (let c = 0; c < 4; c++) out[d + c] = result.pixels[s + c] ?? 0;
        }
      }
    }
    let h = 0x811c9dc5;
    for (let i = 0; i < out.length; i++) {
      h ^= out[i]!;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return `${doc.width}x${doc.height}:${h.toString(16).padStart(8, '0')}`;
  }, layerId ?? null);
}

export async function docPixel(page: Page, x: number, y: number, layerId?: string): Promise<Rgba> {
  return page.evaluate(async ({ x, y, id }) => {
    const w = window as unknown as Record<string, unknown>;
    const store = w.__editorStore as {
      getState: () => { document: { activeLayerId: string | null; layers: Array<{ id: string; x: number; y: number }> } };
    };
    const read = w.__readLayerPixels as (id?: string) => Promise<{ width: number; height: number; pixels: ArrayLike<number> } | null>;
    const target = id ?? store.getState().document.activeLayerId ?? undefined;
    const result = await read(target);
    const layer = store.getState().document.layers.find((l) => l.id === target);
    if (!result || !layer || result.width === 0) return { r: 0, g: 0, b: 0, a: 0 };
    const lx = x - layer.x;
    const ly = y - layer.y;
    if (lx < 0 || ly < 0 || lx >= result.width || ly >= result.height) return { r: 0, g: 0, b: 0, a: 0 };
    const i = (ly * result.width + lx) * 4;
    return { r: result.pixels[i] ?? 0, g: result.pixels[i + 1] ?? 0, b: result.pixels[i + 2] ?? 0, a: result.pixels[i + 3] ?? 0 };
  }, { x, y, id: layerId ?? null });
}

export async function openMenuDialog(page: Page, top: string, item: string, dialogName: string): Promise<Locator> {
  await clickMenu(page, top, item);
  const dialog = page.getByRole('dialog', { name: dialogName, exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

export async function setFilterValue(dialog: Locator, label: string, value: number): Promise<void> {
  const input = dialog.locator(`input[aria-label="${label} value"]`);
  await input.fill(String(value));
  await input.press('Tab');
}

export async function maskByteAt(page: Page, layerId: string, x: number, y: number): Promise<number> {
  return page.evaluate(({ id, x, y }) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; mask: { data: ArrayLike<number>; width: number } | null }> } };
    };
    const mask = store.getState().document.layers.find((l) => l.id === id)?.mask;
    if (!mask) return -1;
    return mask.data[y * mask.width + x] ?? -1;
  }, { id: layerId, x, y });
}

export async function showPathsPanel(page: Page): Promise<Locator> {
  const list = page.locator('[role="listbox"][aria-label="Paths"]');
  if (!(await list.isVisible())) {
    await page.locator('[role="toolbar"][aria-label="Panel visibility"] button[aria-label="Paths"]').click();
    await settle(page);
  }
  await expect(list).toBeVisible();
  return list;
}

export interface PathSummary {
  id: string;
  closed: boolean;
  anchorCount: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

export async function pathSummaries(page: Page): Promise<{ paths: PathSummary[]; selectedPathId: string | null }> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        paths: Array<{ id: string; closed: boolean; anchors: Array<{ point: { x: number; y: number } }> }>;
        selectedPathId: string | null;
      };
    };
    const s = store.getState();
    return {
      selectedPathId: s.selectedPathId,
      paths: s.paths.map((p) => {
        const xs = p.anchors.map((a) => a.point.x);
        const ys = p.anchors.map((a) => a.point.y);
        return {
          id: p.id,
          closed: p.closed,
          anchorCount: p.anchors.length,
          bounds: {
            minX: Math.round(Math.min(...xs)), minY: Math.round(Math.min(...ys)),
            maxX: Math.round(Math.max(...xs)), maxY: Math.round(Math.max(...ys)),
          },
        };
      }),
    };
  });
}
