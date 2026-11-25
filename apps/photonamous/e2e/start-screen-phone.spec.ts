import { expect, test } from './test';

/**
 * The start screen at phone sizes (#1826): the film on top, the way in
 * below it, and nothing under the way in. A screen taller than the two used
 * to leave a strip of the screen's own background at the bottom.
 */

const PHONES = [
  { width: 412, height: 839 }, // Pixel 7: taller than film + panel
  { width: 390, height: 664 }, // iPhone 13: the screen scrolls
  { width: 360, height: 1000 }, // a tall, narrow window
];

for (const size of PHONES) {
  test(`at ${size.width} × ${size.height} the panel reaches the foot of the screen`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto('/');
    await expect(page.getByRole('button', { name: /This browser/ })).toBeVisible();

    const layout = await page.evaluate(() => {
      const screen = document.querySelector('main');
      const panel = screen?.lastElementChild;
      if (!screen || !panel) return null;
      return {
        screenBottom: screen.getBoundingClientRect().bottom,
        contentHeight: screen.scrollHeight,
        clientHeight: screen.clientHeight,
        panelBottomInContent: panel.getBoundingClientRect().bottom + screen.scrollTop,
        viewport: window.innerHeight,
      };
    });
    expect(layout).not.toBeNull();
    if (!layout) return;
    // The screen fills the window…
    expect(Math.round(layout.screenBottom)).toBe(layout.viewport);
    // …and the panel runs to the end of what the screen holds: to its foot
    // when everything fits, to the end of the scroll when it doesn't.
    expect(Math.round(layout.panelBottomInContent)).toBe(Math.max(layout.contentHeight, layout.clientHeight));
  });
}
