/**
 * Shared helpers for the `surface-*` characterization specs.
 *
 * Those specs pin what each UI surface (menu item, key, Layers-panel button)
 * does TODAY, so that moving the surfaces onto a command registry can be
 * checked against them. Every helper here either drives the real UI or only
 * READS state for assertions; none performs an operation through a store.
 *
 * Menus
 *   clickMenu(page, top, item, sub?)   Click Top > Item (> Sub) in the menu bar.
 *                                      A disabled item swallows the click and
 *                                      leaves its menu open; pass
 *                                      `{ expectClosed: false }` and call
 *                                      closeMenus() afterwards in that case.
 *   menuItem(page, top, item)          Open Top and return the item locator
 *                                      (the menu is left open).
 *   isMenuItemDisabled(page, top, item) Open Top, read `aria-disabled`, close it.
 *   clickDisabledMenuItem(page, top, item) Assert aria-disabled, click it with the
 *                                      mouse, assert the menu stayed open, close it.
 *   closeMenus(page)                   Escape, which only closes a dropdown.
 *
 * Reads (for assertions only)
 *   historyLabels(page)                Undo-stack labels, oldest first.
 *   redoLabels(page)                   Redo-stack labels.
 *   topHistoryLabel(page)              Last undo-stack label, or null.
 *   toasts(page)                       Messages of the rendered toasts.
 *   openDialogName(page)               aria-label of the open role="dialog", or null.
 *   openDialogNames(page)              Every open role="dialog" aria-label.
 *   layerPixelHash(page, layerId?)     FNV-1a over a layer's size, offset and pixels.
 *   surfaceState(page)                 One typed snapshot of document, selection,
 *                                      transform, float, clipboard, tool, modal.
 *
 * UI-driven setup
 *   openDocument(page, w?, h?, transparent?)  goto + createDocument (default 200x150).
 *   dragOnCanvas(page, from, to)       Real mouse drag in document coordinates.
 *   dragMarquee(page, x0, y0, x1, y1)  Rectangular Marquee drag.
 *   fillRect(page, x0, y0, x1, y1, rgb) Foreground colour + marquee + Edit > Fill
 *                                      (the marquee stays up).
 *   brushStroke(page, points, rgb?)    Brush tool drag through `points`.
 *   floatSelection(page, from, to)     Move-tool drag of the current selection,
 *                                      which leaves a live Move float.
 *   startTextEditing(page, x, y, text) Text tool click + typing, left uncommitted.
 *   settle(page)                       Short wait for React/engine to catch up.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import {
  createDocument,
  docToScreen,
  selectTool,
  setForegroundColor,
  waitForStore,
} from './helpers';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface SurfaceLayer {
  id: string;
  name: string;
  type: string;
  locked: boolean;
  visible: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Child ids for a group, bottom to top; null for other layers. */
  children: string[] | null;
}

export interface SurfaceState {
  docWidth: number;
  docHeight: number;
  layers: SurfaceLayer[];
  layerOrder: string[];
  /** Layer names in `layerOrder` order (bottom to top). */
  orderNames: string[];
  activeLayerId: string | null;
  activeLayerName: string | null;
  rootGroupId: string | null;
  selectedLayerIds: string[];
  selection: { active: boolean; bounds: Rect | null };
  /** `ui.transform` is non-null (marquee/Move transform handles). */
  hasTransform: boolean;
  /** `ui.layerTransform` is non-null (multi-layer transform). */
  hasLayerTransform: boolean;
  /** The engine holds a floating selection (a Move float or prefloat). */
  hasFloat: boolean;
  clipboard: { width: number; height: number; offsetX: number; offsetY: number } | null;
  activeTool: string;
  textEditing: boolean;
  modalKind: string | null;
  showEffectsDrawer: boolean;
  maskEditMode: boolean;
  pathCount: number;
  guideCount: number;
  undoLength: number;
  redoLength: number;
}

const SETTLE_MS = 150;

export async function settle(page: Page, ms = SETTLE_MS): Promise<void> {
  await page.waitForTimeout(ms);
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

export async function openDocument(page: Page, width = 200, height = 150, transparent = false): Promise<void> {
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, width, height, transparent);
  await page.waitForSelector('[data-testid="canvas-container"]');
  await settle(page, 300);
}

// ---------------------------------------------------------------------------
// Menus
// ---------------------------------------------------------------------------

function menuBar(page: Page): Locator {
  return page.locator('nav[aria-label="Application menu"]');
}

function dropdown(page: Page, top: string): Locator {
  return page.locator(`[role="menu"][aria-label="${top}"]`);
}

async function openTopMenu(page: Page, top: string): Promise<Locator> {
  const menu = dropdown(page, top);
  if (!(await menu.isVisible())) {
    await menuBar(page).getByRole('button', { name: top, exact: true }).click();
  }
  await expect(menu).toBeVisible();
  return menu;
}

/** Open `top` and return the locator of `item` in it. The menu stays open. */
export async function menuItem(page: Page, top: string, item: string): Promise<Locator> {
  const menu = await openTopMenu(page, top);
  return menu.getByRole('menuitem', { name: item, exact: true });
}

export interface ClickMenuOptions {
  /**
   * Whether the dropdown must be closed after the click (default true). An
   * enabled item closes it; a disabled one leaves it open.
   */
  expectClosed?: boolean;
}

/** Click Top > Item, or Top > Item > Sub for a submenu, through the real menu bar. */
export async function clickMenu(
  page: Page,
  top: string,
  item: string,
  sub?: string,
  options: ClickMenuOptions = {},
): Promise<void> {
  const target = await menuItem(page, top, item);
  if (sub === undefined) {
    await target.click();
  } else {
    await target.hover();
    const flyout = page.locator(`[role="menu"][aria-label="${item}"]`);
    await expect(flyout).toBeVisible();
    await flyout.getByRole('menuitem', { name: sub, exact: true }).click();
  }
  if (options.expectClosed ?? true) {
    await expect(dropdown(page, top)).toHaveCount(0);
  }
  await settle(page);
}

export async function closeMenus(page: Page): Promise<void> {
  if ((await page.locator('nav[aria-label="Application menu"] [role="menu"]').count()) === 0) return;
  await page.keyboard.press('Escape');
  await expect(page.locator('nav[aria-label="Application menu"] [role="menu"]')).toHaveCount(0);
}

/**
 * Open `top`, check `item` is aria-disabled, click it with the real mouse
 * (Playwright's own click refuses aria-disabled targets), check the dropdown
 * stayed open as a swallowed click leaves it, and close it again.
 */
export async function clickDisabledMenuItem(page: Page, top: string, item: string): Promise<void> {
  const target = await menuItem(page, top, item);
  await expect(target).toHaveAttribute('aria-disabled', 'true');
  const box = await target.boundingBox();
  if (!box) throw new Error(`${top} > ${item} has no box`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await settle(page);
  await expect(dropdown(page, top)).toBeVisible();
  await closeMenus(page);
}

/** Open `top`, read whether `item` is aria-disabled, and close the menu again. */
export async function isMenuItemDisabled(page: Page, top: string, item: string): Promise<boolean> {
  const target = await menuItem(page, top, item);
  await expect(target).toHaveCount(1);
  const value = await target.getAttribute('aria-disabled');
  await closeMenus(page);
  return value === 'true';
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function historyLabels(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { undoStack: Array<{ label: string }> };
    };
    return store.getState().undoStack.map((s) => s.label);
  });
}

export async function redoLabels(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { redoStack: Array<{ label: string }> };
    };
    return store.getState().redoStack.map((s) => s.label);
  });
}

export async function topHistoryLabel(page: Page): Promise<string | null> {
  const labels = await historyLabels(page);
  return labels.at(-1) ?? null;
}

/** The messages of the toasts on screen, oldest first. */
export async function toasts(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const container of Array.from(document.querySelectorAll('[role="status"][aria-live="polite"]'))) {
      for (const toast of Array.from(container.children)) {
        if (!toast.querySelector('button[aria-label="Dismiss"]')) continue;
        const message = toast.querySelector('span');
        if (message?.textContent) out.push(message.textContent);
      }
    }
    return out;
  });
}

export async function openDialogNames(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[role="dialog"]'))
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
      })
      .map((el) => el.getAttribute('aria-label') ?? ''),
  );
}

export async function openDialogName(page: Page): Promise<string | null> {
  const names = await openDialogNames(page);
  return names[0] ?? null;
}

/**
 * A stable hash of a layer's GPU pixels, its texture size and its document
 * offset. Two layers with the same content at the same place hash alike.
 */
export async function layerPixelHash(page: Page, layerId?: string): Promise<string> {
  return page.evaluate(async (id) => {
    const w = window as unknown as Record<string, unknown>;
    const store = w.__editorStore as {
      getState: () => { document: { activeLayerId: string | null; layers: Array<{ id: string; x: number; y: number }> } };
    };
    const read = w.__readLayerPixels as (id?: string) => Promise<{ width: number; height: number; pixels: ArrayLike<number> } | null>;
    const doc = store.getState().document;
    const target = id ?? doc.activeLayerId ?? undefined;
    const result = await read(target);
    const layer = doc.layers.find((l) => l.id === target);
    let h = 0x811c9dc5;
    const mix = (v: number): void => {
      h ^= v & 0xff;
      h = Math.imul(h, 0x01000193) >>> 0;
    };
    const head = [result?.width ?? 0, result?.height ?? 0, layer?.x ?? 0, layer?.y ?? 0];
    for (const v of head) for (let s = 0; s < 32; s += 8) mix((v >> s) & 0xff);
    const px = result?.pixels;
    if (px) for (let i = 0; i < px.length; i++) mix(px[i] ?? 0);
    return `${head.join('x')}:${h.toString(16).padStart(8, '0')}`;
  }, layerId ?? null);
}

export async function surfaceState(page: Page): Promise<SurfaceState> {
  return page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    type L = {
      id: string; name: string; type: string; locked?: boolean; visible: boolean;
      x: number; y: number; width: number; height: number; children?: string[];
    };
    const editor = (w.__editorStore as {
      getState: () => {
        document: {
          width: number; height: number; layers: L[]; layerOrder: string[];
          activeLayerId: string | null; rootGroupId: string | null; selectedLayerIds: string[];
        };
        selection: { active: boolean; bounds: { x: number; y: number; width: number; height: number } | null };
        clipboard: { width: number; height: number; offsetX: number; offsetY: number } | null;
        paths: unknown[];
        undoStack: unknown[];
        redoStack: unknown[];
      };
    }).getState();
    const ui = (w.__uiStore as {
      getState: () => {
        transform: unknown; layerTransform: unknown; activeTool: string; textEditing: unknown;
        modal: { kind: string } | null; showEffectsDrawer: boolean; maskEditMode: boolean; guides: unknown[];
      };
    }).getState();
    const bridge = w.__wasmBridge as { hasFloat: (engine: unknown) => boolean } | undefined;
    const engine = (w.__engineState as { getEngine: () => unknown } | undefined)?.getEngine();
    const doc = editor.document;
    const byId = new Map(doc.layers.map((l) => [l.id, l]));
    const active = doc.activeLayerId ? byId.get(doc.activeLayerId) : undefined;
    const clip = editor.clipboard;
    return {
      docWidth: doc.width,
      docHeight: doc.height,
      layers: doc.layers.map((l) => ({
        id: l.id, name: l.name, type: l.type, locked: !!l.locked, visible: l.visible,
        x: l.x, y: l.y, width: l.width, height: l.height,
        children: l.type === 'group' ? [...(l.children ?? [])] : null,
      })),
      layerOrder: [...doc.layerOrder],
      orderNames: doc.layerOrder.map((id) => byId.get(id)?.name ?? '?'),
      activeLayerId: doc.activeLayerId,
      activeLayerName: active?.name ?? null,
      rootGroupId: doc.rootGroupId,
      selectedLayerIds: [...doc.selectedLayerIds],
      selection: {
        active: editor.selection.active,
        bounds: editor.selection.active && editor.selection.bounds ? { ...editor.selection.bounds } : null,
      },
      hasTransform: ui.transform != null,
      hasLayerTransform: ui.layerTransform != null,
      hasFloat: !!(bridge && engine && bridge.hasFloat(engine)),
      clipboard: clip ? { width: clip.width, height: clip.height, offsetX: clip.offsetX, offsetY: clip.offsetY } : null,
      activeTool: ui.activeTool,
      textEditing: ui.textEditing != null,
      modalKind: ui.modal?.kind ?? null,
      showEffectsDrawer: ui.showEffectsDrawer,
      maskEditMode: ui.maskEditMode,
      pathCount: editor.paths.length,
      guideCount: ui.guides.length,
      undoLength: editor.undoStack.length,
      redoLength: editor.redoStack.length,
    };
  });
}

// ---------------------------------------------------------------------------
// UI-driven setup
// ---------------------------------------------------------------------------

export async function dragOnCanvas(page: Page, from: Point, to: Point, steps = 10): Promise<void> {
  const start = await docToScreen(page, from.x, from.y);
  const end = await docToScreen(page, to.x, to.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps });
  await page.mouse.up();
  await settle(page);
}

export async function dragMarquee(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  await selectTool(page, 'marquee-rect');
  await dragOnCanvas(page, { x: x0, y: y0 }, { x: x1, y: y1 }, 8);
}

/** Fill the rect with `rgb` on the active layer: marquee + Edit > Fill. The marquee stays up. */
export async function fillRect(page: Page, x0: number, y0: number, x1: number, y1: number, rgb: Rgb): Promise<void> {
  await setForegroundColor(page, rgb.r, rgb.g, rgb.b);
  await dragMarquee(page, x0, y0, x1, y1);
  await clickMenu(page, 'Edit', 'Fill');
}

export async function brushStroke(page: Page, points: readonly Point[], rgb?: Rgb): Promise<void> {
  if (points.length < 2) throw new Error('brushStroke needs at least two points');
  if (rgb) await setForegroundColor(page, rgb.r, rgb.g, rgb.b);
  await selectTool(page, 'brush');
  const first = await docToScreen(page, points[0]!.x, points[0]!.y);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const p of points.slice(1)) {
    const s = await docToScreen(page, p.x, p.y);
    await page.mouse.move(s.x, s.y, { steps: 6 });
  }
  await page.mouse.up();
  await settle(page);
}

/** Move-tool drag from `from` to `to`; with a selection this leaves a live Move float. */
export async function floatSelection(page: Page, from: Point, to: Point): Promise<void> {
  await selectTool(page, 'move');
  await dragOnCanvas(page, from, to);
}

/** Click the Text tool at doc (x, y) and type `text`, leaving the edit open. */
export async function startTextEditing(page: Page, x: number, y: number, text: string): Promise<void> {
  await selectTool(page, 'text');
  const at = await docToScreen(page, x, y);
  await page.mouse.click(at.x, at.y);
  await settle(page);
  await page.keyboard.type(text);
  await settle(page);
}
