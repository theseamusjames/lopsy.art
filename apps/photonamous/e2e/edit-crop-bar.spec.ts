import { expect, test, type Locator, type Page } from './test';
import { openGeneratedImage, openHarness, waitForReady } from './harness';

/**
 * The crop's options bar and its grip. Until it is moved, the bar places
 * itself below the photo (above it when it would hide the crop's bottom
 * edge: a11y-edit.spec.ts). Dragging the grip puts it anywhere on the
 * photo, kept 8 px inside the stage; a click, Enter or Space sends it to
 * the other end (WCAG 2.5.7); the arrow keys move it (2.1.1); and the
 * next crop on this device opens with it where it was put.
 */

/** BAR_MARGIN in src/edit/crop-bar.ts, and the --space-3 the bar keeps from the stage in its own place. */
const MARGIN = 8;
const OWN_MARGIN = 12;

interface Edges {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly centreX: number;
  readonly centreY: number;
}

async function edgesOf(locator: Locator): Promise<Edges> {
  const b = await locator.boundingBox();
  if (!b) throw new Error('not on screen');
  return { left: b.x, top: b.y, right: b.x + b.width, bottom: b.y + b.height, centreX: b.x + b.width / 2, centreY: b.y + b.height / 2 };
}

/** Waits for one of the bar's edges to be at `expected`, give or take a pixel. */
async function expectEdge(bar: Locator, edge: keyof Edges, expected: number): Promise<void> {
  await expect
    .poll(async () => Math.abs((await edgesOf(bar))[edge] - expected), { message: `how far the options' ${edge} is from ${expected}` })
    .toBeLessThanOrEqual(1);
}

/**
 * The crop frame once the photo has taken its place. Crop opens with the
 * photo where it was, in the middle of the stage; a moment later, once the
 * options have been measured, it moves up to leave them room. How long
 * that takes varies (the first photo of a run is slow), so this waits for
 * the move, then for the frame to be still.
 */
async function settledFrame(page: Page, stage: Edges): Promise<Edges> {
  const frame = page.getByTestId('crop-rect');
  await expect.poll(async () => (await edgesOf(frame)).centreY, { message: 'the photo moves up to leave the options room' }).toBeLessThan(stage.centreY - 1);
  let last = await edgesOf(frame);
  await expect
    .poll(
      async () => {
        const next = await edgesOf(frame);
        const isStill = next.top === last.top && next.left === last.left;
        last = next;
        return isStill;
      },
      { message: 'the crop frame comes to rest', intervals: [100] },
    )
    .toBe(true);
  return last;
}

const steps = (page: Page) => page.evaluate(() => window.__photosHarness?.steps ?? []);

async function openPhoto(page: Page): Promise<void> {
  await openHarness(page);
  await openGeneratedImage(page);
  await waitForReady(page);
}

async function openCrop(page: Page): Promise<{ readonly bar: Locator; readonly grip: Locator; readonly stage: Edges }> {
  await page.keyboard.press('r');
  const crop = page.getByRole('group', { name: 'Crop', exact: true });
  await expect(crop.getByRole('slider', { name: 'Top edge' })).toBeFocused();
  const bar = crop.getByRole('group', { name: 'Crop options' });
  return { bar, grip: bar.getByRole('button', { name: 'Move crop options' }), stage: await edgesOf(page.getByTestId('crop-tool')) };
}

/** Presses on the middle of the grip, moves the pointer to (x, y) and lets go there. */
async function dragGrip(page: Page, grip: Locator, x: number, y: number): Promise<void> {
  const g = await edgesOf(grip);
  await page.mouse.move(g.centreX, g.centreY);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 12 });
  await page.mouse.up();
}

function viewport(page: Page): { readonly width: number; readonly height: number } {
  const size = page.viewportSize();
  if (!size) throw new Error('no viewport');
  return size;
}

test('the options start below the photo, and dragging the grip moves them by the drag', async ({ page }) => {
  await openPhoto(page);
  const { bar, grip, stage } = await openCrop(page);
  // A fresh profile: the bar's own place, centred, 12 px above the stage's bottom.
  await expectEdge(bar, 'centreX', stage.centreX);
  await expectEdge(bar, 'bottom', stage.bottom - OWN_MARGIN);
  const frame = await settledFrame(page, stage);
  const start = await edgesOf(bar);
  // The photo leaves them room: the crop's bottom edge, its handle included (12 px below it), is clear of them.
  expect(frame.bottom + 12).toBeLessThanOrEqual(start.top);

  const g = await edgesOf(grip);
  await dragGrip(page, grip, g.centreX - 100, g.centreY - 200);
  // Moved by the drag, and not sent on to the top by the click that ends it.
  await expectEdge(bar, 'left', start.left - 100);
  await expectEdge(bar, 'top', start.top - 200);
  // Moving the options moves nothing else.
  expect(await edgesOf(page.getByTestId('crop-rect'))).toEqual(frame);
  await expect(page.getByTestId('crop-tool')).toBeVisible();
  expect(await steps(page)).toEqual([]);
});

test('a drag past the stage keeps the options inside it, 8 px from its edges', async ({ page }) => {
  await openPhoto(page);
  const { bar, grip, stage } = await openCrop(page);
  await dragGrip(page, grip, 1, 1);
  await expectEdge(bar, 'left', stage.left + MARGIN);
  await expectEdge(bar, 'top', stage.top + MARGIN);

  const { width, height } = viewport(page);
  await dragGrip(page, grip, width - 1, height - 1);
  await expectEdge(bar, 'right', stage.right - MARGIN);
  await expectEdge(bar, 'bottom', stage.bottom - MARGIN);
});

test('a click on the grip sends the options to the top and another to the bottom; a press that barely moves is a click', async ({ page }) => {
  await openPhoto(page);
  const { bar, grip, stage } = await openCrop(page);
  await expect(grip).toHaveAccessibleDescription(/Enter, or a click, moves them to the top or the bottom/);
  await expect(grip).toHaveAttribute('title', 'Drag to move the crop options, or click to move them to the top');

  await grip.click();
  await expectEdge(bar, 'top', stage.top + MARGIN);
  await expectEdge(bar, 'centreX', stage.centreX);
  await expect(grip).toHaveAttribute('title', 'Drag to move the crop options, or click to move them to the bottom');

  // Inside the 3 px dead zone the press is still a click, not a drag of 2 px.
  const g = await edgesOf(grip);
  await page.mouse.move(g.centreX, g.centreY);
  await page.mouse.down();
  await page.mouse.move(g.centreX + 2, g.centreY + 1);
  await page.mouse.up();
  await expectEdge(bar, 'bottom', stage.bottom - MARGIN);
  await expectEdge(bar, 'centreX', stage.centreX);
  await expect(grip).toHaveAttribute('title', 'Drag to move the crop options, or click to move them to the top');
  await expect(page.getByTestId('crop-tool')).toBeVisible();
  expect(await steps(page)).toEqual([]);
});

test('from the keyboard the arrow keys move the options, Enter and Space send them to the other end, and Escape still cancels', async ({ page }) => {
  await openPhoto(page);
  const { bar, grip, stage } = await openCrop(page);
  // The four edges come first, then the grip.
  for (let i = 0; i < 4; i++) await page.keyboard.press('Tab');
  await expect(grip).toBeFocused();
  const frame = await settledFrame(page, stage);
  const start = await edgesOf(bar);

  await page.keyboard.press('ArrowLeft');
  await expectEdge(bar, 'left', start.left - 10);
  await page.keyboard.press('ArrowUp');
  await expectEdge(bar, 'top', start.top - 10);
  await page.keyboard.press('Shift+ArrowRight');
  await expectEdge(bar, 'left', start.left + 40);
  await page.keyboard.press('Shift+ArrowUp');
  await expectEdge(bar, 'top', start.top - 60);
  expect(await edgesOf(page.getByTestId('crop-rect'))).toEqual(frame);

  // Enter on the grip moves the options, keeping their side, and does not apply the crop.
  await page.keyboard.press('Enter');
  await expectEdge(bar, 'top', stage.top + MARGIN);
  await expectEdge(bar, 'left', start.left + 40);
  await expect(page.getByTestId('crop-tool')).toBeVisible();
  await page.keyboard.press('Space');
  await expectEdge(bar, 'bottom', stage.bottom - MARGIN);
  await expect(grip).toBeFocused();
  expect(await steps(page)).toEqual([]);

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('crop-tool')).toHaveCount(0);
  await expect(page.getByTestId('edit-status')).toHaveText('Crop cancelled');
  expect(await steps(page)).toEqual([]);
});

test('the options stay where they were put: after Done, in the next crop, in a smaller window and after a reload', async ({ page }) => {
  await openPhoto(page);
  const first = await openCrop(page);
  const { width, height } = viewport(page);
  await dragGrip(page, first.grip, width - 1, height - 1);
  await expectEdge(first.bar, 'right', first.stage.right - MARGIN);
  await expectEdge(first.bar, 'bottom', first.stage.bottom - MARGIN);
  await first.bar.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('crop-tool')).toHaveCount(0);

  const second = await openCrop(page);
  await expectEdge(second.bar, 'right', second.stage.right - MARGIN);
  await expectEdge(second.bar, 'bottom', second.stage.bottom - MARGIN);

  // A corner stays a corner when the window changes size.
  await page.setViewportSize({ width: 1100, height: 680 });
  const smaller = await edgesOf(page.getByTestId('crop-tool'));
  expect(smaller.right - smaller.left).toBeLessThan(second.stage.right - second.stage.left);
  await expectEdge(second.bar, 'right', smaller.right - MARGIN);
  await expectEdge(second.bar, 'bottom', smaller.bottom - MARGIN);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('crop-tool')).toHaveCount(0);

  await openPhoto(page);
  const third = await openCrop(page);
  await expectEdge(third.bar, 'right', third.stage.right - MARGIN);
  await expectEdge(third.bar, 'bottom', third.stage.bottom - MARGIN);
});
