import { test, expect, type Page } from '@playwright/test';

// Regression coverage for: clicking inside the guide color picker
// closes it instead of letting the user interact with the ColorPicker.
// The picker is dismissed by a window-level pointerdown listener in
// useCanvasPointerHandlers; a previous fix added event-stopping on the
// picker root. This test catches it if that stops working again.

async function waitForStore(page: Page) {
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
}

async function createDocument(page: Page, width = 400, height = 300) {
  await page.evaluate(
    ({ w, h }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { createDocument: (w: number, h: number, t: boolean) => void };
      };
      store.getState().createDocument(w, h, false);
    },
    { w: width, h: height },
  );
  await page.waitForTimeout(300);
}

test('clicking inside the guide color picker keeps it open', async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page);

  const container = page.locator('[data-testid="canvas-container"]');
  const box = await container.boundingBox();
  expect(box).not.toBeNull();

  // Add a guide by clicking on the horizontal ruler strip (top edge of
  // the canvas, past the corner swatch). RULER_SIZE = 20 in app code.
  await page.mouse.click(box!.x + 100, box!.y + 10);
  await page.waitForTimeout(150);

  const guideCount = await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { guides: Array<unknown> };
    };
    return store.getState().guides.length;
  });
  expect(guideCount).toBe(1);

  // Open the guide color picker by clicking the ruler-corner swatch.
  await page.mouse.click(box!.x + 10, box!.y + 10);
  await page.waitForTimeout(150);

  const picker = page.locator('[class*="guideColorPicker"]');
  await expect(picker).toBeVisible();

  // Click inside the picker. This is the regression surface: a
  // window-level pointerdown listener closes the picker unless the
  // picker stops the event at the DOM level (not just React's synthetic
  // event tree). Target the center of the picker body — that lands on
  // the ColorPicker's SV area, which is a real interactive target.
  const pickerBox = await picker.boundingBox();
  expect(pickerBox).not.toBeNull();
  await page.mouse.click(
    pickerBox!.x + pickerBox!.width / 2,
    pickerBox!.y + pickerBox!.height / 2,
  );
  await page.waitForTimeout(150);

  // The picker must still be visible after clicking inside it.
  await expect(picker).toBeVisible();
});
