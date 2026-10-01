/**
 * Every toolbox button that advertises a key in its label — "Brush (B)" —
 * must be reachable with that key (#1078).
 *
 * Quick Selection's button used to read "Quick Selection (Q)", but Q
 * toggles Quick Mask: pressing it tinted the canvas blue and left the
 * active tool unchanged. The test walks the toolbox the way a user reads
 * it: hover-label first, then press the letter and check what happened.
 */
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { waitForStore, createDocument } from './helpers';

interface UiSnapshot {
  activeTool: string;
  maskMode: string;
}

async function readUi(page: Page): Promise<UiSnapshot> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => UiSnapshot;
    };
    const s = store.getState();
    return { activeTool: s.activeTool, maskMode: s.maskMode };
  });
}

async function blurFocus(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

test.describe('Toolbox shortcut labels (#1078)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
  });

  test('every key a tool button advertises selects that tool', async ({ page }) => {
    const buttons = page.locator('[role="toolbar"][aria-label="Drawing tools"] [data-tool-id]');
    const entries = await buttons.evaluateAll((els) =>
      els.map((el) => ({
        id: el.getAttribute('data-tool-id') ?? '',
        label: el.getAttribute('aria-label') ?? '',
      })),
    );
    expect(entries.length).toBe(23);

    const advertised = entries
      .map((e) => ({ ...e, key: /\(([A-Z])\)$/.exec(e.label)?.[1] ?? null }))
      .filter((e): e is { id: string; label: string; key: string } => e.key !== null);
    expect(advertised.length).toBeGreaterThan(10);

    for (const { id, label, key } of advertised) {
      await page.locator('[data-tool-id="move"]').click();
      await blurFocus(page);
      if (id === 'move') {
        await page.locator('[data-tool-id="brush"]').click();
        await blurFocus(page);
      }

      await page.keyboard.press(key.toLowerCase());

      const ui = await readUi(page);
      expect(ui.activeTool, `"${label}" advertises ${key}`).toBe(id);
      expect(ui.maskMode, `pressing ${key} for "${label}" must not toggle Quick Mask`).not.toBe('quickMask');
    }
  });

  test('Quick Selection carries no key, and Q still toggles Quick Mask', async ({ page }) => {
    const quickSelect = page.locator('[data-tool-id="quick-select"]');
    await expect(quickSelect).toHaveAttribute('aria-label', 'Quick Selection');
    await expect(quickSelect).toHaveAttribute('title', 'Quick Selection');

    await blurFocus(page);
    await page.keyboard.press('q');
    expect((await readUi(page)).maskMode).toBe('quickMask');
    await expect(page.getByTestId('quick-mask-toggle')).toHaveAttribute('aria-label', 'Exit Quick Mask (Q)');

    await page.keyboard.press('q');
    expect((await readUi(page)).maskMode).toBe('off');
  });
});
