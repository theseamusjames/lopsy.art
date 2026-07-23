import type { Page } from './fixtures';
import { docToScreen } from './helpers';

/** Live text-editing state, or null if not editing. */
export interface TextEditingSnapshot {
  layerId: string;
  text: string;
  cursorPos: number;
  selectionAnchor: number | null;
  bounds: { x: number; y: number; width: number | null; height: number | null };
}

export async function getTextEditing(page: Page): Promise<TextEditingSnapshot | null> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { textEditing: TextEditingSnapshot | null };
    };
    return store.getState().textEditing;
  }) as Promise<TextEditingSnapshot | null>;
}

export async function selectTextTool(page: Page): Promise<void> {
  await page.keyboard.press('t');
}

export async function clickAtDoc(page: Page, docX: number, docY: number): Promise<void> {
  const pos = await docToScreen(page, docX, docY);
  await page.mouse.click(pos.x, pos.y);
  await page.waitForTimeout(80);
}

export async function doubleClickAtDoc(page: Page, docX: number, docY: number): Promise<void> {
  const pos = await docToScreen(page, docX, docY);
  await page.mouse.dblclick(pos.x, pos.y);
  await page.waitForTimeout(80);
}

export async function dragAtDoc(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  const start = await docToScreen(page, from.x, from.y);
  const end = await docToScreen(page, to.x, to.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(80);
}

/** Document-space rect of the layer currently being edited, from its GPU texture. */
export async function getEditingLayerRect(
  page: Page,
): Promise<{ x: number; y: number; width: number; height: number }> {
  return page.evaluate(async () => {
    const ui = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { textEditing: { layerId: string } | null };
    };
    const ed = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; x: number; y: number }> } };
    };
    const read = (window as unknown as Record<string, unknown>).__readLayerPixels as (
      id?: string,
    ) => Promise<{ width: number; height: number }>;
    const id = ui.getState().textEditing!.layerId;
    const layer = ed.getState().document.layers.find((l) => l.id === id)!;
    const { width, height } = await read(id);
    return { x: layer.x, y: layer.y, width, height };
  });
}

/** Create a point-text layer at (docX, docY) and type `text`, staying in edit mode. */
export async function typeTextAt(page: Page, docX: number, docY: number, text: string): Promise<void> {
  await selectTextTool(page);
  await clickAtDoc(page, docX, docY);
  await page.keyboard.type(text);
  await page.waitForTimeout(80);
}
