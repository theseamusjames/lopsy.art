/**
 * The `history` commands (src/commands/history/history.ts).
 */
import { test, expect, run, runError, compareUiAndApi, type Page } from './harness';
import { undo, redo } from '../helpers';
import { brushStroke, fillRect, historyLabels, redoLabels } from '../surface-helpers';
import { docPixelHash } from '../surface-helpers-filters';

interface NewDocumentResult {
  layers: Array<{ id: string; name: string }>;
  activeLayer: string;
}

interface HistoryLabels {
  undo: string[];
  redo: string[];
}

const RED = { r: 255, g: 0, b: 0 };
const BLUE = { r: 0, g: 0, b: 255 };

async function strokeAndFill(page: Page): Promise<void> {
  await brushStroke(page, [{ x: 30, y: 40 }, { x: 150, y: 90 }], RED);
  await fillRect(page, 100, 20, 160, 70, BLUE);
  await page.keyboard.press('Control+d');
}

async function newDocument(page: Page): Promise<string> {
  const result = await run<NewDocumentResult>(page, { op: 'doc.new', width: 200, height: 150 });
  return result.activeLayer;
}

test.describe('history.undo and history.redo', () => {
  test('undo and redo restore the pixels of a brush stroke made through the UI', async ({ page }) => {
    const layerId = await newDocument(page);
    const blank = await docPixelHash(page, layerId);
    await brushStroke(page, [{ x: 30, y: 40 }, { x: 150, y: 90 }], RED);
    const painted = await docPixelHash(page, layerId);
    expect(painted).not.toBe(blank);
    const before = await historyLabels(page);

    const undone = await run<HistoryLabels>(page, { op: 'history.undo' });
    expect(undone).toEqual({ undo: before.slice(0, -1), redo: before.slice(-1) });
    expect(await docPixelHash(page, layerId)).toBe(blank);

    const redone = await run<HistoryLabels>(page, { op: 'history.redo' });
    expect(redone).toEqual({ undo: before, redo: [] });
    expect(await docPixelHash(page, layerId)).toBe(painted);
  });

  test('several steps at once restore the pixels of a fill and a stroke', async ({ page }) => {
    const layerId = await newDocument(page);
    const blank = await docPixelHash(page, layerId);
    await strokeAndFill(page);
    const painted = await docPixelHash(page, layerId);
    const labels = await historyLabels(page);
    const steps = labels.length - 1;

    const undone = await run<HistoryLabels>(page, { op: 'history.undo', steps });
    expect(undone.undo).toEqual(['New Document']);
    expect(await docPixelHash(page, layerId)).toBe(blank);

    const redone = await run<HistoryLabels>(page, { op: 'history.redo', steps });
    expect(redone).toEqual({ undo: labels, redo: [] });
    expect(await docPixelHash(page, layerId)).toBe(painted);
  });

  test('history.undo matches Cmd+Z after a stroke and a fill', async ({ page }) => {
    await compareUiAndApi(page, {
      setup: strokeAndFill,
      viaUi: (p) => undo(p),
      viaApi: async (p) => {
        await run(p, { op: 'history.undo' });
      },
    });
  });

  test('history.undo with steps matches repeated Cmd+Z, and history.redo matches Cmd+Shift+Z', async ({ page }) => {
    const { api } = await compareUiAndApi(page, {
      setup: strokeAndFill,
      viaUi: async (p) => {
        await undo(p);
        await undo(p);
        await undo(p);
        await redo(p);
      },
      viaApi: async (p) => {
        await run(p, { op: 'history.undo', steps: 3 });
        await run(p, { op: 'history.redo' });
      },
    });
    expect(api.history.redo).toHaveLength(2);
  });

  test('on a fresh document undo pops "New Document", as Cmd+Z does', async ({ page }) => {
    const { api } = await compareUiAndApi(page, {
      viaUi: (p) => undo(p),
      viaApi: async (p) => {
        await run(p, { op: 'history.undo' });
      },
    });
    expect(api.history).toEqual({ undo: [], redo: ['New Document'] });
  });
});

test.describe('history refusals', () => {
  test('undo with nothing to undo is refused', async ({ page }) => {
    await newDocument(page);
    await run(page, { op: 'history.undo' });
    expect(await runError(page, { op: 'history.undo' })).toEqual({ code: 'refused', message: 'Nothing to undo.' });
    expect(await redoLabels(page)).toEqual(['New Document']);
  });

  test('redo with nothing to redo is refused', async ({ page }) => {
    await newDocument(page);
    expect(await runError(page, { op: 'history.redo' })).toEqual({ code: 'refused', message: 'Nothing to redo.' });
    expect(await historyLabels(page)).toEqual(['New Document']);
  });

  test('more steps than the history holds are refused, saying how many there are', async ({ page }) => {
    await newDocument(page);
    await brushStroke(page, [{ x: 30, y: 40 }, { x: 150, y: 90 }], RED);
    const labels = await historyLabels(page);
    const asked = labels.length + 1;
    expect(await runError(page, { op: 'history.undo', steps: asked })).toEqual({
      code: 'refused',
      message: `Only ${labels.length} steps to undo; asked for ${asked}.`,
    });
    expect(await historyLabels(page)).toEqual(labels);

    await run(page, { op: 'history.undo' });
    expect(await runError(page, { op: 'history.redo', steps: 2 })).toEqual({
      code: 'refused',
      message: 'Only 1 step to redo; asked for 2.',
    });
  });

  test('steps must be a positive integer', async ({ page }) => {
    await newDocument(page);
    for (const op of ['history.undo', 'history.redo']) {
      for (const steps of [0, 1.5, 'all']) {
        const error = await runError(page, { op, steps });
        expect(error.code).toBe('invalid');
        expect(error.message).toMatch(new RegExp(`^${op.replace('.', '\\.')}: steps must be an integer >= 1, got`));
      }
    }
    expect(await historyLabels(page)).toEqual(['New Document']);
  });

  test('undo and redo are unavailable before any document is open', async ({ page }) => {
    for (const op of ['history.undo', 'history.redo']) {
      const error = await runError(page, { op });
      expect(error.code).toBe('unavailable');
    }
  });
});
