/**
 * Commands that take a `layer` and act on a layer that is not active
 * (src/commands/context.ts, `actOnLayer`). In the editor a person clicks a
 * row, and the render loop runs a frame before they can press a button: it
 * expands the layer switched to (cropped to its content while it was
 * inactive) and syncs it to the engine. Each case runs the command with
 * `layer` naming the inactive "Target" in one document, and `layer.select`
 * then the command in an identical second one, and requires the same
 * document, layer bounds and exported PNG.
 */
import { test, expect, run, snapshot, type Invocation, type Page } from './harness';

interface Fixture {
  /** Target is a text layer instead of a painted raster layer. */
  readonly text?: boolean;
  /** Target gets a mask that hides part of its block. */
  readonly mask?: boolean;
  /** Target gets an enabled drop shadow. */
  readonly effect?: boolean;
}

interface Case {
  readonly op: string;
  readonly params?: Record<string, unknown>;
  readonly fixture?: Fixture;
  /**
   * The command leaves the active layer as it was. The reference then
   * selects Target, runs the command and selects Other again.
   */
  readonly keepsActive?: boolean;
  /** How the command names Target; { layer: 'Target' } when omitted. */
  readonly target?: Record<string, unknown>;
  /** `layer` is required, so the reference passes it too. */
  readonly layerRequired?: boolean;
  /** Commands run after it on both sides. */
  readonly then?: readonly Invocation[];
  /** Compare the command's result too, as this reads it (for read-only commands). */
  readonly readResult?: (page: Page, result: unknown) => Promise<unknown>;
}

interface LayerRender {
  base64: string;
  x: number;
  y: number;
}

/**
 * A view.render-layer result placed in the document: a hash of its PNG drawn
 * at (x, y) on a document-sized canvas. The texture's own size is not
 * compared: an inactive layer's texture is cropped to its content, and the
 * reference made it active (expanded) for the read.
 */
async function placedLayerRender(page: Page, result: unknown): Promise<unknown> {
  const { base64, x, y } = result as LayerRender;
  return page.evaluate(async ({ base64, x, y }) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(300, 200);
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, x, y);
    const data = context.getImageData(0, 0, 300, 200).data;
    let h = 0x811c9dc5;
    for (let i = 0; i < data.length; i++) {
      h ^= data[i]!;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16);
  }, { base64, x, y });
}

const CASES: readonly Case[] = [
  { op: 'layer.duplicate' },
  { op: 'layer.merge-down' },
  { op: 'layer.rasterize', fixture: { text: true } },
  { op: 'layer.rasterize-style', fixture: { effect: true } },
  { op: 'layer.rasterize-style', fixture: { effect: true, mask: true } },
  { op: 'layer.effects', params: { stroke: { enabled: true, width: 4 } }, keepsActive: true, fixture: { effect: true } },
  { op: 'layer.set', params: { opacity: 40 }, keepsActive: true },
  { op: 'layer.remove', keepsActive: true },
  { op: 'layer.move', params: { dx: -40, dy: 12 }, fixture: { mask: true } },
  { op: 'layer.nudge', params: { dx: 5, dy: -3 }, fixture: { mask: true } },
  { op: 'layer.transform', params: { rotate: 90 } },
  { op: 'layer.reorder', params: { target: 'Other', position: 'above' }, keepsActive: true, layerRequired: true },
  { op: 'mask.add' },
  { op: 'mask.remove', fixture: { mask: true }, keepsActive: true },
  {
    op: 'mask.edit',
    params: { enabled: true },
    fixture: { mask: true },
    then: [
      { op: 'tool.set', tool: 'brush', options: { size: 12, hardness: 100 } },
      { op: 'paint.stroke', points: [{ x: 190, y: 140 }, { x: 260, y: 150 }] },
    ],
  },
  { op: 'mask.clear', fixture: { mask: true } },
  { op: 'mask.set-enabled', params: { enabled: false }, fixture: { mask: true }, keepsActive: true },
  { op: 'mask.to-selection', fixture: { mask: true }, keepsActive: true },
  { op: 'select.from-layer', keepsActive: true },
  { op: 'image.flip-layer', params: { axis: 'horizontal' }, fixture: { mask: true } },
  { op: 'text.edit', params: { text: 'Bye' }, fixture: { text: true } },
  { op: 'text.style', params: { options: { fontSize: 40 } }, fixture: { text: true } },
  { op: 'view.render-layer', keepsActive: true, readResult: placedLayerRender },
  { op: 'layer.group', target: { layers: ['Target'] }, fixture: { mask: true } },
];

interface LayerBounds {
  name: string;
  x: number;
  y: number;
  width: number | null;
  height: number | null;
}

async function layerBounds(page: Page): Promise<LayerBounds[]> {
  return page.evaluate(() => {
    type L = { id: string; name: string; x: number; y: number; width?: number; height?: number };
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: L[]; layerOrder: string[] } };
    };
    const { layers, layerOrder } = store.getState().document;
    return layerOrder
      .map((id) => layers.find((l) => l.id === id))
      .filter((l): l is L => l !== undefined)
      .map((l) => ({ name: l.name, x: l.x, y: l.y, width: l.width ?? null, height: l.height ?? null }));
  });
}

async function freshPage(page: Page): Promise<void> {
  await page.goto(page.url());
  await page.waitForFunction(() => !!(window as unknown as { __lopsyCommands?: unknown }).__lopsyCommands);
}

function targetSteps(fixture: Fixture): Invocation[] {
  if (fixture.text) {
    return [
      { op: 'tool.set', tool: 'text', options: { fontSize: 32, align: 'left' } },
      { op: 'text.add', x: 190, y: 120, text: 'Hello' },
      { op: 'layer.set', name: 'Target' },
    ];
  }
  return [
    { op: 'layer.set', name: 'Target' },
    { op: 'color.set', foreground: '#cc2222' },
    { op: 'select.rect', x: 180, y: 120, width: 70, height: 50 },
    { op: 'paint.fill' },
    { op: 'select.none' },
  ];
}

function decorationSteps(fixture: Fixture): Invocation[] {
  const steps: Invocation[] = [];
  if (fixture.mask) {
    steps.push(
      { op: 'select.rect', x: 190, y: 110, width: 40, height: 70 },
      { op: 'mask.add' },
      { op: 'mask.edit', enabled: false },
    );
  }
  if (fixture.effect) {
    steps.push({ op: 'layer.effects', dropShadow: { enabled: true, color: '#000000', offsetX: 8, offsetY: 6, blur: 4, opacity: 80 } });
  }
  return steps;
}

/** Background, then Target (painted well away from the origin), then Other, which is active, with Target left to crop. */
async function build(page: Page, fixture: Fixture): Promise<void> {
  await freshPage(page);
  await run(page, [
    { op: 'doc.new', width: 300, height: 200 },
    ...targetSteps(fixture),
    ...decorationSteps(fixture),
    { op: 'layer.add', name: 'Other' },
    { op: 'color.set', foreground: '#2244cc' },
    { op: 'select.rect', x: 20, y: 20, width: 40, height: 40 },
    { op: 'paint.fill' },
    { op: 'select.none' },
    { op: 'doc.info' },
  ]);
}

async function targetIsCropped(page: Page): Promise<boolean> {
  const target = (await layerBounds(page)).find((l) => l.name === 'Target');
  return !!target && target.width !== null && target.width < 300;
}

function invocation(c: Case, withLayer: boolean): Invocation {
  return { op: c.op, ...(withLayer ? (c.target ?? { layer: 'Target' }) : {}), ...c.params };
}

function referenceSteps(c: Case): Invocation[] {
  const steps: Invocation[] = [{ op: 'layer.select', layer: 'Target' }, invocation(c, !!c.layerRequired || !!c.keepsActive)];
  if (c.keepsActive) steps.push({ op: 'layer.select', layer: 'Other' });
  return steps;
}

interface Outcome {
  result: unknown;
  document: Awaited<ReturnType<typeof snapshot>>;
  bounds: LayerBounds[];
  png: string;
}

/** `steps` are the command (at `commandIndex`) with whatever the side runs around it. */
async function outcome(page: Page, c: Case, steps: readonly Invocation[], commandIndex: number): Promise<Outcome> {
  const fixture = c.fixture ?? {};
  await build(page, fixture);
  if (!fixture.text) expect(await targetIsCropped(page), 'Target is cropped to its content before the command').toBe(true);
  const results = await run<unknown[]>(page, steps);
  if (c.then) await run(page, c.then);
  const exported = await run<{ base64: string }>(page, { op: 'doc.export', format: 'png' });
  const result = c.readResult ? await c.readResult(page, results[commandIndex]) : null;
  return { result, document: await snapshot(page), bounds: await layerBounds(page), png: exported.base64 };
}

for (const c of CASES) {
  const fixture = Object.keys(c.fixture ?? {}).join('+') || 'raster';
  test(`${c.op} on an inactive ${fixture} layer acts as layer.select then ${c.op}`, async ({ page }) => {
    test.setTimeout(90_000);
    const named = await outcome(page, c, [invocation(c, true)], 0);
    const reference = await outcome(page, c, referenceSteps(c), 1);
    expect(named.bounds, 'layer bounds').toEqual(reference.bounds);
    expect(named.document, 'document').toEqual(reference.document);
    expect(named.result, 'result').toEqual(reference.result);
    expect(named.png === reference.png, 'exported PNG bytes are equal').toBe(true);
  });
}
