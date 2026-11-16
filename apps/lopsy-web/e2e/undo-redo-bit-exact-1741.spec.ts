import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  addLayer,
  setActiveLayer,
  setForegroundColor,
  docToScreen,
  getEditorState,
  undo,
  redo,
} from './helpers';

// #1741 — Undo → Redo must give back every layer byte for byte. Snapshots
// were taken and restored by drawing the texture through a filtered blit;
// on a large texture the interpolated UV lands a hair off the texel centre,
// the sample mixes in a sliver of the neighbour, and antialiased edges came
// back a step off (49 → 50) — on the edited layer and on untouched ones,
// further off with every trip.

const DOC_W = 1500;
const DOC_H = 2100;

async function dragOnDoc(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  const a = await docToScreen(page, x0, y0);
  const b = await docToScreen(page, x1, y1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

async function editFill(page: Page): Promise<void> {
  await page.locator('nav[aria-label="Application menu"]').getByRole('button', { name: 'Edit', exact: true }).click();
  await page.locator('[role="menu"][aria-label="Edit"]').getByRole('menuitem', { name: /^Fill$/ }).first().click();
  await page.waitForTimeout(200);
}

async function fillEllipse(
  page: Page,
  box: [number, number, number, number],
  color: [number, number, number],
): Promise<void> {
  await setForegroundColor(page, ...color);
  await page.locator('[data-tool-id="marquee-ellipse"]').click();
  await dragOnDoc(page, ...box);
  await editFill(page);
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(100);
}

/** Read `ids` into `window.__bitExact[key]`, kept in the page (each is ~12 MB). */
async function capture(page: Page, key: string, ids: string[]): Promise<void> {
  await page.evaluate(async ({ key, ids }) => {
    const w = window as unknown as Record<string, unknown>;
    const read = w.__readLayerPixels as (id: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
    const store = (w.__bitExact ??= {}) as Record<string, Record<string, { width: number; height: number; pixels: Uint8Array }>>;
    const entry: Record<string, { width: number; height: number; pixels: Uint8Array }> = {};
    for (const id of ids) {
      const px = await read(id);
      entry[id] = { width: px?.width ?? 0, height: px?.height ?? 0, pixels: Uint8Array.from(px?.pixels ?? []) };
    }
    store[key] = entry;
  }, { key, ids });
}

interface Diff {
  id: string;
  size: string;
  differing: number;
  painted: number;
  first: string | null;
}

/** Per layer: how many bytes of `a` and `b` differ, and how many bytes are non-zero. */
async function compare(page: Page, a: string, b: string): Promise<Diff[]> {
  return page.evaluate(({ a, b }) => {
    const store = (window as unknown as Record<string, unknown>).__bitExact as
      Record<string, Record<string, { width: number; height: number; pixels: Uint8Array }>>;
    const left = store[a]!;
    const right = store[b]!;
    return Object.keys(left).map((id) => {
      const l = left[id]!;
      const r = right[id]!;
      const size = `${l.width}x${l.height} vs ${r.width}x${r.height}`;
      let differing = 0;
      let painted = 0;
      let first: string | null = null;
      const n = Math.max(l.pixels.length, r.pixels.length);
      for (let i = 0; i < n; i++) {
        if ((r.pixels[i] ?? 0) !== 0) painted++;
        if (l.pixels[i] !== r.pixels[i]) {
          if (first === null) {
            const p = i >> 2;
            first = `(${p % l.width},${Math.floor(p / l.width)}) ch${i & 3}: ${l.pixels[i]} vs ${r.pixels[i]}`;
          }
          differing++;
        }
      }
      return { id, size, differing, painted, first };
    });
  }, { a, b });
}

/** Number of pixels in a layer whose alpha is strictly between 0 and 255. */
async function antialiasedPixels(page: Page, key: string, id: string): Promise<number> {
  return page.evaluate(({ key, id }) => {
    const store = (window as unknown as Record<string, unknown>).__bitExact as
      Record<string, Record<string, { pixels: Uint8Array }>>;
    const px = store[key]![id]!.pixels;
    let n = 0;
    for (let i = 3; i < px.length; i += 4) if (px[i]! > 0 && px[i]! < 255) n++;
    return n;
  }, { key, id });
}

test.describe('#1741: undo/redo restores layers bit for bit', () => {
  test.setTimeout(240_000);

  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'menus require the desktop layout');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, DOC_W, DOC_H, false);
  });

  test('every layer reads back identically across several undo/redo trips on a 1500×2100 doc', async ({ page }) => {
    // An untouched layer with antialiased content of its own.
    const untouched = await addLayer(page);
    await fillEllipse(page, [150, 150, 650, 900], [0x3a, 0x7b, 0xd5]);

    const edited = await addLayer(page);
    await setActiveLayer(page, edited);
    await fillEllipse(page, [300, 420, 1200, 1680], [0x14, 0xd3, 0xc4]);
    const ids = [untouched, edited];
    await capture(page, 'before', ids);

    await fillEllipse(page, [525, 735, 975, 1365], [0xff, 0x2e, 0x93]);
    const undoDepth = (await getEditorState(page)).undoStackLength;
    await capture(page, 'after', ids);

    // The content has the soft edges the bug shows up on.
    expect(await antialiasedPixels(page, 'after', edited)).toBeGreaterThan(1000);
    expect(await antialiasedPixels(page, 'after', untouched)).toBeGreaterThan(500);
    const changed = await compare(page, 'before', 'after');
    expect(changed.find((d) => d.id === edited)!.differing).toBeGreaterThan(0);

    for (let trip = 1; trip <= 4; trip++) {
      await undo(page);
      await page.waitForTimeout(150);
      expect((await getEditorState(page)).undoStackLength).toBe(undoDepth - 1);
      await capture(page, 'undone', ids);
      for (const d of await compare(page, 'before', 'undone')) {
        expect(d.differing, `undo #${trip}, layer ${d.id} (${d.size}), first ${d.first}`).toBe(0);
      }

      await redo(page);
      await page.waitForTimeout(150);
      expect((await getEditorState(page)).undoStackLength).toBe(undoDepth);
      await capture(page, 'redone', ids);
      for (const d of await compare(page, 'after', 'redone')) {
        expect(d.differing, `redo #${trip}, layer ${d.id} (${d.size}), first ${d.first}`).toBe(0);
        expect(d.painted).toBeGreaterThan(0);
      }
    }
  });
});
