import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  getEditorState,
  addLayer,
  drawRect,
  selectTool,
  docToScreen,
  addAdjustment,
  getRootGroupId,
} from './helpers';

test.beforeEach(async ({ page, isMobile }) => {
  test.skip(isMobile, 'layer and history panels need the sidebar');
  await page.goto('/');
  await waitForStore(page);
});

async function openHistoryPanel(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { visiblePanels: Set<string>; togglePanel: (id: string) => void };
    };
    const state = store.getState();
    if (!state.visiblePanels.has('history')) state.togglePanel('history');
  });
  const tab = page.locator('[data-dock-tab="history"]');
  if (await tab.count() > 0) await tab.click();
  await page.locator('section[role="tabpanel"][aria-label="History"]').waitFor({ state: 'visible' });
}

function historyRows(page: Page) {
  return page.locator('section[role="tabpanel"][aria-label="History"]').locator('button');
}

async function historyLabels(page: Page): Promise<string[]> {
  const rows = historyRows(page);
  const count = await rows.count();
  const labels: string[] = [];
  for (let i = 0; i < count; i++) {
    labels.push((await rows.nth(i).locator('span').nth(1).innerText()).trim());
  }
  return labels;
}

async function clickHistoryRow(page: Page, index: number): Promise<void> {
  await historyRows(page).nth(index).click();
  await page.waitForTimeout(150);
}

async function dragOnDoc(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  const a = await docToScreen(page, from.x, from.y);
  const b = await docToScreen(page, to.x, to.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

/**
 * Everything that should be identical whichever route reaches a history
 * state: the document size, the adjustment stack, and each layer's pixels
 * sampled in document space.
 */
async function fingerprint(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const w = window as unknown as Record<string, unknown>;
    const store = w.__editorStore as {
      getState: () => {
        document: {
          width: number;
          height: number;
          layers: Array<{
            id: string; type: string; x: number; y: number;
            adjustments?: Array<{ type: string; params: unknown; enabled: boolean }>;
          }>;
        };
      };
    };
    const read = w.__readLayerPixels as
      (id: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
    const doc = store.getState().document;
    const parts: string[] = [`${doc.width}x${doc.height}`];
    for (const layer of doc.layers) {
      if (layer.type === 'group') {
        parts.push(`${layer.id}:adj=${JSON.stringify(
          (layer.adjustments ?? []).map((a) => [a.type, a.enabled, a.params]),
        )}`);
        continue;
      }
      const px = await read(layer.id);
      const samples: string[] = [];
      for (let y = 5; y < doc.height; y += 20) {
        for (let x = 5; x < doc.width; x += 20) {
          const lx = x - layer.x;
          const ly = y - layer.y;
          if (!px || lx < 0 || ly < 0 || lx >= px.width || ly >= px.height) {
            samples.push('0,0,0,0');
            continue;
          }
          const i = (ly * px.width + lx) * 4;
          samples.push(`${px.pixels[i]},${px.pixels[i + 1]},${px.pixels[i + 2]},${px.pixels[i + 3]}`);
        }
      }
      parts.push(`${layer.id}:${samples.join(';')}`);
    }
    return parts.join('|');
  });
}

test.describe('#1543: History-panel jumps across metadata and pixel steps', () => {
  test('every row reads the same whether reached one step at a time or by a jump', async ({ page }) => {
    await createDocument(page, 200, 160, false);
    await addLayer(page);
    await drawRect(page, 20, 20, 120, 90, { r: 220, g: 40, b: 40 });

    const rootId = await getRootGroupId(page);
    await addAdjustment(page, rootId, 'exposure', { exposure: 1 });

    await selectTool(page, 'crop');
    await dragOnDoc(page, { x: 30, y: 30 }, { x: 170, y: 130 });
    expect((await getEditorState(page)).document.width).toBeLessThan(200);

    await addAdjustment(page, rootId, 'exposure', { exposure: -1 });

    await openHistoryPanel(page);
    const labels = await historyLabels(page);
    const last = labels.length - 1;
    expect(labels).toContain('Crop Canvas');
    const cropRow = labels.indexOf('Crop Canvas');
    expect(labels.slice(cropRow + 1).length).toBeGreaterThan(0);

    // Reference: walk back one row at a time, then forward again.
    const reference: string[] = [];
    reference[last] = await fingerprint(page);
    for (let i = last - 1; i >= 0; i--) {
      await clickHistoryRow(page, i);
      reference[i] = await fingerprint(page);
    }
    for (let i = 1; i <= last; i++) {
      await clickHistoryRow(page, i);
      expect(await fingerprint(page), `stepping forward to row ${i}`).toBe(reference[i]);
    }
    expect(await historyLabels(page)).toEqual(labels);

    // Jumps that cross the crop and land on metadata rows on either side.
    const jumps = [0, last, cropRow - 1, last, 1, cropRow + 1, 0, cropRow, last - 1, 2, last];
    for (const row of jumps) {
      if (row < 0 || row > last) continue;
      await clickHistoryRow(page, row);
      expect(await fingerprint(page), `jump to row ${row} (${labels[row]})`).toBe(reference[row]);
      expect(await historyLabels(page), `labels after jump to row ${row}`).toEqual(labels);
    }

    // Then walk the whole list front to back, as in the report.
    for (let i = 0; i <= last; i++) {
      await clickHistoryRow(page, i);
      expect(await fingerprint(page), `final walk, row ${i}`).toBe(reference[i]);
    }
  });
});

test.describe('#1545: Add Mask with an active selection', () => {
  test('masks the layer to the selection and deselects', async ({ page }) => {
    await createDocument(page, 200, 200, false);
    await addLayer(page);
    await drawRect(page, 0, 0, 200, 200, { r: 255, g: 0, b: 0 });

    await page.locator('[data-tool-id="marquee-ellipse"]').click();
    await dragOnDoc(page, { x: 50, y: 50 }, { x: 150, y: 150 });
    const before = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { selection: { active: boolean } };
      };
      return store.getState().selection.active;
    });
    expect(before).toBe(true);

    await page.locator('[aria-label="Add Mask"]').click();
    await page.waitForTimeout(200);

    const result = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          selection: { active: boolean };
          document: {
            activeLayerId: string;
            layers: Array<{ id: string; mask: { data: Uint8ClampedArray; width: number } | null }>;
          };
        };
      };
      const s = store.getState();
      const layer = s.document.layers.find((l) => l.id === s.document.activeLayerId)!;
      const m = layer.mask!;
      return {
        selectionActive: s.selection.active,
        centre: m.data[100 * m.width + 100],
        corner: m.data[5 * m.width + 5],
      };
    });
    expect(result.centre).toBe(255);
    expect(result.corner).toBe(0);
    expect(result.selectionActive).toBe(false);

    // The composite keeps a red disc on the white Background: about pi/4
    // of the document stays red instead of all of it.
    const counts = await page.evaluate(async () => {
      const w = window as unknown as Record<string, unknown>;
      const read = w.__readCompositedPixels as
        () => Promise<{ width: number; height: number; pixels: number[] } | null>;
      const p = await read();
      if (!p) return null;
      let red = 0;
      let white = 0;
      for (let i = 0; i < p.pixels.length; i += 4) {
        const r = p.pixels[i] ?? 0;
        const g = p.pixels[i + 1] ?? 0;
        const b = p.pixels[i + 2] ?? 0;
        if (r > 240 && g < 20 && b < 20) red++;
        else if (r > 240 && g > 240 && b > 240) white++;
      }
      return { red, white };
    });
    expect(counts).not.toBeNull();
    const redShare = counts!.red / (counts!.red + counts!.white);
    expect(redShare).toBeGreaterThan(0.1);
    expect(redShare).toBeLessThan(0.5);

    // Undo brings back the selection and removes the mask.
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    const undone = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          selection: { active: boolean };
          document: { activeLayerId: string; layers: Array<{ id: string; mask: unknown }> };
        };
      };
      const s = store.getState();
      return {
        selectionActive: s.selection.active,
        hasMask: s.document.layers.find((l) => l.id === s.document.activeLayerId)!.mask !== null,
      };
    });
    expect(undone).toEqual({ selectionActive: true, hasMask: false });
  });
});
