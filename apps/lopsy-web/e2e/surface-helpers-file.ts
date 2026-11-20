/**
 * Helpers for the File / View / Help menu characterization specs, on top of
 * `surface-helpers.ts`. Each one drives the real UI or only READS state.
 *
 *   captureDownload(page, trigger)     Run `trigger` and return the download's
 *                                      suggested filename and bytes.
 *   expectNoDownload(page, trigger)    Run `trigger` and assert no download starts.
 *   decodeImageInPage(page, bytes, probes) Decode image bytes with the browser's
 *                                      own decoder; size plus RGBA at each probe.
 *   makePngInPage(page, w, h, rects)   Encode a small PNG in the page (no store).
 *   isDirty(page)                      editor `isDirty`.
 *   viewport(page)                     editor `viewport` (zoom, pan, size).
 *   viewFlags(page)                    The ui-store flags the View menu toggles.
 *   menuCheckmark(page, top, item, sub?) Whether the item's checkmark shows "✓"
 *                                      (the menu has no aria-checked); null when
 *                                      the item has no checkmark slot.
 *   watchDialogs(page, answer)         Record window.confirm/prompt messages and
 *                                      answer them; returns the live list.
 *   panWithSpace(page, dx, dy)         Space + drag on the canvas (pans the view).
 */
import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import { closeMenus, menuItem, settle } from './surface-helpers';

export interface DownloadResult {
  filename: string;
  bytes: Buffer;
}

export async function captureDownload(page: Page, trigger: () => Promise<void>): Promise<DownloadResult> {
  const pending = page.waitForEvent('download', { timeout: 20_000 });
  await trigger();
  const download = await pending;
  const path = await download.path();
  if (!path) throw new Error('download has no path');
  return { filename: download.suggestedFilename(), bytes: readFileSync(path) };
}

export async function expectNoDownload(page: Page, trigger: () => Promise<void>, waitMs = 1500): Promise<void> {
  const seen: string[] = [];
  const onDownload = (d: { suggestedFilename: () => string }): void => {
    seen.push(d.suggestedFilename());
  };
  page.on('download', onDownload);
  try {
    await trigger();
    await page.waitForTimeout(waitMs);
  } finally {
    page.off('download', onDownload);
  }
  expect(seen).toEqual([]);
}

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface DecodedImage {
  width: number;
  height: number;
  probes: Rgba[];
}

export async function decodeImageInPage(
  page: Page,
  bytes: Buffer,
  probes: ReadonlyArray<{ x: number; y: number }> = [],
): Promise<DecodedImage> {
  return page.evaluate(
    async ({ data, points }) => {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(data)]));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
      if (!ctx) throw new Error('no 2d context');
      ctx.drawImage(bitmap, 0, 0);
      const out = points.map((p) => {
        const px = ctx.getImageData(p.x, p.y, 1, 1, { colorSpace: 'srgb' }).data;
        return { r: px[0] ?? 0, g: px[1] ?? 0, b: px[2] ?? 0, a: px[3] ?? 0 };
      });
      const result = { width: bitmap.width, height: bitmap.height, probes: out };
      bitmap.close();
      return result;
    },
    { data: Array.from(bytes), points: [...probes] },
  );
}

export interface PngRect {
  x: number;
  y: number;
  width: number;
  height: number;
  rgb: { r: number; g: number; b: number };
}

/** An opaque PNG of `width` x `height`: white, with `rects` painted on it. */
export async function makePngInPage(page: Page, width: number, height: number, rects: readonly PngRect[]): Promise<Buffer> {
  const data = await page.evaluate(
    async ({ w, h, list }) => {
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      ctx.fillStyle = 'rgb(255,255,255)';
      ctx.fillRect(0, 0, w, h);
      for (const r of list) {
        ctx.fillStyle = `rgb(${r.rgb.r},${r.rgb.g},${r.rgb.b})`;
        ctx.fillRect(r.x, r.y, r.width, r.height);
      }
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    },
    { w: width, h: height, list: [...rects] },
  );
  return Buffer.from(data);
}

export async function isDirty(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { isDirty: boolean };
    };
    return store.getState().isDirty;
  });
}

export interface ViewportSnapshot {
  zoom: number;
  panX: number;
  panY: number;
  width: number;
  height: number;
}

export async function viewport(page: Page): Promise<ViewportSnapshot> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { viewport: { zoom: number; panX: number; panY: number; width: number; height: number } };
    };
    const v = store.getState().viewport;
    return { zoom: v.zoom, panX: v.panX, panY: v.panY, width: v.width, height: v.height };
  });
}

export interface ViewFlags {
  showRulers: boolean;
  rulerUnit: string;
  showGrid: boolean;
  showPixelGrid: boolean;
  showGuides: boolean;
  snapToGrid: boolean;
  snapToLayers: boolean;
  snapToGuides: boolean;
  showSeamlessPattern: boolean;
}

export async function viewFlags(page: Page): Promise<ViewFlags> {
  return page.evaluate(() => {
    const ui = ((window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => {
        showRulers: boolean; rulerUnit: string; showGrid: boolean; showPixelGrid: boolean; showGuides: boolean;
        snapToGrid: boolean; snapToLayers: boolean; snapToGuides: boolean; showSeamlessPattern: boolean;
      };
    }).getState();
    return {
      showRulers: ui.showRulers,
      rulerUnit: ui.rulerUnit,
      showGrid: ui.showGrid,
      showPixelGrid: ui.showPixelGrid,
      showGuides: ui.showGuides,
      snapToGrid: ui.snapToGrid,
      snapToLayers: ui.snapToLayers,
      snapToGuides: ui.snapToGuides,
      showSeamlessPattern: ui.showSeamlessPattern,
    };
  });
}

/**
 * Open Top (> Item's flyout when `sub` is given), read the item's checkmark
 * slot and close the menu. True for "✓", false for an empty slot, null when
 * the item renders no slot at all.
 */
export async function menuCheckmark(page: Page, top: string, item: string, sub?: string): Promise<boolean | null> {
  let target = await menuItem(page, top, item);
  if (sub !== undefined) {
    await target.hover();
    const flyout = page.locator(`[role="menu"][aria-label="${item}"]`);
    await expect(flyout).toBeVisible();
    target = flyout.getByRole('menuitem', { name: sub, exact: true });
  }
  await expect(target).toHaveCount(1);
  const mark = await target.evaluate((el) => {
    const slot = el.querySelector('span > span[aria-hidden="true"]');
    return slot ? slot.textContent ?? '' : null;
  });
  await closeMenus(page);
  return mark === null ? null : mark === '✓';
}

export interface DialogLog {
  messages: string[];
  types: string[];
}

/** Record every window dialog's message and type, answering each with `accept`. */
export function watchDialogs(page: Page, accept: boolean): DialogLog {
  const log: DialogLog = { messages: [], types: [] };
  page.on('dialog', (d) => {
    log.messages.push(d.message());
    log.types.push(d.type());
    void (accept ? d.accept() : d.dismiss());
  });
  return log;
}

/** Hold Space and drag across the canvas container by (dx, dy) screen pixels. */
export async function panWithSpace(page: Page, dx: number, dy: number): Promise<void> {
  const box = await page.locator('[data-testid="canvas-container"]').boundingBox();
  if (!box) throw new Error('no canvas container');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.keyboard.down('Space');
  await settle(page, 50);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Space');
  await settle(page);
}
