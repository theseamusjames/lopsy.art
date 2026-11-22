// #1819 — dropdown arrows were drawn by the browser wherever each select's
// own padding left them, jammed against the right border. Every select
// now draws the same caret with a gap on its right.
import { test, expect, type Page } from './fixtures';
import { createDocument, waitForStore } from './helpers';

interface SelectLook {
  appearance: string;
  paddingRight: number;
  backgroundImage: string;
  width: number;
}

async function visibleOptionsBarSelects(page: Page): Promise<SelectLook[]> {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll('select'))
      .filter((el) => el.getBoundingClientRect().width > 0)
      .map((el) => {
        const cs = getComputedStyle(el);
        return {
          appearance: cs.appearance,
          paddingRight: parseFloat(cs.paddingRight),
          backgroundImage: cs.backgroundImage,
          width: el.getBoundingClientRect().width,
        };
      });
  });
}

test.describe('#1819 — dropdown arrows keep their right-side padding', () => {
  // Every select draws the stylesheet's caret instead of the browser's
  // arrow, so the gap on its right no longer depends on the browser.
  test('options-bar selects draw a caret with room on the right', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the options bar is laid out differently on touch UIs');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300);
    await page.waitForSelector('[data-testid="canvas-container"]');

    // The Text tool's options bar has several selects (font weight, align, path, …).
    await page.keyboard.press('t');
    await page.waitForTimeout(200);

    const looks = await visibleOptionsBarSelects(page);
    expect(looks.length).toBeGreaterThan(0);
    for (const look of looks) {
      expect(look.appearance).toBe('none');
      expect(look.paddingRight).toBeGreaterThanOrEqual(20);
      expect(look.backgroundImage).toContain('linear-gradient');
    }
  });
});
