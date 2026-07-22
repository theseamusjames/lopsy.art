import { test, expect } from './fixtures';
import { createDocument, waitForStore, drawRect } from './helpers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function openChannelsPanel(page: Parameters<typeof test>[1]['page']): Promise<void> {
  // Click the Channels panel toggle button in the PanelToolbar
  const btn = page.locator('[role="toolbar"][aria-label="Panel visibility"] button[aria-label="Channels"]');
  await btn.waitFor({ state: 'visible' });
  const isActive = await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { visiblePanels: Set<string> };
    };
    return store.getState().visiblePanels.has('channels');
  });
  if (!isActive) {
    await btn.click();
    await page.waitForTimeout(100);
  }
}

async function getChannelVisibility(
  page: Parameters<typeof test>[1]['page'],
): Promise<{ r: boolean; g: boolean; b: boolean; a: boolean }> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { channelVisibility: { r: boolean; g: boolean; b: boolean; a: boolean } };
    };
    return store.getState().channelVisibility;
  });
}

async function getActiveChannel(
  page: Parameters<typeof test>[1]['page'],
): Promise<string> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { activeChannel: string };
    };
    return store.getState().activeChannel;
  });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

test.beforeEach(async ({ page, isMobile }) => {
  test.skip(isMobile, 'channels panel requires sidebar, hidden on touch devices');
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 400, 300, true);
  await openChannelsPanel(page);
});

// ---------------------------------------------------------------------------
// Panel structure
// ---------------------------------------------------------------------------

test.describe('Channels panel structure', () => {
  test('panel is visible after opening via toolbar', async ({ page }) => {
    await expect(page.locator('section[aria-label="Channels"]')).toBeVisible();
  });

  test('shows composite RGB row', async ({ page }) => {
    const rgbRow = page.locator('[data-testid="channel-row-rgb"]');
    await expect(rgbRow).toBeVisible();
    await expect(rgbRow).toContainText('RGB');
  });

  test('shows 4 individual channel rows', async ({ page }) => {
    await expect(page.locator('[data-testid="channel-row-r"]')).toBeVisible();
    await expect(page.locator('[data-testid="channel-row-g"]')).toBeVisible();
    await expect(page.locator('[data-testid="channel-row-b"]')).toBeVisible();
    await expect(page.locator('[data-testid="channel-row-a"]')).toBeVisible();
  });

  test('RGB row has no visibility toggle (it cannot be hidden)', async ({ page }) => {
    const rgbRow = page.locator('[data-testid="channel-row-rgb"]');
    await expect(rgbRow.locator('[data-testid="channel-visibility-rgb"]')).toHaveCount(0);
  });

  test('each individual channel row has a visibility toggle button', async ({ page }) => {
    for (const ch of ['r', 'g', 'b', 'a']) {
      await expect(page.locator(`[data-testid="channel-visibility-${ch}"]`)).toBeVisible();
    }
  });
});

// ---------------------------------------------------------------------------
// Channel visibility toggles
// ---------------------------------------------------------------------------

test.describe('Channel visibility toggles', () => {
  test('all channels start visible', async ({ page }) => {
    const vis = await getChannelVisibility(page);
    expect(vis.r).toBe(true);
    expect(vis.g).toBe(true);
    expect(vis.b).toBe(true);
    expect(vis.a).toBe(true);
  });

  test('clicking red channel eye hides red channel', async ({ page }) => {
    const visBtn = page.locator('[data-testid="channel-visibility-r"]');
    await visBtn.click();

    const vis = await getChannelVisibility(page);
    expect(vis.r).toBe(false);
    // Others remain visible
    expect(vis.g).toBe(true);
    expect(vis.b).toBe(true);
    expect(vis.a).toBe(true);
  });

  test('clicking again restores hidden channel', async ({ page }) => {
    const visBtn = page.locator('[data-testid="channel-visibility-r"]');
    await visBtn.click();

    const visBefore = await getChannelVisibility(page);
    expect(visBefore.r).toBe(false);

    await visBtn.click();

    const visAfter = await getChannelVisibility(page);
    expect(visAfter.r).toBe(true);
  });

  test('hidden channel row shows EyeOff icon via aria-label change', async ({ page }) => {
    const visBtn = page.locator('[data-testid="channel-visibility-g"]');

    // Initially shows "Hide Green channel"
    await expect(visBtn).toHaveAttribute('aria-label', 'Hide Green channel');

    await visBtn.click();

    // After hiding shows "Show Green channel"
    await expect(visBtn).toHaveAttribute('aria-label', 'Show Green channel');
  });

  test('hidden channel row gets dimmed opacity class', async ({ page }) => {
    const visBtn = page.locator('[data-testid="channel-visibility-b"]');
    const row = page.locator('[data-testid="channel-row-b"]');

    // Before hiding: no disabled style
    const classBefore = await row.getAttribute('class');
    expect(classBefore).not.toContain('Disabled');

    await visBtn.click();

    // After hiding: row should have a disabled class
    const classAfter = await row.getAttribute('class');
    expect(classAfter).toMatch(/Disabled/i);
  });
});

// ---------------------------------------------------------------------------
// Active channel selection
// ---------------------------------------------------------------------------

test.describe('Active channel selection', () => {
  test('RGB is the default active channel', async ({ page }) => {
    const active = await getActiveChannel(page);
    expect(active).toBe('rgb');
  });

  test('clicking a channel row sets it as active', async ({ page }) => {
    await page.locator('[data-testid="channel-row-r"]').click();
    const active = await getActiveChannel(page);
    expect(active).toBe('r');
  });

  test('active channel row has active style', async ({ page }) => {
    await page.locator('[data-testid="channel-row-g"]').click();
    const rowClass = await page.locator('[data-testid="channel-row-g"]').getAttribute('class');
    expect(rowClass).toMatch(/Active/i);
  });

  test('clicking another channel deselects previous', async ({ page }) => {
    await page.locator('[data-testid="channel-row-r"]').click();
    await page.locator('[data-testid="channel-row-b"]').click();

    const active = await getActiveChannel(page);
    expect(active).toBe('b');

    const rClass = await page.locator('[data-testid="channel-row-r"]').getAttribute('class');
    expect(rClass).not.toMatch(/Active/i);
  });
});

// ---------------------------------------------------------------------------
// Screenshot: full feature test with layer content
// ---------------------------------------------------------------------------

test('panel visible with channel rows — screenshot', async ({ page }) => {
  // Draw a red rectangle so thumbnails have content to show
  await drawRect(page, 50, 50, 200, 150, { r: 200, g: 80, b: 40 });
  await page.waitForTimeout(300);

  await page.screenshot({ path: 'e2e/screenshots/channels-panel-all-visible.png' });

  // The channels list should show all 5 rows
  const rows = page.locator('[data-testid="channels-list"] > [data-testid^="channel-row"]');
  await expect(rows).toHaveCount(5);

  // The RGB row should be present and visible
  await expect(page.locator('[data-testid="channel-row-rgb"]')).toBeVisible();
});

test('channel thumbnails render content for a filled layer (#683 GPU downscale)', async ({ page }) => {
  // Regression test for #683 — the panel used to do a full-resolution GPU
  // readback per channel and CPU-downscale. It now renders through the
  // channel_extract shader into a small GPU texture and reads back only
  // the thumbnail. This test just verifies the wiring: the visible
  // thumbnails paint non-empty pixels for a red-fill layer.
  await drawRect(page, 20, 20, 300, 200, { r: 220, g: 60, b: 20 });
  await page.waitForTimeout(400);

  // Every channel row has a canvas.
  const canvases = page.locator('[data-testid="channels-list"] canvas');
  await expect(canvases).toHaveCount(5);

  // The RGB row's canvas must have any non-transparent pixel — the red fill.
  const rgbHasContent = await page.locator('[data-testid="channel-row-rgb"] canvas').evaluate(
    (canvas: HTMLCanvasElement) => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return false;
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 3; i < data.length; i += 4) {
        if (data[i]! > 0) return true;
      }
      return false;
    },
  );
  expect(rgbHasContent).toBe(true);

  // The Red channel thumb is grayscale of the red channel — it should be
  // brighter (higher R value) than the Blue channel thumb where the fill is
  // mostly zero.
  const meanBrightness = async (channel: 'r' | 'g' | 'b' | 'a') => {
    return page.locator(`[data-testid="channel-row-${channel}"] canvas`).evaluate(
      (canvas: HTMLCanvasElement) => {
        const ctx = canvas.getContext('2d');
        if (!ctx) return 0;
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        let sum = 0;
        let count = 0;
        for (let i = 0; i < data.length; i += 4) {
          // Only sample pixels that were painted (alpha > 0 in the source
          // means the fill covers this thumbnail texel).
          if (data[i + 3]! > 0) {
            sum += data[i]!;
            count++;
          }
        }
        return count === 0 ? 0 : sum / count;
      },
    );
  };

  const rBright = await meanBrightness('r');
  const bBright = await meanBrightness('b');
  expect(rBright).toBeGreaterThan(bBright);
});

test('panel with one channel toggled off — screenshot', async ({ page }) => {
  await drawRect(page, 50, 50, 200, 150, { r: 200, g: 80, b: 40 });
  await page.waitForTimeout(300);

  // Hide the red channel
  await page.locator('[data-testid="channel-visibility-r"]').click();
  await page.waitForTimeout(100);

  await page.screenshot({ path: 'e2e/screenshots/channels-panel-red-hidden.png' });

  // Red channel should now show as "Show" (eye-off state)
  await expect(page.locator('[data-testid="channel-visibility-r"]')).toHaveAttribute(
    'aria-label',
    'Show Red channel',
  );
  // Red row should be dimmed
  const rowClass = await page.locator('[data-testid="channel-row-r"]').getAttribute('class');
  expect(rowClass).toMatch(/Disabled/i);
  // Green, Blue, Alpha should still be visible
  const vis = await getChannelVisibility(page);
  expect(vis.r).toBe(false);
  expect(vis.g).toBe(true);
  expect(vis.b).toBe(true);
  expect(vis.a).toBe(true);
});
