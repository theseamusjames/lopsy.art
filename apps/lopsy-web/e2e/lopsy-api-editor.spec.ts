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
  foregroundColor: string;
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

/** The person types a foreground colour into the Color panel's hex field. */
async function pickForeground(page: Page, hex: string): Promise<void> {
  const field = page.locator('[aria-label="Hex color value"]');
  if (!(await field.isVisible())) await page.locator('button[aria-label="Color panel"]').click();
  await field.fill(hex.replace('#', ''));
  await field.press('Enter');
}

/** The person's brush stroke across the document, with the Brush tool's key. */
async function personStroke(page: Page): Promise<void> {
  await page.keyboard.press('b');
  await drag(page, { x: 60, y: 200 }, { x: 300, y: 200 });
}

/** A red 60 px square on a new layer, selected, which the person scales from its corner with the Move tool. */
async function personPendingScale(page: Page): Promise<DocumentInfo> {
  await lopsyResult(page, { op: 'layer.add' });
  await lopsy(page, [
    { op: 'color.set', foreground: '#ff0000' },
    { op: 'select.rect', x: 100, y: 100, width: 60, height: 60 },
    { op: 'paint.fill' },
  ]);
  await page.keyboard.press('v');
  await drag(page, { x: 160, y: 160 }, { x: 190, y: 190 });
  const pending = await docInfo(page);
  expect(pending.history.undo.at(-1)).toBe('Transform');
  // Pending: the selection is still the square's, and the scaled pixels show beyond it.
  expect(pending.selection.bounds).toEqual({ x: 100, y: 100, width: 60, height: 60 });
  expect(await sample(page, 185, 185)).toBe('#ff0000');
  return pending;
}

test.describe('window.lopsy on the editor', () => {
  test.beforeEach(({ browserName, isMobile }) => {
    test.skip(browserName !== 'chromium' || isMobile, 'the guide says the API is tested in desktop Chromium');
  });

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

  test('a ui command is answered as an unknown command and opens nothing', async ({ page }) => {
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

  test('run() resolves to an outcome for every kind of refusal, and for a batch', async ({ page }) => {
    await openEditor(page);
    expect(await lopsy(page, { op: 'doc.new', width: 0, height: 10 })).toMatchObject({
      ok: false,
      error: { name: 'CommandError', code: 'invalid' },
    });
    expect(await lopsy(page, { op: 'doc.nwe' })).toMatchObject({
      ok: false,
      error: { code: 'not-found', message: expect.stringContaining('Did you mean: doc.new') },
    });
    await agentNewDocument(page);

    const batch = await lopsy(page, [{ op: 'layer.add' }, { op: 'color.set', foreground: '#ff0000' }]);
    expect(batch).toMatchObject({ ok: true, results: [{ id: expect.any(String) }, { foreground: '#ff0000' }] });

    const failed = await lopsy(page, [{ op: 'layer.add' }, { op: 'layer.select', layer: 'No such layer' }, { op: 'layer.add' }]);
    expect(failed).toMatchObject({
      ok: false,
      error: { code: 'not-found', index: 1, completed: [{ id: expect.any(String) }], message: expect.stringMatching(/^\[1\] layer\.select: /) },
    });
    // The step after the failure did not run.
    const info = await docInfo(page);
    expect(info.layers.filter((l) => l.type !== 'group').map((l) => l.name)).toEqual(['Background', 'Layer 1', 'Layer 2', 'Layer 3']);
    await expect(layerRow(page, 'Layer 3')).toBeVisible();
    await expect(layerRow(page, 'Layer 4')).toHaveCount(0);
  });

  test('a new document leaves the active tool as it was', async ({ page }) => {
    await openEditor(page);
    await agentNewDocument(page);
    expect((await docInfo(page)).activeTool).toBe('move');
    const stroked = await lopsy(page, [
      { op: 'paint.stroke', points: [{ x: 20, y: 20 }, { x: 120, y: 90 }] },
      { op: 'doc.new', ...DOC },
    ]);
    expect(stroked.ok, JSON.stringify(stroked)).toBe(true);
    expect((await docInfo(page)).activeTool).toBe('brush');
    await expect(page.locator('[data-tool-id="brush"]')).toHaveAttribute('aria-pressed', 'true');
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
    const pending = await personPendingScale(page);

    const outcome = await lopsy(page, { op: 'layer.transform', rotate: 90 });
    expect(outcome).toMatchObject({ ok: false, error: { code: 'refused', message: expect.stringContaining('A marquee is active') } });
    expect(await docInfo(page)).toEqual(pending);
    expect(await sample(page, 185, 185)).toBe('#ff0000');
    expect(await sample(page, 120, 170)).toBe('#ff0000');
  });

  for (const ending of ['Cancel', 'Apply'] as const) {
    test(`while a filter's live preview shows, a call is refused unchanged; after ${ending} it runs`, async ({ page }) => {
      await openEditor(page);
      await agentNewDocument(page);
      // A blue square, and red as the colour for the fill the agent will ask for.
      const setup = await lopsy(page, [
        { op: 'color.set', foreground: '#0000ff' },
        { op: 'select.rect', x: 100, y: 100, width: 100, height: 100 },
        { op: 'paint.fill' },
        { op: 'select.none' },
        { op: 'color.set', foreground: '#ff0000' },
      ]);
      const redFill = [{ op: 'select.rect', x: 10, y: 10, width: 30, height: 30 }, { op: 'paint.fill' }, { op: 'select.none' }];
      expect(setup.ok, JSON.stringify(setup)).toBe(true);
      const history = await openHistoryPanel(page);

      await page.locator('nav[aria-label="Application menu"]').getByText('Filter', { exact: true }).click();
      await page.getByRole('menuitem', { name: /^Gaussian Blur/ }).click();
      const dialog = page.getByRole('dialog').filter({ hasText: 'Gaussian Blur' });
      await expect(dialog).toBeVisible();

      // Preview off: the dialog alone does not stop a call.
      expect(await lopsy(page, { op: 'doc.info' })).toMatchObject({ ok: true });

      // Just left of the square's edge: the preview's blur spreads blue onto it, on screen.
      const unblurred = await screenColor(page, 97, 150);
      await dialog.getByLabel('Preview').check();
      await expect.poll(() => screenColor(page, 97, 150)).not.toEqual(unblurred);
      const rowsBefore = await history.getByRole('button').allTextContents();
      const fillCorner = await screenColor(page, 20, 20);

      for (const invocation of [{ op: 'paint.fill' }, { op: 'doc.info' }, { op: 'color.set', foreground: '#00ff00' }]) {
        expect(await lopsy(page, invocation), invocation.op).toEqual({
          ok: false,
          error: {
            name: 'CommandError',
            code: 'unavailable',
            message: 'The person has a dialog open with a live preview on the layer. Nothing was run. Send the call again once they apply or cancel it.',
          },
        });
      }
      expect(await lopsy(page, redFill)).toMatchObject({ ok: false, error: { code: 'unavailable', index: 0, completed: [] } });
      await expect(history.getByRole('button')).toHaveText(rowsBefore);
      expect(await screenColor(page, 20, 20)).toEqual(fillCorner);
      await page.screenshot({ path: `e2e/screenshots/lopsy-api-editor-preview-refused-${ending.toLowerCase()}.png` });

      await dialog.getByRole('button', { name: ending }).click();
      await expect(dialog).toHaveCount(0);

      expect(await lopsy(page, redFill)).toMatchObject({ ok: true });
      const info = await docInfo(page);
      expect(info.history.undo).toEqual(
        ending === 'Apply' ? ['New Document', 'Fill', 'Gaussian Blur', 'Fill'] : ['New Document', 'Fill', 'Fill'],
      );
      expect(info.foregroundColor).toBe('#ff0000');
      expect(await sample(page, 20, 20)).toBe('#ff0000');
      // The square's left edge: blurred into the white after Apply, as sharp as it was after Cancel.
      const edge = await sample(page, 100, 150);
      if (ending === 'Apply') expect(['#0000ff', '#ffffff']).not.toContain(edge);
      else expect(edge).toBe('#0000ff');
      expect(await sample(page, 150, 150)).toBe('#0000ff');
      await expect.poll(() => screenColor(page, 20, 20)).toEqual([255, 0, 0]);
      await page.screenshot({ path: `e2e/screenshots/lopsy-api-editor-preview-after-${ending.toLowerCase()}.png` });
    });
  }

  test('while the person holds a brush stroke, calls are refused; the stroke stays whole and the calls then run', async ({ page }) => {
    await openEditor(page);
    await agentNewDocument(page);
    await page.keyboard.press('b');

    const start = await docToScreen(page, 60, 200);
    const middle = await docToScreen(page, 180, 200);
    const end = await docToScreen(page, 300, 250);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(middle.x, middle.y, { steps: 10 });

    const busy = 'A drag or scroll on the canvas is in progress. Nothing was run. Send the call again once it is released.';
    const stroke = { op: 'paint.stroke', points: [{ x: 50, y: 50 }, { x: 300, y: 60 }] };
    for (const invocation of [stroke, { op: 'layer.add' }]) {
      expect(await lopsy(page, invocation), invocation.op).toEqual({
        ok: false,
        error: { name: 'CommandError', code: 'unavailable', message: busy },
      });
    }

    await page.mouse.move(end.x, end.y, { steps: 10 });
    await page.mouse.up();

    const info = await docInfo(page);
    expect(info.history.undo).toEqual(['New Document', 'Brush']);
    expect(info.layers.filter((l) => l.type !== 'group').map((l) => l.name)).toEqual(['Background', 'Layer 1']);
    // The person's stroke, before and after the refused calls, and none of the agent's.
    expect(await sample(page, 120, 200)).toBe('#000000');
    expect(await sample(page, 280, 240)).toBe('#000000');
    expect(await sample(page, 175, 55)).toBe('#ffffff');
    await page.screenshot({ path: 'e2e/screenshots/lopsy-api-editor-held-stroke.png' });

    // Released: the same calls run, and a batch of two gestures does not refuse its own second step.
    expect(await lopsy(page, [{ op: 'layer.add' }, stroke, { ...stroke, points: [{ x: 50, y: 90 }, { x: 300, y: 100 }] }])).toMatchObject({ ok: true });
    expect((await docInfo(page)).history.undo).toEqual(['New Document', 'Brush', 'Add Layer', 'Brush', 'Brush']);
    expect(await sample(page, 175, 55)).toBe('#000000');
    expect(await sample(page, 175, 95)).toBe('#000000');
  });

  for (const op of ['paint.fill', 'paint.stroke'] as const) {
    test(`${op} commits the person's pending Move transform and paints inside the transformed selection`, async ({ page }) => {
      await openEditor(page);
      await agentNewDocument(page);
      await personPendingScale(page);

      const paint = op === 'paint.fill'
        ? { op }
        : { op, points: [{ x: 150, y: 185 }, { x: 300, y: 185 }] };
      expect(await lopsy(page, [{ op: 'color.set', foreground: '#0000ff' }, paint])).toMatchObject({ ok: true });

      const info = await docInfo(page);
      expect(info.history.undo).toEqual(['New Document', 'Add Layer', 'Fill', 'Transform', op === 'paint.fill' ? 'Fill' : 'Brush']);
      // Committed: the selection now hugs the scaled square, about 90 px a side from (100, 100).
      expect(info.selection.active).toBe(true);
      expect(info.selection.bounds!.x).toBeGreaterThanOrEqual(98);
      expect(info.selection.bounds!.width).toBeGreaterThan(85);
      // The paint lands where only the scaled square reaches, and nowhere outside it.
      expect(await sample(page, 185, 185)).toBe('#0000ff');
      expect(await sample(page, 250, 185)).toBe('#ffffff');
      expect(await sample(page, 50, 50)).toBe('#ffffff');
      await page.screenshot({ path: `e2e/screenshots/lopsy-api-editor-pending-transform-${op.replace('.', '-')}.png` });
    });
  }

  test('a foreground the person picks in the Color panel is the one the agent fills with', async ({ page }) => {
    await openEditor(page);
    await agentNewDocument(page);
    await pickForeground(page, '#2a9d8f');

    expect(await lopsy(page, [
      { op: 'select.rect', x: 10, y: 10, width: 50, height: 50 },
      { op: 'paint.fill' },
      { op: 'select.none' },
    ])).toMatchObject({ ok: true });
    expect((await docInfo(page)).foregroundColor).toBe('#2a9d8f');
    expect(await sample(page, 30, 30)).toBe('#2a9d8f');
    expect(await sample(page, 100, 100)).toBe('#ffffff');
    await page.screenshot({ path: 'e2e/screenshots/lopsy-api-editor-person-colour.png' });
  });

  test('doc.new and doc.open replace the person\'s unsaved document without asking', async ({ page }) => {
    await openEditor(page);
    await agentNewDocument(page);
    const saved = await lopsyResult<{ base64: string }>(page, { op: 'doc.save' });
    const dialogs: string[] = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.type());
      void dialog.dismiss();
    });

    for (const replace of [{ op: 'doc.new', ...DOC }, { op: 'doc.open', base64: saved.base64, name: 'checkpoint.lopsy' }]) {
      await personStroke(page);
      expect(await sample(page, 180, 200), replace.op).toBe('#000000');
      expect((await docInfo(page)).history.undo.at(-1), replace.op).toBe('Brush');

      expect(await lopsy(page, replace), replace.op).toMatchObject({ ok: true });
      expect(dialogs, replace.op).toEqual([]);
      expect(await sample(page, 180, 200), replace.op).toBe('#ffffff');
      await expect.poll(() => screenColor(page, 180, 200)).toEqual([255, 255, 255]);
      // The person's undo key cannot bring the stroke back.
      await page.keyboard.press('ControlOrMeta+z');
      expect(await sample(page, 180, 200), replace.op).toBe('#ffffff');
      expect((await docInfo(page)).history.undo, replace.op).not.toContain('Brush');
    }
  });

  test('a read leaves the person\'s text editing open; an edit commits what they typed', async ({ page }) => {
    await openEditor(page);
    await agentNewDocument(page);
    await page.keyboard.press('t');
    const at = await docToScreen(page, 100, 100);
    await page.mouse.click(at.x, at.y);
    await page.keyboard.type('Hello');

    const editing = await docInfo(page);
    const text = editing.layers.find((l) => l.type === 'text')!;
    expect(text.name).toBe('Text 1');
    expect(editing.history.undo).toEqual(['New Document']);
    await page.screenshot({ path: 'e2e/screenshots/lopsy-api-editor-person-typing.png' });

    expect(await lopsy(page, { op: 'layer.add', name: 'Agent' })).toMatchObject({ ok: true });
    const after = await docInfo(page);
    expect(after.layers.find((l) => l.id === text.id)?.name).toBe('Hello');
    expect(after.history.undo).toEqual(expect.arrayContaining(['Add Text Layer', 'Text', 'Add Layer', 'Rename Layer']));
    expect(after.layers.find((l) => l.isActive)?.name).toBe('Agent');
    await page.screenshot({ path: 'e2e/screenshots/lopsy-api-editor-typing-committed.png' });
  });

  test('a reload brings back the person\'s panel layout but no document, colour or tool option', async ({ page }) => {
    await openEditor(page);
    await agentNewDocument(page);
    await openHistoryPanel(page);
    await pickForeground(page, '#123456');
    await lopsyResult(page, { op: 'tool.set', tool: 'brush', options: { size: 77 } });
    expect((await docInfo(page)).foregroundColor).toBe('#123456');
    // The document has unsaved changes, so the browser asks before the reload.
    page.on('dialog', (dialog) => void dialog.accept());

    await page.reload();
    await waitForLopsy(page);
    await expect(page.getByRole('dialog', { name: 'New Document' })).toBeVisible();
    expect(await lopsy(page, { op: 'doc.info' })).toMatchObject({ ok: false, error: { code: 'unavailable' } });

    await agentNewDocument(page);
    await expect(page.locator('section[role="tabpanel"][aria-label="History"]')).toBeVisible();
    const info = await docInfo(page);
    expect(info.foregroundColor).toBe('#000000');
    expect(info.activeTool).toBe('move');
    expect(info.history.undo).toEqual(['New Document']);
    const brush = await lopsyResult<{ tools: { brush: { size: { value: number } } } }>(page, { op: 'tool.describe', tool: 'brush' });
    expect(brush.tools.brush.size.value).toBe(10);
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
