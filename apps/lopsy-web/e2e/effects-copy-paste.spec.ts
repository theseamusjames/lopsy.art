/**
 * Copy / Paste in the effects drawer. A layer's Copy effects button (and the
 * per-row Copy <Effect> effect buttons) fill an in-app clipboard; Paste
 * effects is disabled until it holds layer effects, overwrites every effect
 * for a full copy, switches on just the copied effect for a single one, and
 * is one undo step. A group's Adjustments drawer does the same with its
 * adjustment stack, where a single adjustment is appended.
 */
import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  addLayer,
  setActiveLayer,
  drawRect,
  configureEffect,
  setEffectColor,
  openEffectsPanel,
  addAdjustment,
  openGroupEffectsPanel,
} from './helpers';

interface Rgba { r: number; g: number; b: number; a: number }

interface EffectsSnapshot {
  stroke: { enabled: boolean; width: number; color: Rgba };
  outerGlow: { enabled: boolean };
  colorOverlay: { enabled: boolean; color: Rgba };
  dropShadow: { enabled: boolean };
}

interface AdjustmentSnapshot { id: string; type: string; enabled: boolean; [key: string]: unknown }

// Red source square and green target square on a white page.
const A = { x: 40, y: 60, w: 100, h: 100 };
const B = { x: 240, y: 60, w: 100, h: 100 };
const STROKE_WIDTH = 8;

async function readCompositedAt(page: Page, points: Array<[number, number]>): Promise<Rgba[]> {
  return page.evaluate(async (pts) => {
    const readFn = (window as unknown as Record<string, unknown>).__readCompositedPixels as
      () => Promise<{ width: number; height: number; pixels: number[] } | null>;
    const result = await readFn();
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { width: number; height: number };
        viewport: { zoom: number; panX: number; panY: number };
      };
    };
    const { document: doc, viewport: vp } = store.getState();
    return pts.map(([x, y]) => {
      if (!result) return { r: 0, g: 0, b: 0, a: 0 };
      const sx = Math.round((x - doc.width / 2) * vp.zoom + vp.panX + result.width / 2);
      const sy = Math.round((y - doc.height / 2) * vp.zoom + vp.panY + result.height / 2);
      const idx = ((result.height - 1 - sy) * result.width + sx) * 4;
      return {
        r: result.pixels[idx] ?? 0,
        g: result.pixels[idx + 1] ?? 0,
        b: result.pixels[idx + 2] ?? 0,
        a: result.pixels[idx + 3] ?? 0,
      };
    });
  }, points);
}

/** Read-only: the effects stored on a layer. */
async function layerEffects(page: Page, layerId: string): Promise<EffectsSnapshot> {
  return page.evaluate((id) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; effects: unknown }> } };
    };
    const layer = store.getState().document.layers.find((l) => l.id === id);
    return JSON.parse(JSON.stringify(layer?.effects)) as EffectsSnapshot;
  }, layerId);
}

/** Read-only: a group's adjustment stack. */
async function groupAdjustments(page: Page, groupId: string): Promise<AdjustmentSnapshot[]> {
  return page.evaluate((id) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; adjustments?: unknown[] }> } };
    };
    const layer = store.getState().document.layers.find((l) => l.id === id);
    return JSON.parse(JSON.stringify(layer?.adjustments ?? [])) as AdjustmentSnapshot[];
  }, groupId);
}

/** Two square layers: A (red, with effects) and B (green, plain). */
async function setupTwoLayers(page: Page): Promise<{ a: string; b: string }> {
  const a = await addLayer(page);
  await drawRect(page, A.x, A.y, A.w, A.h, { r: 255, g: 0, b: 0 });
  const b = await addLayer(page);
  await drawRect(page, B.x, B.y, B.w, B.h, { r: 0, g: 255, b: 0 });

  await setActiveLayer(page, a);
  await configureEffect(page, 'Stroke', { Width: STROKE_WIDTH });
  await setEffectColor(page, 'Stroke color', 255, 255, 0);
  await configureEffect(page, 'Color Overlay', {});
  await setEffectColor(page, 'Overlay color', 0, 0, 255);
  return { a, b };
}

const bCenter: [number, number] = [B.x + B.w / 2, B.y + B.h / 2];
// Four px outside B's left edge: inside an 8 px outside stroke.
const bStrokeProbe: [number, number] = [B.x - STROKE_WIDTH / 2, B.y + B.h / 2];

test.describe('Effects copy and paste', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'effects drawer requires sidebar, hidden on touch devices');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
  });

  test('copies all effects from one layer onto another, undoably', async ({ page }) => {
    const { a, b } = await setupTwoLayers(page);
    const drawer = page.getByTestId('effects-drawer');

    await expect(drawer.getByRole('button', { name: 'Paste effects' })).toBeDisabled();
    await drawer.getByRole('button', { name: 'Copy effects' }).click();
    await expect(drawer.getByRole('button', { name: 'Paste effects' })).toBeEnabled();

    // B: a plain green square on white before the paste.
    await setActiveLayer(page, b);
    await openEffectsPanel(page);
    const [centerBefore, edgeBefore] = await readCompositedAt(page, [bCenter, bStrokeProbe]);
    expect(centerBefore).toMatchObject({ r: 0, g: 255, b: 0 });
    expect(edgeBefore).toMatchObject({ r: 255, g: 255, b: 255 });
    const undoBefore = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { undoStack: unknown[] };
      };
      return store.getState().undoStack.length;
    });

    await drawer.getByRole('button', { name: 'Paste effects' }).click();
    await page.screenshot({ path: 'e2e/screenshots/effects-copy-paste-all.png' });

    await expect(drawer.getByLabel('Enable Stroke')).toBeChecked();
    await expect(drawer.getByLabel('Enable Color Overlay')).toBeChecked();
    expect(await layerEffects(page, b)).toEqual(await layerEffects(page, a));

    // B now shows A's blue overlay and its yellow outside stroke.
    const [centerAfter, edgeAfter] = await readCompositedAt(page, [bCenter, bStrokeProbe]);
    expect(centerAfter).toMatchObject({ r: 0, g: 0, b: 255 });
    expect(edgeAfter).toMatchObject({ r: 255, g: 255, b: 0 });
    const undoAfter = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { undoStack: unknown[] };
      };
      return store.getState().undoStack.length;
    });
    expect(undoAfter).toBe(undoBefore + 1);

    await page.keyboard.press('Control+z');
    await expect(drawer.getByLabel('Enable Stroke')).not.toBeChecked();
    await expect(drawer.getByLabel('Enable Color Overlay')).not.toBeChecked();
    const reverted = await layerEffects(page, b);
    expect(reverted.stroke.enabled).toBe(false);
    expect(reverted.colorOverlay.enabled).toBe(false);
    const [centerUndone, edgeUndone] = await readCompositedAt(page, [bCenter, bStrokeProbe]);
    expect(centerUndone).toMatchObject({ r: 0, g: 255, b: 0 });
    expect(edgeUndone).toMatchObject({ r: 255, g: 255, b: 255 });
  });

  test('pastes a single effect and leaves the others alone', async ({ page }) => {
    const { b } = await setupTwoLayers(page);
    const drawer = page.getByTestId('effects-drawer');

    await drawer.getByRole('button', { name: 'Copy Stroke effect' }).click();

    await setActiveLayer(page, b);
    await configureEffect(page, 'Outer Glow', { Size: 10 });
    await drawer.getByRole('button', { name: 'Paste effects' }).click();

    await expect(drawer.getByLabel('Enable Stroke')).toBeChecked();
    await expect(drawer.getByLabel('Enable Outer Glow')).toBeChecked();
    await expect(drawer.getByLabel('Enable Color Overlay')).not.toBeChecked();
    const pasted = await layerEffects(page, b);
    expect(pasted.stroke).toMatchObject({ enabled: true, width: STROKE_WIDTH, color: { r: 255, g: 255, b: 0 } });
    expect(pasted.outerGlow.enabled).toBe(true);
    expect(pasted.colorOverlay.enabled).toBe(false);

    // Stroke drawn, but B keeps its own green: the overlay was not copied.
    const [center, edge] = await readCompositedAt(page, [bCenter, bStrokeProbe]);
    expect(center).toMatchObject({ r: 0, g: 255, b: 0 });
    expect(edge).toMatchObject({ r: 255, g: 255, b: 0 });

    await page.keyboard.press('Control+z');
    await expect(drawer.getByLabel('Enable Stroke')).not.toBeChecked();
    await expect(drawer.getByLabel('Enable Outer Glow')).toBeChecked();
  });

  test('copies and pastes group adjustments', async ({ page }) => {
    await page.getByRole('button', { name: 'New Group' }).click();
    const g1 = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { activeLayerId: string } };
      };
      return store.getState().document.activeLayerId;
    });
    await addAdjustment(page, g1, 'exposure', { exposure: 1.5 });
    await addAdjustment(page, g1, 'invert');
    const drawer = page.getByTestId('effects-drawer');

    // Nothing copied yet: Paste is disabled.
    await expect(drawer.getByRole('button', { name: 'Paste adjustments' })).toBeDisabled();
    await drawer.getByRole('button', { name: 'Copy adjustments' }).click();

    await page.getByRole('button', { name: 'Close effects' }).click();
    await page.getByRole('button', { name: 'New Group' }).click();
    const g2 = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { activeLayerId: string } };
      };
      return store.getState().document.activeLayerId;
    });
    expect(g2).not.toBe(g1);
    await openGroupEffectsPanel(page, g2);
    await addAdjustment(page, g2, 'contrast', { contrast: 30 });

    await drawer.getByRole('button', { name: 'Paste adjustments' }).click();
    const replaced = await groupAdjustments(page, g2);
    expect(replaced.map((n) => n.type)).toEqual(['exposure', 'invert']);
    expect(replaced[0]?.exposure).toBe(1.5);
    const source = await groupAdjustments(page, g1);
    expect(replaced.map((n) => n.id)).not.toContain(source[0]?.id);

    await page.keyboard.press('Control+z');
    const undone = await groupAdjustments(page, g2);
    expect(undone.map((n) => n.type)).toEqual(['contrast']);

    // A single adjustment is appended to the stack.
    await setActiveLayer(page, g1);
    await drawer.getByRole('button', { name: 'Copy Exposure adjustment' }).click();
    await setActiveLayer(page, g2);
    await drawer.getByRole('button', { name: 'Paste adjustments' }).click();
    const appended = await groupAdjustments(page, g2);
    expect(appended.map((n) => n.type)).toEqual(['contrast', 'exposure']);
    expect(appended[1]?.exposure).toBe(1.5);
    await expect(drawer.getByText('Exposure', { exact: true }).first()).toBeVisible();

    // The group clipboard does not enable Paste on a pixel layer.
    const layerId = await addLayer(page);
    await setActiveLayer(page, layerId);
    await openEffectsPanel(page);
    await expect(drawer.getByRole('button', { name: 'Paste effects' })).toBeDisabled();
  });
});
