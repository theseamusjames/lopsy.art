/**
 * Helpers for the keyboard and Layers-panel characterization specs
 * (`surface-keys-*.spec.ts`, `surface-panel-layers.spec.ts`). Like
 * `surface-helpers.ts`, each one either drives the real UI or only READS
 * state for assertions.
 *
 *   blurFocus(page)                    Drop focus to <body>, so a global key reaches
 *                                      the window handler with no focused control.
 *   pressKey(page, key)                blurFocus + keyboard.press + settle.
 *   focusedLabel(page)                 aria-label of document.activeElement, or null.
 *   layerByName(state, name)           The layer named `name` in a SurfaceState.
 *   clickLayerRow(page, id, mods?)     Click a Layers-panel row (optionally with modifiers).
 *   rowButton(page, id, name)          A named button inside a layer row.
 *   viewport(page)                     { zoom, panX, panY, width, height }.
 *   canvasClientSize(page)             The WebGL canvas's integer clientWidth/Height.
 *   gridFlags(page)                    { showGrid, snapToGrid, showGuides, gridSize }.
 *   colors(page)                       Foreground and background colours.
 *   maskMode(page)                     'off' | 'layerMask' | 'quickMask'.
 *   textEdit(page)                     { layerId, text, cursorPos, selectionAnchor } or null.
 *   toolSizes(page)                    Brush / pencil / eraser size, path / shape stroke width.
 *   rootAdjustments(page)              The root group's adjustment node types.
 *   layerExtras(page, id)              opacity, mask presence and locked flag of one layer.
 *   panWithSpace(page, dx, dy)         Hold Space and drag the canvas.
 *   watchPasteEvents(page)             Count native `paste` events from now on.
 *   pasteEventCount(page)              Read that count.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { settle, type SurfaceState } from './surface-helpers';

export async function blurFocus(page: Page): Promise<void> {
  await page.evaluate(() => {
    const el = document.activeElement;
    if (el instanceof HTMLElement && el !== document.body) el.blur();
  });
}

export async function pressKey(page: Page, key: string, settleMs?: number): Promise<void> {
  await blurFocus(page);
  await page.keyboard.press(key);
  await settle(page, settleMs);
}

export async function focusedLabel(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    return el.getAttribute('aria-label') ?? el.tagName;
  });
}

export function layerByName(s: SurfaceState, name: string): SurfaceState['layers'][number] {
  const layer = s.layers.find((l) => l.name === name);
  if (!layer) throw new Error(`no layer named ${name}: ${s.layers.map((l) => l.name).join(', ')}`);
  return layer;
}

export async function clickLayerRow(
  page: Page,
  layerId: string,
  modifiers?: Array<'ControlOrMeta' | 'Shift' | 'Alt'>,
): Promise<void> {
  await page.locator(`[data-layer-id="${layerId}"]`).click({ modifiers });
  await settle(page);
}

export function rowButton(page: Page, layerId: string, name: string): Locator {
  return page.locator(`[data-layer-id="${layerId}"]`).getByRole('button', { name, exact: true });
}

export interface Viewport {
  zoom: number;
  panX: number;
  panY: number;
  width: number;
  height: number;
}

export async function viewport(page: Page): Promise<Viewport> {
  return page.evaluate(() => {
    const v = ((window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { viewport: { zoom: number; panX: number; panY: number; width: number; height: number } };
    }).getState().viewport;
    return { zoom: v.zoom, panX: v.panX, panY: v.panY, width: v.width, height: v.height };
  });
}

/** The main (non-overlay) canvas's clientWidth/clientHeight, which Cmd+0 reads. */
export async function canvasClientSize(page: Page): Promise<{ width: number; height: number }> {
  return page.evaluate(() => {
    const container = document.querySelector('[data-testid="canvas-container"]');
    const canvas = Array.from(container?.querySelectorAll('canvas') ?? []).find((c) => !/overlayCanvas/.test(c.className));
    if (!canvas) throw new Error('no main canvas');
    return { width: canvas.clientWidth, height: canvas.clientHeight };
  });
}

export async function containerRect(page: Page): Promise<{ width: number; height: number }> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="canvas-container"]');
    if (!el) throw new Error('no canvas container');
    const r = el.getBoundingClientRect();
    return { width: r.width, height: r.height };
  });
}

export interface GridFlags {
  showGrid: boolean;
  snapToGrid: boolean;
  showGuides: boolean;
  gridSize: number;
}

export async function gridFlags(page: Page): Promise<GridFlags> {
  return page.evaluate(() => {
    const ui = ((window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => GridFlags;
    }).getState();
    return { showGrid: ui.showGrid, snapToGrid: ui.snapToGrid, showGuides: ui.showGuides, gridSize: ui.gridSize };
  });
}

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export async function colors(page: Page): Promise<{ fg: Rgba; bg: Rgba }> {
  return page.evaluate(() => {
    const ts = ((window as unknown as Record<string, unknown>).__toolSettingsStore as {
      getState: () => { foregroundColor: Rgba; backgroundColor: Rgba };
    }).getState();
    return { fg: { ...ts.foregroundColor }, bg: { ...ts.backgroundColor } };
  });
}

export async function maskMode(page: Page): Promise<string> {
  return page.evaluate(() =>
    ((window as unknown as Record<string, unknown>).__uiStore as { getState: () => { maskMode: string } }).getState().maskMode,
  );
}

export interface TextEditSnapshot {
  layerId: string;
  text: string;
  cursorPos: number;
  selectionAnchor: number | null;
}

export async function textEdit(page: Page): Promise<TextEditSnapshot | null> {
  return page.evaluate(() => {
    const t = ((window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { textEditing: { layerId: string; text: string; cursorPos: number; selectionAnchor: number | null } | null };
    }).getState().textEditing;
    return t ? { layerId: t.layerId, text: t.text, cursorPos: t.cursorPos, selectionAnchor: t.selectionAnchor } : null;
  });
}

export interface ToolSizes {
  brush: number;
  pencil: number;
  eraser: number;
  pathStroke: number;
  shapeStroke: number;
}

export async function toolSizes(page: Page): Promise<ToolSizes> {
  return page.evaluate(() => {
    const s = ((window as unknown as Record<string, unknown>).__toolSettingsStore as {
      getState: () => { settings: {
        brush: { size: number }; pencil: { size: number }; eraser: { size: number };
        path: { strokeWidth: number }; shape: { strokeWidth: number };
      } };
    }).getState().settings;
    return {
      brush: s.brush.size, pencil: s.pencil.size, eraser: s.eraser.size,
      pathStroke: s.path.strokeWidth, shapeStroke: s.shape.strokeWidth,
    };
  });
}

/** The adjustment node types on the root group, in order. */
export async function rootAdjustments(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const doc = ((window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { rootGroupId: string | null; layers: Array<{ id: string; adjustments?: Array<{ type: string }> }> } };
    }).getState().document;
    const root = doc.layers.find((l) => l.id === doc.rootGroupId);
    return (root?.adjustments ?? []).map((a) => a.type);
  });
}

export interface LayerExtras {
  opacity: number;
  hasMask: boolean;
  locked: boolean;
  text: string | null;
}

export async function layerExtras(page: Page, layerId: string): Promise<LayerExtras> {
  return page.evaluate((id) => {
    const doc = ((window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; opacity: number; mask: unknown; locked?: boolean; text?: string }> } };
    }).getState().document;
    const l = doc.layers.find((x) => x.id === id);
    if (!l) throw new Error(`no layer ${id}`);
    return { opacity: l.opacity, hasMask: l.mask != null, locked: !!l.locked, text: typeof l.text === 'string' ? l.text : null };
  }, layerId);
}

export async function panWithSpace(page: Page, dx: number, dy: number): Promise<void> {
  const box = await page.locator('[data-testid="canvas-container"]').boundingBox();
  if (!box) throw new Error('no canvas container');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await blurFocus(page);
  await page.mouse.move(x, y);
  await page.keyboard.down('Space');
  await settle(page, 50);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Space');
  await settle(page);
}

export async function watchPasteEvents(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as Record<string, number>;
    w.__surfacePasteEvents = 0;
    window.addEventListener('paste', () => { w.__surfacePasteEvents = (w.__surfacePasteEvents ?? 0) + 1; }, true);
  });
}

export async function pasteEventCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as Record<string, number>).__surfacePasteEvents ?? 0);
}

/** Write a solid-colour PNG to the system clipboard, as another app would. Needs clipboard-write. */
export async function putExternalImageOnClipboard(page: Page, width: number, height: number, css: string): Promise<void> {
  const result = await page.evaluate(async ({ w, h, css }) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    if (!g) return 'no 2d context';
    g.fillStyle = css;
    g.fillRect(0, 0, w, h);
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'));
    if (!blob) return 'no blob';
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return 'ok';
    } catch (e) {
      return String(e);
    }
  }, { w: width, h: height, css });
  expect(result).toBe('ok');
}
