/**
 * Regression test for #960: ⌘V pressed right after ⌘X / ⌘C pasted the
 * *previous* OS clipboard image. Cut/Copy stage the GPU clipboard
 * synchronously but mirror it to the OS clipboard asynchronously (readback →
 * PNG encode → navigator.clipboard.write). A paste inside that window read the
 * stale image, failed the internal paste-back match, and dropped it at 0,0
 * through the external-image route (switching the tool to Move).
 */
import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  selectTool,
  setForegroundColor,
  docToScreen,
} from './helpers';

const isMac = process.platform === 'darwin';
const mod = isMac ? 'Meta' : 'Control';

async function dragMarquee(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  await selectTool(page, 'marquee-rect');
  const start = await docToScreen(page, x0, y0);
  const end = await docToScreen(page, x1, y1);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(100);
}

async function editMenu(page: Page, item: string): Promise<void> {
  await page.click('button:has-text("Edit")');
  await page.getByRole('menuitem', { name: item, exact: true }).click();
  await page.waitForTimeout(100);
}

interface Snapshot {
  layers: Array<{ name: string; x: number; y: number; width: number; height: number }>;
  activeTool: string;
}

async function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const editor = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Snapshot['layers'] } };
    };
    const ui = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { activeTool: string };
    };
    return { layers: editor.getState().document.layers, activeTool: ui.getState().activeTool };
  });
}

test.beforeEach(async ({ page, isMobile, browserName }) => {
  test.skip(isMobile, 'menus and marquee drags need the desktop layout');
  test.skip(browserName !== 'chromium', 'needs async clipboard read/write permissions');
  await page.goto('/');
  await waitForStore(page);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(() => navigator.clipboard.writeText(''));
});

for (const action of ['Cut', 'Copy'] as const) {
  test(`⌘V straight after ⌘${action === 'Cut' ? 'X' : 'C'} pastes the new clip in place, not the previous clipboard image`, async ({ page }) => {
    await createDocument(page, 800, 600, true);
    await page.waitForTimeout(300);

    await setForegroundColor(page, 255, 0, 0);
    await dragMarquee(page, 100, 100, 300, 250);
    await editMenu(page, 'Fill');
    await page.keyboard.press(`${mod}+KeyD`);
    await page.waitForTimeout(100);

    // Put a full-document image on the OS clipboard and let it land.
    await editMenu(page, 'Copy Merged');
    await page.waitForTimeout(1000);

    await dragMarquee(page, 120, 120, 180, 180);
    const toolBefore = (await snapshot(page)).activeTool;

    await page.keyboard.press(`${mod}+Key${action === 'Cut' ? 'X' : 'C'}`);
    await page.keyboard.press(`${mod}+KeyV`);
    await page.waitForTimeout(800);
    await page.screenshot({ path: `e2e/screenshots/paste-right-after-${action.toLowerCase()}.png` });

    const after = await snapshot(page);
    const pasted = after.layers.filter((l) => l.name === 'Pasted Layer');
    expect(pasted).toHaveLength(1);
    // The stale route pasted the 800x600 Copy Merged composite at (0,0).
    expect(pasted[0]!.width).toBe(60);
    expect(pasted[0]!.height).toBe(60);
    expect(pasted[0]!.x).toBe(120);
    expect(pasted[0]!.y).toBe(120);
    // The external-image route also force-switches to Move.
    expect(after.activeTool).toBe(toolBefore);
  });
}
