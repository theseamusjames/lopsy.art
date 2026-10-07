import { test, expect, type Page } from './fixtures';
import { waitForStore, createDocument, selectTool, setToolOption, drawRect, docToScreen } from './helpers';

/**
 * #1219 — Clone Stamp, Healing Brush, Smudge, Dodge / Burn and Sponge dabs
 * are scissored to each dab's bounding box instead of running full-layer
 * passes (two per dab for the read-modify-write tools, one coverage quad
 * per dab plus a full-layer bake for the coverage tools).
 *
 * Every draw the engine issues while a pointer-move (the dabs) or the
 * pointer-up (the Dodge / Sponge bake) is being handled is recorded with
 * the number of pixels it can touch: its scissor rect when the scissor
 * test is on, its whole viewport otherwise. Unscissored, each dab costs
 * the layer's 800 × 600 = 480 000 pixels; scissored, at most the dab's
 * box. The scissor test must also be off again once the event is handled,
 * or it would clip the next frame.
 *
 * A scissor rect that is too small would leave a ring of the dab
 * unpainted, and a copy-back that strays outside it would leak stale
 * scratch texels into the layer — so each test also checks the painted
 * pixels: the expected change inside the stroke, and the layer exactly as
 * it was everywhere farther than the brush radius from the stroke.
 */

const DOC_W = 800;
const DOC_H = 600;
const SIZE = 40;
/** `dab_rect` box of a SIZE dab: centre ± (SIZE / 2 + 2), +1 for a fractional centre. */
const MAX_DAB_AREA = (2 * (SIZE / 2 + 2) + 1) ** 2;
const LAYER_AREA = DOC_W * DOC_H;

interface Recorded {
  move: number[];
  up: number[];
  scissorLeftOn: number;
}

async function installDrawRecorder(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const rec = {
      scissorOn: false,
      scissor: [0, 0, 0, 0],
      viewport: [0, 0, 0, 0],
      phase: null as 'move' | 'up' | null,
      move: [] as number[],
      up: [] as number[],
      scissorLeftOn: 0,
    };
    (window as unknown as { __glRec: typeof rec }).__glRec = rec;
    const proto = WebGL2RenderingContext.prototype;
    const SCISSOR_TEST = 0x0c11;
    const origEnable = proto.enable;
    proto.enable = function patched(this: WebGL2RenderingContext, cap: number) {
      if (cap === SCISSOR_TEST) rec.scissorOn = true;
      return origEnable.call(this, cap);
    };
    const origDisable = proto.disable;
    proto.disable = function patched(this: WebGL2RenderingContext, cap: number) {
      if (cap === SCISSOR_TEST) rec.scissorOn = false;
      return origDisable.call(this, cap);
    };
    const origScissor = proto.scissor;
    proto.scissor = function patched(this: WebGL2RenderingContext, x: number, y: number, w: number, h: number) {
      rec.scissor = [x, y, w, h];
      return origScissor.call(this, x, y, w, h);
    };
    const origViewport = proto.viewport;
    proto.viewport = function patched(this: WebGL2RenderingContext, x: number, y: number, w: number, h: number) {
      rec.viewport = [x, y, w, h];
      return origViewport.call(this, x, y, w, h);
    };
    const origDraw = proto.drawArrays;
    proto.drawArrays = function patched(this: WebGL2RenderingContext, mode: number, first: number, count: number) {
      if (rec.phase) {
        const [vx, vy, vw, vh] = rec.viewport as [number, number, number, number];
        let area = vw * vh;
        if (rec.scissorOn) {
          const [sx, sy, sw, sh] = rec.scissor as [number, number, number, number];
          const w = Math.max(0, Math.min(sx + sw, vx + vw) - Math.max(sx, vx));
          const h = Math.max(0, Math.min(sy + sh, vy + vh) - Math.max(sy, vy));
          area = w * h;
        }
        rec[rec.phase].push(area);
      }
      return origDraw.call(this, mode, first, count);
    };
    // Capture listeners on window run before the app's window-level
    // pointer handlers; `closeDrawBrackets` adds the closing ones.
    window.addEventListener('pointermove', () => { rec.phase = 'move'; }, { capture: true });
    window.addEventListener('pointerup', () => { rec.phase = 'up'; }, { capture: true });
  });
}

/** Registered after the app's handlers, so these run after them. */
async function closeDrawBrackets(page: Page): Promise<void> {
  await page.evaluate(() => {
    const rec = (window as unknown as { __glRec: { phase: string | null; scissorOn: boolean; scissorLeftOn: number } }).__glRec;
    const close = () => {
      if (rec.scissorOn) rec.scissorLeftOn++;
      rec.phase = null;
    };
    window.addEventListener('pointermove', close);
    window.addEventListener('pointerup', close);
  });
}

async function resetRecorder(page: Page): Promise<void> {
  await page.evaluate(() => {
    const rec = (window as unknown as { __glRec: Recorded }).__glRec;
    rec.move = [];
    rec.up = [];
    rec.scissorLeftOn = 0;
  });
}

async function recorded(page: Page): Promise<Recorded> {
  return page.evaluate(() => {
    const rec = (window as unknown as { __glRec: Recorded }).__glRec;
    return { move: [...rec.move], up: [...rec.up], scissorLeftOn: rec.scissorLeftOn };
  });
}

interface Snapshot { width: number; height: number; pixels: number[] }

async function readActiveLayer(page: Page): Promise<Snapshot> {
  const snap = await page.evaluate(async () => {
    const w = window as unknown as {
      __readLayerPixels: (id?: string) => Promise<Snapshot | null>;
      __editorStore: { getState: () => { document: { activeLayerId: string; layers: Array<{ id: string; x: number; y: number }> } } };
    };
    const { document: doc } = w.__editorStore.getState();
    const layer = doc.layers.find((l) => l.id === doc.activeLayerId)!;
    const px = await w.__readLayerPixels(doc.activeLayerId);
    return px ? { ...px, x: layer.x, y: layer.y } : null;
  });
  expect(snap).not.toBeNull();
  // Coordinates below are document pixels; the layer must cover the document.
  expect([snap!.x, snap!.y, snap!.width, snap!.height]).toEqual([0, 0, DOC_W, DOC_H]);
  return snap!;
}

async function readComposite(page: Page): Promise<Snapshot> {
  const snap = await page.evaluate(() =>
    (window as unknown as { __readCompositedPixels: () => Promise<Snapshot | null> }).__readCompositedPixels());
  expect(snap).not.toBeNull();
  return snap!;
}

function rgbAt(s: Snapshot, x: number, y: number): [number, number, number, number] {
  const i = (y * s.width + x) * 4;
  return [s.pixels[i]!, s.pixels[i + 1]!, s.pixels[i + 2]!, s.pixels[i + 3]!];
}

function distToSegment(x: number, y: number, a: [number, number], b: [number, number]): number {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / len2));
  return Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy));
}

/** Pixels (centres) farther than SIZE / 2 + 2 from the stroke that differ at all. */
function changedOutsideStroke(before: Snapshot, after: Snapshot, a: [number, number], b: [number, number]): number {
  let n = 0;
  for (let y = 0; y < DOC_H; y++) {
    for (let x = 0; x < DOC_W; x++) {
      if (distToSegment(x + 0.5, y + 0.5, a, b) <= SIZE / 2 + 2) continue;
      const i = (y * DOC_W + x) * 4;
      for (let c = 0; c < 4; c++) {
        if (before.pixels[i + c] !== after.pixels[i + c]) { n++; break; }
      }
    }
  }
  return n;
}

async function stroke(page: Page, a: [number, number], b: [number, number], steps = 10): Promise<void> {
  const from = await docToScreen(page, a[0], a[1]);
  const to = await docToScreen(page, b[0], b[1]);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

async function altClick(page: Page, x: number, y: number): Promise<void> {
  const p = await docToScreen(page, x, y);
  await page.mouse.move(p.x, p.y);
  await page.keyboard.down('Alt');
  await page.mouse.down();
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await page.waitForTimeout(100);
}

function expectScissoredDabs(r: Recorded): void {
  expect(r.move.length).toBeGreaterThan(0);
  expect(Math.max(...r.move)).toBeLessThanOrEqual(MAX_DAB_AREA);
  expect(r.scissorLeftOn).toBe(0);
}

test.describe('Retouch tool dabs are scissored to the dab (#1219)', () => {
  test.beforeEach(async ({ page }) => {
    await installDrawRecorder(page);
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, DOC_W, DOC_H, true);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await closeDrawBrackets(page);
  });

  test('Clone Stamp copies the source into the stroke and nothing else', async ({ page }) => {
    await drawRect(page, 0, 0, DOC_W / 2, DOC_H, { r: 220, g: 30, b: 30 });
    await drawRect(page, DOC_W / 2, 0, DOC_W / 2, DOC_H, { r: 30, g: 30, b: 220 });
    await selectTool(page, 'stamp');
    await setToolOption(page, 'Size', SIZE);
    await altClick(page, 200, 300);
    const before = await readActiveLayer(page);

    await resetRecorder(page);
    const a: [number, number] = [500, 250];
    const b: [number, number] = [650, 250];
    await stroke(page, a, b);
    const after = await readActiveLayer(page);
    await page.screenshot({ path: 'e2e/screenshots/retouch-scissor-clone-stamp.png' });

    expectScissoredDabs(await recorded(page));
    // The stroke on the blue half now shows the red source…
    const [r, , bl] = rgbAt(after, 575, 250);
    expect(r).toBeGreaterThan(200);
    expect(bl).toBeLessThan(50);
    // …out to the dab's rim (85 % of the radius), which a clipped dab would miss.
    const [rimR, , rimB] = rgbAt(after, 575, 250 + Math.round(SIZE / 2 * 0.85));
    expect(rimR).toBeGreaterThan(150);
    expect(rimB).toBeLessThan(100);
    expect(changedOutsideStroke(before, after, a, b)).toBe(0);
  });

  test('Healing Brush heals the stroke and nothing else', async ({ page }) => {
    await drawRect(page, 0, 0, DOC_W / 2, DOC_H, { r: 128, g: 128, b: 128 });
    await drawRect(page, DOC_W / 2, 0, DOC_W / 2, DOC_H, { r: 30, g: 30, b: 220 });
    await selectTool(page, 'healing');
    await setToolOption(page, 'Size', SIZE);
    await altClick(page, 200, 250);
    const before = await readActiveLayer(page);

    await resetRecorder(page);
    const a: [number, number] = [550, 250];
    const b: [number, number] = [650, 250];
    await stroke(page, a, b);
    const after = await readActiveLayer(page);
    await page.screenshot({ path: 'e2e/screenshots/retouch-scissor-healing.png' });

    const r = await recorded(page);
    expectScissoredDabs(r);
    // Healing a flat source onto a flat destination keeps the destination:
    // source − source mean + destination mean.
    const [hr, hg, hb] = rgbAt(after, 600, 250);
    expect(Math.abs(hr - 30)).toBeLessThanOrEqual(4);
    expect(Math.abs(hg - 30)).toBeLessThanOrEqual(4);
    expect(Math.abs(hb - 220)).toBeLessThanOrEqual(4);
    expect(changedOutsideStroke(before, after, a, b)).toBe(0);
  });

  test('Smudge drags colour along the stroke and nothing else', async ({ page }) => {
    await drawRect(page, 0, 0, DOC_W, DOC_H, { r: 255, g: 255, b: 255 });
    await drawRect(page, 300, 200, 200, 200, { r: 220, g: 30, b: 30 });
    await selectTool(page, 'smudge');
    await setToolOption(page, 'Size', SIZE);
    await setToolOption(page, 'Strength', 80);
    const before = await readActiveLayer(page);

    await resetRecorder(page);
    const a: [number, number] = [470, 300];
    const b: [number, number] = [580, 300];
    await stroke(page, a, b, 12);
    const after = await readActiveLayer(page);
    await page.screenshot({ path: 'e2e/screenshots/retouch-scissor-smudge.png' });

    expectScissoredDabs(await recorded(page));
    // Red is pulled out over the white just past the edge.
    const [, g] = rgbAt(after, 515, 300);
    expect(g).toBeLessThan(200);
    expect(changedOutsideStroke(before, after, a, b)).toBe(0);
  });

  test('Dodge brightens the stroke; preview and bake match and stay inside it', async ({ page }) => {
    await drawRect(page, 0, 0, DOC_W, DOC_H, { r: 100, g: 100, b: 100 });
    await selectTool(page, 'dodge');
    await setToolOption(page, 'Size', SIZE);
    await setToolOption(page, 'Exposure', 80);
    const before = await readActiveLayer(page);

    await resetRecorder(page);
    const a: [number, number] = [300, 300];
    const b: [number, number] = [500, 300];
    const from = await docToScreen(page, a[0], a[1]);
    const to = await docToScreen(page, b[0], b[1]);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.waitForTimeout(150);
    // Live frames have drawn the preview dab by dab; this frame adds nothing new.
    const preview = await readComposite(page);
    await page.mouse.up();
    await page.waitForTimeout(150);
    const baked = await readComposite(page);
    const after = await readActiveLayer(page);
    await page.screenshot({ path: 'e2e/screenshots/retouch-scissor-dodge.png' });

    const r = await recorded(page);
    expectScissoredDabs(r);
    // The bake covers only the box around the stroke (~248 × 48 px).
    expect(r.up.length).toBeGreaterThan(0);
    expect(Math.max(...r.up)).toBeLessThan(LAYER_AREA / 20);

    const [cr] = rgbAt(after, 400, 300);
    expect(cr).toBeGreaterThan(130);
    expect(changedOutsideStroke(before, after, a, b)).toBe(0);
    let mismatched = 0;
    for (let i = 0; i < preview.pixels.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        if (Math.abs(preview.pixels[i + c]! - baked.pixels[i + c]!) > 2) { mismatched++; break; }
      }
    }
    expect(mismatched).toBe(0);
  });

  test('Sponge desaturates the stroke and nothing else', async ({ page }) => {
    await drawRect(page, 0, 0, DOC_W, DOC_H, { r: 200, g: 60, b: 60 });
    await page.keyboard.press('y');
    await page.locator('select').filter({ hasText: 'Saturate' }).selectOption('desaturate');
    await setToolOption(page, 'Size', SIZE);
    await setToolOption(page, 'Strength', 100);
    const before = await readActiveLayer(page);

    await resetRecorder(page);
    const a: [number, number] = [300, 300];
    const b: [number, number] = [500, 300];
    await stroke(page, a, b, 12);
    const after = await readActiveLayer(page);
    await page.screenshot({ path: 'e2e/screenshots/retouch-scissor-sponge.png' });

    const r = await recorded(page);
    expectScissoredDabs(r);
    expect(r.up.length).toBeGreaterThan(0);
    expect(Math.max(...r.up)).toBeLessThan(LAYER_AREA / 20);
    const [sr, sg] = rgbAt(after, 400, 300);
    expect(sr - sg).toBeLessThan(140 - 20);
    expect(changedOutsideStroke(before, after, a, b)).toBe(0);
  });
});
