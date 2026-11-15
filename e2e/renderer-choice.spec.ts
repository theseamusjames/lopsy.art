import { test, expect, type Page } from './fixtures';
import { createDocument, waitForStore } from './helpers';

// View > Renderer picks which build of the engine a page load runs: the
// WebGL one, or the wgpu one where the browser has WebGPU. The two are
// separate downloads, so a choice takes effect on the next load.

const STORAGE_KEY = 'lopsy:renderer';

async function openRendererSubmenu(page: Page) {
  await page.getByRole('button', { name: 'View' }).click();
  await page.hover('[role="menuitem"]:has-text("Renderer")');
  const submenu = page.locator('[role="menu"][aria-label="Renderer"]');
  await expect(submenu).toBeVisible();
  return submenu;
}

/** Start the engine and report which build it is. */
async function startedRenderer(page: Page): Promise<string> {
  await waitForStore(page);
  await createDocument(page, 200, 150, false);
  await page.waitForFunction(() => '__wasmBridge' in window);
  return page.evaluate(() =>
    (window as unknown as { __wasmBridge: { rendererName: () => string } }).__wasmBridge.rendererName(),
  );
}

/** Whether this browser hands out a WebGPU adapter: wgpu runs only then. */
async function canRunWebGpu(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    if (!gpu) return false;
    try {
      return (await gpu.requestAdapter()) !== null;
    } catch {
      return false;
    }
  });
}

test.describe('View > Renderer', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'uses the desktop menu bar');
  });

  test('a choice is stored, announced, and run by the next load', async ({ page }) => {
    await page.goto('/');
    const initial = await startedRenderer(page);
    const other = initial === 'webgl' ? 'wgpu' : 'webgl';
    const labels = { webgl: 'WebGL', wgpu: 'WebGPU (Experimental)' } as const;
    const names = { webgl: 'WebGL', wgpu: 'WebGPU' } as const;
    const statusBar = page.locator('[aria-label="Status bar"]');

    // The status bar names the engine this page is running.
    await expect(statusBar).toContainText(names[initial as 'webgl' | 'wgpu']);
    await expect(statusBar).not.toContainText(names[other]);

    // Choosing the renderer already running changes nothing but the store.
    let submenu = await openRendererSubmenu(page);
    await submenu.getByRole('menuitem', { name: labels[initial as 'webgl' | 'wgpu'] }).click();
    await expect(page.locator('[role="status"]').filter({ hasText: 'Lopsy is using the' })).toBeVisible();
    expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBe(initial);

    submenu = await openRendererSubmenu(page);
    const otherItem = submenu.getByRole('menuitem', { name: labels[other] });
    const hasWebGpu = await page.evaluate(() => 'gpu' in navigator);
    if (other === 'wgpu' && !hasWebGpu) {
      // Without WebGPU the item is there but cannot be picked.
      await expect(otherItem).toHaveAttribute('aria-disabled', 'true');
      return;
    }
    await otherItem.click();
    await expect(page.locator('[role="status"]').filter({ hasText: 'the next time it loads' })).toBeVisible();
    expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBe(other);

    // The next load runs the choice, or WebGL where WebGPU has no adapter.
    await page.reload();
    const expected = other === 'wgpu' && !(await canRunWebGpu(page)) ? 'webgl' : other;
    expect(await startedRenderer(page)).toBe(expected);
    await expect(statusBar).toContainText(names[expected]);

    // And the menu shows the stored choice as the checked one.
    submenu = await openRendererSubmenu(page);
    await expect(submenu.getByRole('menuitem', { name: labels[other] })).toContainText('✓');
    await expect(submenu.getByRole('menuitem', { name: labels[initial as 'webgl' | 'wgpu'] })).not.toContainText('✓');
  });

  test('?renderer= in the URL wins over the stored choice', async ({ page }) => {
    await page.goto('/');
    await page.evaluate((key) => localStorage.setItem(key, 'wgpu'), STORAGE_KEY);
    await page.goto('/?renderer=webgl');
    expect(await startedRenderer(page)).toBe('webgl');
  });
});
