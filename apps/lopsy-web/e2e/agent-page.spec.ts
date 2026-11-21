/**
 * The agent page (`/agent/`): the document canvas alone, driven through
 * `window.lopsy`. It has none of the editor's UI, ignores the keyboard,
 * offers exactly the registry's document commands, and a recipe run
 * through it makes the same image as the same recipe run on the editor.
 *
 * This spec reads `window.__lopsyCommands` (the dev hook the API specs use)
 * only to compare the two pages.
 */
import { test, expect, type Page } from './fixtures';
import { serveFontsOffline } from './font-fixtures';
import {
  expectDocumentCommandsOnly,
  lopsy,
  lopsyResult,
  waitForLopsy,
  type Description,
  type Invocation,
  type LopsyWindow,
} from './lopsy-api-helpers';

interface AgentWindow extends LopsyWindow {
  __lopsyCommands?: {
    describe: (surface?: string) => Description[];
    run: (invocation: unknown) => Promise<unknown>;
  };
}

/** The roles and landmarks the editor gives its UI: none of them may be on the agent page. */
const EDITOR_UI = [
  'nav[aria-label="Application menu"]',
  '[data-tool-id]',
  '[role="toolbar"]',
  'footer[aria-label="Status bar"]',
  '[role="dialog"]',
  '[role="menu"]',
  '[data-layer-id]',
  '[aria-label="Add Layer"]',
  '[data-testid="effects-drawer"]',
];

async function openAgentPage(page: Page): Promise<void> {
  await page.goto('/agent/');
  await waitForLopsy(page);
}

async function expectNoEditorUi(page: Page): Promise<void> {
  for (const selector of EDITOR_UI) {
    await expect(page.locator(selector), selector).toHaveCount(0);
  }
}

test.describe('agent page', () => {
  test('announces itself to agents in <body> and is not indexed', async ({ page }) => {
    await openAgentPage(page);
    const firstBodyComment = await page.evaluate(() => {
      const node = Array.from(document.body.childNodes).find((n) => n.nodeType !== Node.TEXT_NODE);
      return node?.nodeType === Node.COMMENT_NODE ? node.textContent ?? '' : '';
    });
    expect(firstBodyComment).toContain('window.lopsy');
    expect(firstBodyComment).toContain('/SKILL.md');
    expect(firstBodyComment).toContain('/llms.txt');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
  });

  test('/agent redirects to /agent/', async ({ page }) => {
    const response = await page.goto('/agent?renderer=webgl');
    expect(new URL(page.url()).pathname).toBe('/agent/');
    expect(new URL(page.url()).search).toBe('?renderer=webgl');
    expect(response?.ok()).toBe(true);
  });

  test('shows no editor UI before or after a document exists, and then the canvas fills the window', async ({ page }) => {
    await openAgentPage(page);
    await expect(page.getByText('This is Lopsy’s agent page. It has no controls')).toBeVisible();
    await expect(page.getByRole('link', { name: '/SKILL.md' })).toHaveAttribute('href', '/SKILL.md');
    await expect(page.locator('[data-testid="canvas-container"]')).toHaveCount(0);
    await expectNoEditorUi(page);
    await page.screenshot({ path: 'e2e/screenshots/agent-page-before-document.png' });

    // Larger than the window, so fitting it has to zoom out.
    await lopsyResult(page, { op: 'doc.new', width: 2000, height: 1000 });
    const container = page.locator('[data-testid="canvas-container"]');
    await expect(container).toBeVisible();
    await expect(page.getByText('This is Lopsy’s agent page')).toHaveCount(0);
    await expect(container.locator('canvas[aria-label="Drawing canvas"]')).toBeVisible();
    await expectNoEditorUi(page);

    const viewport = page.viewportSize()!;
    expect(await container.boundingBox()).toEqual({ x: 0, y: 0, width: viewport.width, height: viewport.height });
    // Fitted to the window, as the editor fits a new document: 40 px of padding, centred.
    const view = await page.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => { viewport: { zoom: number; panX: number; panY: number; width: number; height: number } } }>).__editorStore!;
      return store.getState().viewport;
    });
    expect({ width: view.width, height: view.height }).toEqual(viewport);
    expect(view.zoom).toBeCloseTo(Math.min((viewport.width - 80) / 2000, (viewport.height - 80) / 1000), 6);
    expect({ panX: view.panX, panY: view.panY }).toEqual({ panX: 0, panY: 0 });
  });

  test('describe() is exactly the registry\'s document commands', async ({ page }) => {
    await openAgentPage(page);
    const { agent, registry, ui } = await page.evaluate(() => {
      const w = window as unknown as AgentWindow;
      return {
        agent: w.lopsy!.describe(),
        registry: w.__lopsyCommands!.describe('document'),
        ui: w.__lopsyCommands!.describe('ui').map((d) => d.id),
      };
    });
    expectDocumentCommandsOnly(agent);
    expect(agent).toEqual(registry);
    expect(ui.length).toBeGreaterThan(0);
    expect(agent.map((d) => d.id)).not.toContain(ui[0]);
  });

  test('a ui command is answered as an unknown command, with document suggestions only', async ({ page }) => {
    await openAgentPage(page);
    await lopsyResult(page, { op: 'doc.new', width: 200, height: 150 });
    const uiIds = await page.evaluate(() => (window as unknown as AgentWindow).__lopsyCommands!.describe('ui').map((d) => d.id));
    for (const op of ['ui.layer-properties', uiIds[0]!]) {
      const outcome = await lopsy(page, { op });
      expect(outcome.ok, op).toBe(false);
      if (outcome.ok) continue;
      expect(outcome.error.code).toBe('not-found');
      expect(outcome.error.message).toContain(`Unknown command ${JSON.stringify(op)}`);
      expect(outcome.error.message).not.toMatch(/Did you mean:[^?]*\bui\./);
    }
    // Nothing ran: no dialog opened and the history is the new document alone.
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
    const info = await lopsyResult<{ history: { undo: string[] } }>(page, { op: 'doc.info' });
    expect(info.history.undo).toEqual(['New Document']);
  });

  test('run() resolves to an outcome for every refusal and for a batch', async ({ page }) => {
    await openAgentPage(page);

    expect(await lopsy(page, { op: 'doc.info' })).toMatchObject({
      ok: false,
      error: { name: 'CommandError', code: 'unavailable', message: expect.stringMatching(/No document is open/) },
    });
    expect(await lopsy(page, { op: 'doc.new', width: 0, height: 10 })).toMatchObject({ ok: false, error: { code: 'invalid' } });
    expect(await lopsy(page, { op: 'doc.nwe' })).toMatchObject({
      ok: false,
      error: { code: 'not-found', message: expect.stringContaining('Did you mean: doc.new') },
    });

    const single = await lopsy(page, { op: 'doc.new', width: 200, height: 150 });
    expect(single).toMatchObject({ ok: true, result: { width: 200, height: 150 } });

    const batch = await lopsy(page, [{ op: 'layer.add' }, { op: 'color.set', foreground: '#ff0000' }]);
    expect(batch).toMatchObject({ ok: true, results: [{ id: expect.any(String) }, { foreground: '#ff0000' }] });

    const failed = await lopsy(page, [{ op: 'layer.add' }, { op: 'layer.select', layer: 'No such layer' }, { op: 'layer.add' }]);
    expect(failed).toMatchObject({
      ok: false,
      error: { code: 'not-found', index: 1, completed: [{ id: expect.any(String) }], message: expect.stringMatching(/^\[1\] layer\.select: /) },
    });
    // The step after the failure did not run.
    const info = await lopsyResult<{ layers: Array<{ name: string; type: string }> }>(page, { op: 'doc.info' });
    expect(info.layers.filter((l) => l.type !== 'group').map((l) => l.name)).toEqual(['Background', 'Layer 1', 'Layer 2', 'Layer 3']);
  });

  test('keyboard shortcuts do nothing', async ({ page }) => {
    await openAgentPage(page);
    await lopsy(page, [
      { op: 'doc.new', width: 200, height: 150 },
      { op: 'layer.add' },
      { op: 'tool.select', tool: 'marquee-rect' },
    ]);
    await page.locator('[data-testid="canvas-container"]').hover();
    await page.keyboard.press('b');
    await page.keyboard.press('ControlOrMeta+z');
    await page.waitForTimeout(300);
    const info = await lopsyResult<{ activeTool: string; history: { undo: string[] }; layers: unknown[] }>(page, { op: 'doc.info' });
    expect(info.activeTool).toBe('marquee-rect');
    expect(info.history.undo).toEqual(['New Document', 'Add Layer']);
    // Background, Layer 1, the added layer and the root group.
    expect(info.layers).toHaveLength(4);
  });

  test('a new document leaves the active tool as it was', async ({ page }) => {
    await openAgentPage(page);
    await lopsy(page, { op: 'doc.new', width: 200, height: 150 });
    const first = await lopsyResult<{ activeTool: string }>(page, { op: 'doc.info' });
    expect(first.activeTool).toBe('move');
    const stroked = await lopsy(page, [
      { op: 'paint.stroke', points: [{ x: 20, y: 20 }, { x: 120, y: 90 }] },
      { op: 'doc.new', width: 200, height: 150 },
    ]);
    expect(stroked.ok, JSON.stringify(stroked)).toBe(true);
    const second = await lopsyResult<{ activeTool: string }>(page, { op: 'doc.info' });
    expect(second.activeTool).toBe('brush');
  });

  test('without WebGL2, every run is answered unavailable at once and describe() still works', async ({ page }) => {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof original>) {
        return args[0] === 'webgl2' ? null : original.apply(this, args);
      } as typeof original;
    });
    await openAgentPage(page);
    await expect(page.getByRole('heading', { name: 'WebGL 2 is not available' })).toBeVisible();

    const started = Date.now();
    const made = await lopsy(page, { op: 'doc.new', width: 100, height: 100 });
    expect(made).toMatchObject({
      ok: false,
      error: { name: 'CommandError', code: 'unavailable', message: expect.stringContaining('no WebGL2') },
    });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(await lopsy(page, [{ op: 'color.set', foreground: '#ff0000' }])).toMatchObject({
      ok: false,
      error: { code: 'unavailable', index: 0, completed: [] },
    });
    // Nothing ran: no document was created.
    expect(await page.locator('canvas[aria-label="Drawing canvas"]').count()).toBe(0);
    const ids = await page.evaluate(() => (window as unknown as AgentWindow).lopsy!.describe().map((c) => c.id));
    expect(ids).toContain('doc.new');
  });
});

/** One image made of most kinds of command: layers, a filled selection, a gradient, a stroke, a filter, an effect, text and an adjustment. */
const RECIPE: readonly Invocation[] = [
  { op: 'doc.new', width: 240, height: 160 },
  { op: 'color.set', foreground: '#d03020' },
  { op: 'select.rect', x: 20, y: 20, width: 100, height: 70 },
  { op: 'paint.fill' },
  { op: 'select.none' },
  { op: 'layer.add' },
  { op: 'color.set', foreground: '#2050c0', background: '#f0d040' },
  { op: 'select.ellipse', x: 110, y: 40, width: 110, height: 100 },
  { op: 'paint.gradient', from: { x: 110, y: 40 }, to: { x: 220, y: 140 } },
  { op: 'select.none' },
  { op: 'tool.set', tool: 'brush', options: { size: 12, hardness: 80 } },
  { op: 'color.set', foreground: '#108040' },
  { op: 'paint.stroke', points: [{ x: 30, y: 130 }, { x: 80, y: 100 }, { x: 140, y: 120 }, { x: 200, y: 30 }] },
  { op: 'filter.gaussian-blur', radius: 2 },
  { op: 'layer.effects', dropShadow: { enabled: true, offsetX: 4, offsetY: 5, blur: 6 } },
  { op: 'text.set-font', family: 'Montserrat', weight: 700 },
  { op: 'color.set', foreground: '#ffffff' },
  { op: 'text.add', x: 30, y: 40, text: 'Agent' },
  // The document's root group has a Hue/Saturation node from the start.
  { op: 'adjust.set', node: 'hue-saturation', params: { hue: 30, saturation: -20 } },
];

interface Made {
  png: string;
  info: unknown;
}

/** doc.info with each layer id replaced by the layer's position, so two documents compare. */
function withoutIds(info: { layers: Array<{ id: string }> } & Record<string, unknown>): unknown {
  const position = new Map(info.layers.map((layer, index) => [layer.id, `#${index}`]));
  return JSON.parse(JSON.stringify(info), (_key, value: unknown) =>
    typeof value === 'string' && position.has(value) ? position.get(value) : value,
  );
}

async function makeOnEditor(page: Page): Promise<Made> {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as unknown as AgentWindow).__lopsyCommands);
  return page.evaluate(async (recipe) => {
    const api = (window as unknown as AgentWindow).__lopsyCommands!;
    await api.run(recipe);
    const exported = (await api.run({ op: 'doc.export', format: 'png' })) as { base64: string };
    return { png: exported.base64, info: await api.run({ op: 'doc.info' }) };
  }, RECIPE as unknown as Invocation[]);
}

async function makeOnAgentPage(page: Page): Promise<Made> {
  await openAgentPage(page);
  const made = await lopsy(page, RECIPE);
  if (!made.ok) throw new Error(`the recipe failed on the agent page: ${made.error.message}`);
  await page.screenshot({ path: 'e2e/screenshots/agent-page-recipe.png' });
  const exported = await lopsyResult<{ base64: string }>(page, { op: 'doc.export', format: 'png' });
  return { png: exported.base64, info: await lopsyResult(page, { op: 'doc.info' }) };
}

test.describe('the same recipe on both pages', () => {
  // serveFontsOffline answers the font CDN's TTF URL with a 404, so the app falls back to the WOFF2 fixture.
  test.use({ allowConsoleErrors: [/Failed to load resource/] });

  test('a recipe run through window.lopsy makes the same image as on the editor', async ({ page }) => {
    test.setTimeout(120_000);
    await serveFontsOffline(page);
    const editor = await makeOnEditor(page);
    const agent = await makeOnAgentPage(page);

    const info = withoutIds(agent.info as { layers: Array<{ id: string }> });
    expect(info).toEqual(withoutIds(editor.info as { layers: Array<{ id: string }> }));
    expect(info).toMatchObject({
      history: {
        undo: [
          'New Document', 'Fill', 'Add Layer', 'Linear Gradient', 'Brush', 'Gaussian Blur',
          'Enable Drop Shadow', 'Edit Drop Shadow', 'Edit Drop Shadow', 'Add Text Layer', 'Text',
          'Edit Hue / Saturation', 'Edit Hue / Saturation',
        ],
      },
    });
    expect(agent.png.length).toBeGreaterThan(1000);
    expect(agent.png === editor.png, 'the two PNGs differ').toBe(true);

    // The image is the recipe's: decode it and probe it on the agent page.
    const probes = await page.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      const at = (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data);
      return { size: [bitmap.width, bitmap.height], corner: at(2, 2), fill: at(100, 80), gradient: at(190, 120) };
    }, agent.png);
    expect(probes.size).toEqual([240, 160]);
    // The white background, under a hue shift that leaves white white.
    expect(probes.corner).toEqual([255, 255, 255, 255]);
    // The red fill and the gradient are coloured (not white, not the background).
    expect(probes.fill).not.toEqual([255, 255, 255, 255]);
    expect(probes.gradient).not.toEqual([255, 255, 255, 255]);
    expect(probes.fill).not.toEqual(probes.gradient);
  });

});
