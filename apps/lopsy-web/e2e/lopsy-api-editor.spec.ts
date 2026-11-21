/**
 * `window.lopsy` on the editor page (`/`): an agent and a person working in
 * the same document. Everything the agent does goes through the public API
 * (`page.evaluate(() => window.lopsy.run(...))`); everything the person does
 * goes through the UI: keys, the mouse on the canvas, the panels. Nothing
 * here reads the stores or `window.__lopsyCommands`; what a test checks is
 * either on screen or answered by the API.
 */
import { test, expect, type Page } from './fixtures';
import {
  expectDocumentCommandsOnly,
  lopsy,
  lopsyDescribe,
  lopsyResult,
  waitForLopsy,
} from './lopsy-api-helpers';

const DOC = { width: 400, height: 300 };

interface DocumentInfo {
  layers: Array<{ id: string; name: string; type: string; locked: boolean; isActive: boolean }>;
  selection: { active: boolean; bounds: { x: number; y: number; width: number; height: number } | null };
  history: { undo: string[]; redo: string[] };
  activeTool: string;
}

interface Sample {
  hex: string;
  alpha: number;
}

async function openEditor(page: Page): Promise<void> {
  await page.goto('/');
  await waitForLopsy(page);
}

/** The agent makes the document; the editor then shows it. */
async function agentNewDocument(page: Page): Promise<void> {
  await lopsyResult(page, { op: 'doc.new', ...DOC });
  await expect(page.locator('[data-testid="canvas-container"]')).toBeVisible();
}

async function docInfo(page: Page): Promise<DocumentInfo> {
  return lopsyResult<DocumentInfo>(page, { op: 'doc.info' });
}

async function sample(page: Page, x: number, y: number): Promise<string> {
  return (await lopsyResult<Sample>(page, { op: 'view.sample', x, y })).hex;
}

/**
 * Where a document point is on screen. A new document is fitted to the
 * canvas area as fitToView does (40 px of padding, never above 100%) and
 * centred; the person has not zoomed or panned.
 */
async function docToScreen(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const box = (await page.locator('[data-testid="canvas-container"]').boundingBox())!;
  const padding = Math.min(40, box.width / 4, box.height / 4);
  const zoom = Math.min((box.width - padding * 2) / DOC.width, (box.height - padding * 2) / DOC.height, 1);
  return {
    x: box.x + box.width / 2 + (x - DOC.width / 2) * zoom,
    y: box.y + box.height / 2 + (y - DOC.height / 2) * zoom,
  };
}

/** The colour the person sees on screen at a document point, from a screenshot of that one pixel. */
async function screenColor(page: Page, x: number, y: number): Promise<[number, number, number]> {
  const at = await docToScreen(page, x, y);
  const png = await page.screenshot({ clip: { x: Math.round(at.x), y: Math.round(at.y), width: 1, height: 1 } });
  return page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(1, 1);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    const [r = 0, g = 0, b = 0] = ctx.getImageData(0, 0, 1, 1).data;
    return [r, g, b] as [number, number, number];
  }, png.toString('base64'));
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  const a = await docToScreen(page, from.x, from.y);
  const b = await docToScreen(page, to.x, to.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await page.mouse.up();
}

function layerRow(page: Page, name: string) {
  return page.locator('[data-layer-id]').filter({ hasText: name });
}

async function openHistoryPanel(page: Page) {
  await page.locator('[role="toolbar"][aria-label="Panel visibility"] button[aria-label="History"]').click();
  const panel = page.locator('section[role="tabpanel"][aria-label="History"]');
  await expect(panel).toBeVisible();
  return panel;
}

/** One Dismiss button per toast showing. */
const toasts = (page: Page) => page.locator('[role="status"] button[aria-label="Dismiss"]');

test.describe('window.lopsy on the editor', () => {
  test('exists on the first-run screen, offers the document commands, and doc.new opens the editor', async ({ page }) => {
    await openEditor(page);
    const firstRun = page.getByRole('dialog', { name: 'New Document' });
    await expect(firstRun).toBeVisible();
    await expect(page.locator('nav[aria-label="Application menu"]')).toHaveCount(0);

    expectDocumentCommandsOnly(await lopsyDescribe(page));
    expect(await lopsy(page, { op: 'doc.info' })).toMatchObject({
      ok: false,
      error: { code: 'unavailable', message: expect.stringMatching(/No document is open/) },
    });

    expect(await lopsy(page, { op: 'doc.new', ...DOC })).toMatchObject({ ok: true, result: DOC });
    await expect(firstRun).toHaveCount(0);
    await expect(page.locator('nav[aria-label="Application menu"]')).toBeVisible();
    await expect(page.locator('[data-tool-id="brush"]')).toBeVisible();
    await expect(page.locator('[aria-label="Add Layer"]')).toBeVisible();
    await expect(page.locator('[data-testid="canvas-container"] canvas[aria-label="Drawing canvas"]')).toBeVisible();
    await expect(layerRow(page, 'Background')).toBeVisible();
    await expect(layerRow(page, 'Layer 1')).toBeVisible();
    await page.screenshot({ path: 'e2e/screenshots/lopsy-api-editor-new-document.png' });
  });

  test('the agent adds a layer and fills it; the panels show it and the undo key takes back the fill', async ({ page }) => {
    await openEditor(page);
    await agentNewDocument(page);
    const history = await openHistoryPanel(page);

    const made = await lopsy(page, [
      { op: 'layer.add' },
      { op: 'color.set', foreground: '#ff0000' },
      { op: 'select.rect', x: 50, y: 50, width: 100, height: 80 },
      { op: 'paint.fill' },
      { op: 'select.none' },
    ]);
    expect(made.ok, JSON.stringify(made)).toBe(true);

    await expect(layerRow(page, 'Layer 2')).toBeVisible();
    await expect(history.getByRole('button')).toHaveText(['0Original', '1New Document', '2Add Layer', '3Fill']);
    // The person sees the red rectangle on the canvas, and white beside it.
    await expect.poll(() => screenColor(page, 100, 90)).toEqual([255, 0, 0]);
    expect(await screenColor(page, 250, 90)).toEqual([255, 255, 255]);
    await page.screenshot({ path: 'e2e/screenshots/lopsy-api-editor-agent-fill.png' });

    await page.keyboard.press('ControlOrMeta+z');

    await expect.poll(() => screenColor(page, 100, 90)).toEqual([255, 255, 255]);
    await expect(history.getByRole('button').last()).toHaveText(/Fill/);
    await expect(history.getByRole('button').last()).toHaveClass(/entryFuture/);
    await expect(layerRow(page, 'Layer 2')).toBeVisible();
    const info = await docInfo(page);
    expect(info.history).toEqual({ undo: ['New Document', 'Add Layer'], redo: ['Fill'] });
    expect(await sample(page, 100, 90)).toBe('#ffffff');
    await page.screenshot({ path: 'e2e/screenshots/lopsy-api-editor-person-undo.png' });
  });

  test('the person adds a layer and paints a stroke; the agent sees both and undoes the stroke', async ({ page }) => {
    await openEditor(page);
    await agentNewDocument(page);

    await page.locator('[aria-label="Add Layer"]').click();
    await expect(layerRow(page, 'Layer 2')).toBeVisible();
    await page.keyboard.press('b');
    await drag(page, { x: 60, y: 200 }, { x: 300, y: 200 });

    const info = await docInfo(page);
    expect(info.history.undo).toEqual(['New Document', 'Add Layer', 'Brush']);
    expect(info.layers.find((l) => l.isActive)?.name).toBe('Layer 2');
    expect(info.activeTool).toBe('brush');
    // The default brush paints black; the stroke's middle and a point well off it.
    expect(await sample(page, 180, 200)).toBe('#000000');
    expect(await sample(page, 180, 100)).toBe('#ffffff');
    await page.screenshot({ path: 'e2e/screenshots/lopsy-api-editor-person-stroke.png' });

    expect(await lopsy(page, { op: 'history.undo' })).toEqual({
      ok: true,
      result: { undo: ['New Document', 'Add Layer'], redo: ['Brush'] },
    });
    expect(await sample(page, 180, 200)).toBe('#ffffff');
    await expect.poll(() => screenColor(page, 180, 200)).toEqual([255, 255, 255]);
    await expect(layerRow(page, 'Layer 2')).toBeVisible();
  });

  test('a ui command is answered as an unknown command, as on the agent page, and opens nothing', async ({ page }) => {
    await openEditor(page);
    await agentNewDocument(page);
    for (const op of ['ui.layer-properties', 'ui.view.fit', 'ui.dialog.filter']) {
      const outcome = await lopsy(page, { op });
      expect(outcome, op).toEqual({
        ok: false,
        error: { name: 'CommandError', code: 'not-found', message: expect.stringContaining(`Unknown command ${JSON.stringify(op)}`) },
      });
      if (outcome.ok) continue;
      expect(outcome.error.message).not.toMatch(/Did you mean:[^?]*\bui\./);
    }
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
    expect((await docInfo(page)).history.undo).toEqual(['New Document']);
  });

  test('a refusal the menu toasts reaches the agent as an error and shows the person no toast', async ({ page }) => {
    await openEditor(page);
    await agentNewDocument(page);

    // The person: the root group selected in the Layers panel, then Edit > Copy's key.
    await layerRow(page, 'Project').first().click();
    await page.keyboard.press('ControlOrMeta+c');
    await expect(toasts(page)).toHaveCount(1);
    await expect(page.getByText("Groups can't be copied from.", { exact: false })).toBeVisible();
    await toasts(page).click();
    await expect(toasts(page)).toHaveCount(0);

    // The agent, with the same group active.
    expect(await lopsy(page, { op: 'clipboard.copy' })).toEqual({
      ok: false,
      error: {
        name: 'CommandError',
        code: 'refused',
        message: "Groups can't be copied from. Select a layer inside the group, or use Copy Merged.",
      },
    });
    // Give a toast time to appear: none does.
    await page.waitForTimeout(500);
    await expect(toasts(page)).toHaveCount(0);
  });

  test('while the person has a Move transform pending, layer.transform is refused and changes nothing', async ({ page }) => {
    await openEditor(page);
    await agentNewDocument(page);
    await lopsyResult(page, { op: 'layer.add' });
    await lopsy(page, [
      { op: 'color.set', foreground: '#ff0000' },
      { op: 'select.rect', x: 100, y: 100, width: 60, height: 60 },
      { op: 'paint.fill' },
    ]);

    // The person scales the selected square from its bottom-right handle with the Move tool.
    await page.keyboard.press('v');
    await drag(page, { x: 160, y: 160 }, { x: 190, y: 190 });
    const pending = await docInfo(page);
    expect(pending.history.undo.at(-1)).toBe('Transform');
    expect(pending.selection.active).toBe(true);
    expect(await sample(page, 185, 185)).toBe('#ff0000');

    const outcome = await lopsy(page, { op: 'layer.transform', rotate: 90 });
    expect(outcome).toMatchObject({ ok: false, error: { code: 'refused', message: expect.stringContaining('A marquee is active') } });
    expect(await docInfo(page)).toEqual(pending);
    expect(await sample(page, 185, 185)).toBe('#ff0000');
    expect(await sample(page, 120, 170)).toBe('#ff0000');
  });

  test('without WebGL2 the editor shows its warning and every call is answered unavailable at once', async ({ page }) => {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof original>) {
        return args[0] === 'webgl2' ? null : original.apply(this, args);
      } as typeof original;
    });
    await openEditor(page);
    await expect(page.getByRole('heading', { name: 'WebGL 2 is not available' })).toBeVisible();
    const started = Date.now();
    expect(await lopsy(page, { op: 'doc.new', ...DOC })).toMatchObject({
      ok: false,
      error: { code: 'unavailable', message: expect.stringContaining('no WebGL2') },
    });
    expect(Date.now() - started).toBeLessThan(2_000);
    await expect(page.locator('[data-testid="canvas-container"]')).toHaveCount(0);
    expectDocumentCommandsOnly(await lopsyDescribe(page));
  });
});
