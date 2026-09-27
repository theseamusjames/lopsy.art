import { test, expect, type Page } from './fixtures';
import { waitForStore, createDocument, getEditorState, docToScreen } from './helpers';

// ---------------------------------------------------------------------------
// #951 — Italic on Google Fonts must load and render the italic face
// ---------------------------------------------------------------------------

async function selectFont(page: Page, fontFamily: string): Promise<void> {
  await page.locator('button[aria-haspopup="listbox"]').click();
  await page.locator('input[aria-label="Search fonts"]').fill(fontFamily);
  const fontItem = page.locator('[role="option"]')
    .filter({ hasText: new RegExp(`^${fontFamily}`) })
    .first();
  await fontItem.waitFor({ state: 'visible', timeout: 5000 });
  await fontItem.click();
}

async function typeTextAt(page: Page, docX: number, docY: number, text: string): Promise<string> {
  const before = new Set((await getEditorState(page)).document.layers.map((l) => l.id));
  const pos = await docToScreen(page, docX, docY);
  await page.mouse.click(pos.x, pos.y);
  await page.waitForTimeout(100);
  await page.keyboard.type(text);
  await page.keyboard.press('Shift+Enter');
  await page.waitForTimeout(300);
  const layer = (await getEditorState(page)).document.layers.find((l) => !before.has(l.id));
  if (!layer) throw new Error('typing did not create a text layer');
  return layer.id;
}

/** Width, height and opaque-pixel count of a layer — a cheap glyph-shape fingerprint. */
async function layerSignature(page: Page, layerId: string): Promise<string> {
  return page.evaluate(async (id) => {
    const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id?: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
    const result = await readFn(id);
    if (!result) return 'empty';
    let count = 0;
    for (let i = 3; i < result.pixels.length; i += 4) {
      if ((result.pixels[i] ?? 0) > 10) count++;
    }
    return `${result.width}x${result.height}:${count}`;
  }, layerId);
}

test.describe('Google Font italic (#951)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'text options require the desktop layout');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 400, false);
  });

  test('Italic style renders the family\'s italic face, not the upright one', async ({ page }) => {
    const italicRequests: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('Instrument%20Serif:ital,wght@1,')) italicRequests.push(req.url());
    });

    await page.keyboard.press('t');
    await selectFont(page, 'Instrument Serif');
    await page.waitForFunction(
      (family) => {
        const fn = (window as unknown as Record<string, unknown>).__isFontLoaded as
          ((f: string) => boolean) | undefined;
        return fn ? fn(family) : false;
      },
      'Instrument Serif',
      { timeout: 15000 },
    );

    const uprightId = await typeTextAt(page, 40, 80, 'Hamburgefonstiv');

    // Move off the committed text layer so the Style change targets the
    // next layer only, then switch to Italic the way a user would.
    await page.locator('[aria-label="Add Layer"]').click();
    await page.locator('select[aria-label="Font style"]').selectOption('italic');

    const italicId = await typeTextAt(page, 40, 260, 'Hamburgefonstiv');
    const italicLayer = (await getEditorState(page)).document.layers.find((l) => l.id === italicId) as
      unknown as { fontStyle: string };
    expect(italicLayer.fontStyle).toBe('italic');

    await expect.poll(() => italicRequests.length, { timeout: 15000 }).toBeGreaterThan(0);

    const upright = await layerSignature(page, uprightId);
    expect(upright).not.toBe('empty');
    // Once the italic binary lands the layer re-renders with slanted glyphs,
    // so its size / coverage must differ from the upright copy of the same text.
    await expect.poll(() => layerSignature(page, italicId), { timeout: 15000 }).not.toBe(upright);
    await page.screenshot({ path: 'e2e/screenshots/autofix-951-italic.png' });
  });
});

// ---------------------------------------------------------------------------
// #952 — Layer → Group Layers with one selected layer wraps it
// ---------------------------------------------------------------------------

test.describe('Group Layers with a single selected layer (#952)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'menu bar and layer panel require the desktop layout');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
  });

  test('wraps the active layer in a new group and records history', async ({ page }) => {
    await page.locator('[aria-label="Add Layer"]').click();
    const before = await getEditorState(page);
    const layerId = before.document.activeLayerId!;

    await page.locator('nav[aria-label="Application menu"]').locator('button:has-text("Layer")').click();
    await page.locator('[role="menu"][aria-label="Layer"]').locator('button:has-text("Group Layers")').click();

    const after = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string; layers: Array<{ id: string; type: string; children?: string[] }> };
          undoStack: Array<{ label: string }>;
        };
      };
      const s = store.getState();
      const group = s.document.layers.find((l) => l.id === s.document.activeLayerId)!;
      return {
        groupType: group.type,
        children: group.children ?? [],
        lastLabel: s.undoStack[s.undoStack.length - 1]?.label,
      };
    });

    expect(after.groupType).toBe('group');
    expect(after.children).toEqual([layerId]);
    expect(after.lastLabel).toBe('Group Layers');

    // One undo restores the ungrouped stack.
    await page.keyboard.press('Control+z');
    const undone = await getEditorState(page);
    expect(undone.document.layers.map((l) => l.id).sort()).toEqual(before.document.layers.map((l) => l.id).sort());
  });
});

// ---------------------------------------------------------------------------
// #953 — Effects drawer must stay inside the viewport
// ---------------------------------------------------------------------------

test.describe('Effects drawer viewport clamp (#953)', () => {
  test.use({ viewport: { width: 1600, height: 1000 } });

  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'drawers require the sidebar, hidden on touch devices');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
  });

  test('an expanded Gradient Map node scrolls inside the drawer instead of running off-screen', async ({ page }) => {
    await page.locator('[aria-label="New Group"]').click();
    const groupId = (await getEditorState(page)).document.activeLayerId!;
    await page.locator(`[data-layer-id="${groupId}"]`).locator('button[aria-label*="effects"]').click();

    const drawer = page.getByTestId('effects-drawer');
    await expect(drawer).toBeVisible();
    await page.locator('[aria-label="Add Adjustment"]').click();
    const item = page.getByRole('menuitem', { name: 'Gradient Map', exact: true });
    await item.waitFor({ state: 'visible', timeout: 3000 });
    await item.click();
    await page.waitForTimeout(200);

    const viewportHeight = page.viewportSize()!.height;
    const box = await drawer.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewportHeight);

    // The content still has to be reachable: it scrolls inside the drawer.
    const addButton = drawer.locator('[aria-label="Add Adjustment"]');
    await addButton.scrollIntoViewIfNeeded();
    const buttonBox = await addButton.boundingBox();
    expect(buttonBox).not.toBeNull();
    expect(buttonBox!.y + buttonBox!.height).toBeLessThanOrEqual(viewportHeight);

    // Scrolling a drawer control into view must never scroll the app shell.
    const menubarTop = await page.locator('nav[aria-label="Application menu"]').evaluate(
      (el) => el.getBoundingClientRect().top,
    );
    expect(menubarTop).toBeGreaterThanOrEqual(0);
    await page.screenshot({ path: 'e2e/screenshots/autofix-953-drawer.png' });
  });
});
