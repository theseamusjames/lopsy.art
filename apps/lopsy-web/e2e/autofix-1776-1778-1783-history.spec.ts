/**
 * #1783 — a Text-tool click that ended with no text (Escape, or an empty
 * Tab commit) recorded "Add Text Layer" + "Delete Layer". That cleared the
 * redo stack, and one undo brought back an invisible, empty "Text 1" layer.
 * The session now leaves no history at all.
 *
 * #1776 — a text layer's automatic name kept a trailing space when its
 * 16-character cut landed right after a word.
 *
 * #1778 — Distort and Perspective drew the rotation handles, which do
 * nothing in those modes, and grabbing one pushed an empty Transform row
 * that cleared redo. Those modes now have no rotation handles.
 */
import { test, expect, type Page } from './fixtures';
import { addLayer, createDocument, docToScreen, setForegroundColor, waitForStore } from './helpers';

interface Stacks { undo: string[]; redo: number; layers: Array<{ type: string; name: string }> }

async function stacks(page: Page): Promise<Stacks> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        undoStack: Array<{ label: string }>;
        redoStack: unknown[];
        document: { layers: Array<{ type: string; name: string }> };
      };
    };
    const s = store.getState();
    return {
      undo: s.undoStack.map((h) => h.label),
      redo: s.redoStack.length,
      layers: s.document.layers.map((l) => ({ type: l.type, name: l.name })),
    };
  });
}

async function drag(page: Page, from: [number, number], to: [number, number], steps = 8): Promise<void> {
  const a = await docToScreen(page, from[0], from[1]);
  const b = await docToScreen(page, to[0], to[1]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

/** A brush stroke, then undo it, so the redo stack holds one step. */
async function strokeThenUndo(page: Page): Promise<void> {
  await page.keyboard.press('b');
  await drag(page, [100, 300], [600, 300], 12);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
}

async function clickText(page: Page, at: [number, number]): Promise<void> {
  await page.keyboard.press('t');
  const p = await docToScreen(page, at[0], at[1]);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(200);
}

test.describe('#1783 — an empty text session leaves no history', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'text editing needs the desktop keyboard');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600, false);
    await page.waitForTimeout(300);
    await addLayer(page);
    await strokeThenUndo(page);
  });

  for (const key of ['Escape', 'Tab'] as const) {
    test(`${key} on an empty new text keeps redo and adds no layer`, async ({ page }) => {
      const before = await stacks(page);
      expect(before.redo).toBe(1);

      await clickText(page, [400, 150]);
      expect((await stacks(page)).layers.some((l) => l.type === 'text')).toBe(true);
      await page.keyboard.press(key);
      await page.waitForTimeout(200);

      const after = await stacks(page);
      expect(after.undo).toEqual(before.undo);
      expect(after.redo).toBe(1);
      expect(after.layers).toEqual(before.layers);

      // Redo brings the brush stroke back.
      await page.keyboard.press('Control+Shift+z');
      await page.waitForTimeout(200);
      const redone = await stacks(page);
      expect(redone.redo).toBe(0);
      expect(redone.undo.length).toBe(before.undo.length + 1);

      // Undo undoes the stroke; no empty text layer comes back.
      await page.keyboard.press('Control+z');
      await page.waitForTimeout(200);
      const undone = await stacks(page);
      expect(undone.layers.some((l) => l.type === 'text')).toBe(false);
      expect(undone.redo).toBe(1);
    });
  }

  test('a committed new text still records Add Text Layer and Text', async ({ page }) => {
    const before = await stacks(page);
    await clickText(page, [400, 150]);
    await page.keyboard.type('Hi');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
    const after = await stacks(page);
    expect(after.undo.slice(before.undo.length)).toEqual(['Add Text Layer', 'Text']);
    expect(after.redo).toBe(0);

    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    expect((await stacks(page)).layers.some((l) => l.type === 'text')).toBe(false);
  });
});

test.describe('#1776 — auto-named text layers have no trailing space', () => {
  test('a cut after a word is trimmed', async ({ page, isMobile }) => {
    test.skip(isMobile, 'text editing needs the desktop keyboard');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600, false);
    await page.waitForTimeout(300);
    await clickText(page, [100, 150]);
    await page.keyboard.type('WALK SLOW. LOOK HARD.');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);

    const labels = await page.evaluate(() =>
      [...document.querySelectorAll('[data-layer-id] button[aria-label^="Layer effects for"]')]
        .map((b) => b.getAttribute('aria-label')));
    expect(labels).toContain('Layer effects for WALK SLOW. LOOK');
    expect(labels).not.toContain('Layer effects for WALK SLOW. LOOK ');
  });
});

/** Opaque handle-coloured (#00aaff or white) overlay pixels in a 7×7 box around a doc point. */
async function handlePixelsNear(page: Page, docX: number, docY: number): Promise<number> {
  const s = await docToScreen(page, docX, docY);
  return page.evaluate(({ x, y }) => {
    const c = Array.from(document.querySelectorAll('canvas')).find((el) => /overlayCanvas/.test(el.className)) as HTMLCanvasElement;
    const r = c.getBoundingClientRect();
    const k = c.width / r.width;
    const d = c.getContext('2d')!.getImageData(Math.round((x - r.left) * k) - 3, Math.round((y - r.top) * k) - 3, 7, 7).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3]! < 200) continue;
      const isBlue = d[i]! < 60 && d[i + 1]! > 140 && d[i + 2]! > 220;
      const isWhite = d[i]! > 230 && d[i + 1]! > 230 && d[i + 2]! > 230;
      if (isBlue || isWhite) n++;
    }
    return n;
  }, s);
}

test.describe('#1778 — no rotation handles in Distort / Perspective', () => {
  test('rotation handles disappear in the corner modes, scale handles stay', async ({ page, isMobile }) => {
    test.skip(isMobile, 'transform handles need the desktop layout');
    await page.goto('/');
    await waitForStore(page);
    // A transparent document, so the white handle fill stands out.
    await createDocument(page, 800, 600, true);
    await page.waitForTimeout(300);
    await addLayer(page);
    await setForegroundColor(page, 200, 30, 30);
    await page.keyboard.press('m');
    await drag(page, [300, 200], [500, 400]);
    await page.click('button:has-text("Edit")');
    await page.getByRole('menuitem', { name: 'Fill', exact: true }).click();
    await page.waitForTimeout(150);
    await page.keyboard.press('v');
    await page.waitForTimeout(300);

    // The rotate handle sits 20 doc px outside the top-left corner on each axis.
    const rotate: [number, number] = [280, 180];
    expect(await handlePixelsNear(page, ...rotate)).toBeGreaterThan(0);

    for (const mode of ['Perspective', 'Distort'] as const) {
      await page.getByRole('button', { name: `Transform mode: ${mode}` }).click();
      await page.waitForTimeout(300);
      expect(await handlePixelsNear(page, ...rotate)).toBe(0);
      expect(await handlePixelsNear(page, 300, 200)).toBeGreaterThan(0);
    }
    await page.screenshot({ path: 'e2e/screenshots/autofix-1778-distort-no-rotate.png' });

    await page.getByRole('button', { name: 'Transform mode: Free' }).click();
    await page.waitForTimeout(300);
    expect(await handlePixelsNear(page, ...rotate)).toBeGreaterThan(0);
  });
});
