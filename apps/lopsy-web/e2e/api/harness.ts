/**
 * Harness for the command-API specs in `e2e/api/`.
 *
 * These specs are the documented exception to "drive the UI, never the
 * store": they call the command API on `window.__lopsyCommands` (installed
 * by `src/dev-hooks.ts` in dev builds), and comparison specs check that a
 * command leaves the document exactly as the matching UI action does.
 *
 * They run on two pages: the editor ('/', the chromium project) and the
 * agent page ('/agent/', the agent project, the `apiPage` option). The
 * agent page has no editor UI, so there a test is skipped, with the reason,
 * at the first UI step it takes: compareUiAndApi, or a member of `page`
 * that drives or reads the UI (keyboard, mouse, a locator other than the
 * canvas container).
 *
 *   test, expect                   The shared fixtures (console-error guard,
 *                                  layer readers, wgpu waits), plus an
 *                                  automatic step that opens the project's
 *                                  page and waits for the command API. No
 *                                  document is created: `doc.new` is under
 *                                  test.
 *   run(page, invocation | [...])  Run one command or a batch. A refusal
 *                                  rejects with an ApiError {code, message},
 *                                  plus `result` for 'unsettled' and
 *                                  `completed` (earlier steps' results) for
 *                                  a batch; anything else the page throws is a plain
 *                                  Error and fails the test.
 *   runError(page, invocation)     Run expecting a CommandError; returns it.
 *   describe(page, surface?)       The registry's command descriptions.
 *   snapshot(page)                 A JSON picture of the document with no
 *                                  ids or times in it, for toEqual: layers
 *                                  (with group adjustment nodes), selection,
 *                                  history, paths (anchor points), guides,
 *                                  a hash of the export composite, and the
 *                                  active tool and colours.
 *   editorState(page)              The active tool and the colours.
 *   compositeHash(page)            Hash of the export composite.
 *   compareUiAndApi(page, {...})   Run one operation through the UI and
 *                                  through a command on identical fresh
 *                                  documents and assert the snapshots match.
 */
import type { Page } from '@playwright/test';
import { expect, test as base } from '../fixtures';
import { createDocument } from '../helpers';
import { settle } from '../surface-helpers';
import { docPixelHash } from '../surface-helpers-filters';
import { settleEngine } from '../parity';

export { expect };
export type { Page };

export interface Invocation {
  readonly op: string;
  readonly [param: string]: unknown;
}

export interface CommandErrorInfo {
  code: string;
  message: string;
}

interface CommandErrorPayload extends CommandErrorInfo {
  /** With code 'unsettled': what the command returned, since its work was done. */
  result?: unknown;
  /** From a list of invocations: the results of the steps that completed before the failure. */
  completed?: unknown[];
}

/** A command's refusal (a CommandError in the page), carried into Node. */
export class ApiError extends Error {
  readonly code: string;
  readonly result?: unknown;
  readonly completed?: unknown[];

  constructor({ code, message, result, completed }: CommandErrorPayload) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    if (result !== undefined) this.result = result;
    if (completed !== undefined) this.completed = completed;
  }
}

export interface ApiParamDescription {
  type: string;
  optional?: boolean;
  default?: unknown;
  description?: string;
  min?: number;
  max?: number;
  integer?: boolean;
  enum?: string[];
  minLength?: number;
  maxLength?: number;
  items?: ApiParamDescription;
  minItems?: number;
  maxItems?: number;
  fields?: Record<string, ApiParamDescription>;
}

export interface ApiCommandDescription {
  id: string;
  summary: string;
  surface: 'document' | 'ui';
  params: Record<string, ApiParamDescription>;
}

interface CommandsWindow {
  __lopsyCommands?: {
    describe: (surface?: string) => ApiCommandDescription[];
    run: (invocation: unknown) => Promise<unknown>;
  };
}

type Outcome =
  | { ok: true; result: unknown }
  | { ok: false; error: { isCommandError: true } & CommandErrorPayload }
  | { ok: false; error: { isCommandError: false; message: string } };

export interface ApiOptions {
  /**
   * The page the specs run on: '/' (the editor) or '/agent/' (the agent
   * page, the canvas alone), set by the Playwright project.
   */
  apiPage: string;
}

const EDITOR_PAGE = '/';

/** The page each test's `page` opened, so compareUiAndApi can tell the agent page. */
const openedPages = new WeakMap<Page, string>();

/**
 * Members of Page that drive or read the editor's UI. The agent page has
 * none, so a test that reaches for one is skipped there at that point,
 * after the API steps before it have run.
 */
const UI_MEMBERS = new Set<PropertyKey>([
  'keyboard', 'mouse', 'touchscreen',
  'click', 'dblclick', 'fill', 'press', 'type', 'hover', 'tap', 'check', 'uncheck', 'setChecked',
  'selectOption', 'setInputFiles', 'dragAndDrop', 'focus', 'dispatchEvent',
  'getByRole', 'getByText', 'getByLabel', 'getByPlaceholder', 'getByAltText', 'getByTitle', 'getByTestId',
  'frameLocator', '$eval', '$$eval',
]);
/** Members taking a selector, allowed for the one element both pages have: the canvas container. */
const SELECTOR_MEMBERS = new Set<PropertyKey>(['locator', 'waitForSelector', '$', '$$']);
const CANVAS_CONTAINER = '[data-testid="canvas-container"]';

function skipUiOnly(what: string): never {
  test.info().skip(true, `UI-only: uses ${what}, and the agent page has no editor UI`);
  throw new Error('unreachable: testInfo.skip throws');
}

/** The page, refusing (by skipping the test) every member that needs the editor's UI. */
function withoutUi(page: Page): Page {
  return new Proxy(page, {
    get(target, prop) {
      if (UI_MEMBERS.has(prop)) skipUiOnly(`page.${String(prop)}`);
      const value: unknown = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      if (!SELECTOR_MEMBERS.has(prop)) return value.bind(target);
      return (selector: unknown, ...rest: unknown[]) => {
        if (selector !== CANVAS_CONTAINER) skipUiOnly(`page.${String(prop)}(${JSON.stringify(selector)})`);
        return (value as (...args: unknown[]) => unknown).call(target, selector, ...rest);
      };
    },
  });
}

export const test = base.extend<ApiOptions & { _commandApi: void }>({
  apiPage: [EDITOR_PAGE, { option: true }],
  page: async ({ page, apiPage }, use) => {
    await use(apiPage === EDITOR_PAGE ? page : withoutUi(page));
  },
  _commandApi: [
    // Depends on the init-script fixtures so their scripts are in place before the page loads.
    async ({ page, apiPage, _layerImageReader, _settledWaits }, use) => {
      void _layerImageReader;
      void _settledWaits;
      openedPages.set(page, apiPage);
      await openCommandApi(page, apiPage);
      await use();
    },
    { auto: true },
  ],
});

async function openCommandApi(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => !!(window as unknown as CommandsWindow).__lopsyCommands);
}

/**
 * Errors lose their own fields crossing page.evaluate, so the page catches
 * and reports what it caught, and Node rethrows it.
 */
export async function run<T = unknown>(page: Page, invocation: Invocation | readonly Invocation[]): Promise<T> {
  const outcome = await page.evaluate(async (payload): Promise<Outcome> => {
    const api = (window as unknown as CommandsWindow).__lopsyCommands;
    if (!api) return { ok: false, error: { isCommandError: false, message: 'window.__lopsyCommands is not installed' } };
    try {
      return { ok: true, result: await api.run(payload) };
    } catch (error) {
      const candidate = error as { name?: unknown; toJSON?: () => CommandErrorPayload };
      if (candidate && candidate.name === 'CommandError' && typeof candidate.toJSON === 'function') {
        return { ok: false, error: { isCommandError: true, ...candidate.toJSON() } };
      }
      const message = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error);
      return { ok: false, error: { isCommandError: false, message } };
    }
  }, invocation as unknown);
  if (outcome.ok) return outcome.result as T;
  if (outcome.error.isCommandError) throw new ApiError(outcome.error);
  throw new Error(`The command API threw something other than a CommandError: ${outcome.error.message}`);
}

/** Runs `invocation` expecting a CommandError, and returns its code and message. */
export async function runError(page: Page, invocation: Invocation | readonly Invocation[]): Promise<CommandErrorInfo> {
  try {
    const result = await run(page, invocation);
    throw new Error(`Expected ${JSON.stringify(invocation)} to fail, but it succeeded with ${JSON.stringify(result)}`);
  } catch (error) {
    if (error instanceof ApiError) return { code: error.code, message: error.message };
    throw error;
  }
}

export async function describe(page: Page, surface?: 'document' | 'ui'): Promise<ApiCommandDescription[]> {
  return page.evaluate((s) => {
    const api = (window as unknown as CommandsWindow).__lopsyCommands;
    if (!api) throw new Error('window.__lopsyCommands is not installed');
    return api.describe(s ?? undefined);
  }, surface ?? null);
}

export interface SnapshotLayer {
  name: string;
  type: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blendMode: string;
  x: number;
  y: number;
  hasMask: boolean;
  /** Whether the mask applies; null when there is none. */
  maskEnabled: boolean | null;
  /** The layer's effects as the store holds them (colours 0-255, opacity 0-1). */
  effects: unknown;
  /** Index (in `layers`) of the group that holds this layer; null for the root. */
  parent: number | null;
  /** Hash of the layer's pixels placed in the document; null for groups. */
  pixels: string | null;
  /** Hash of the layer's mask as the GPU holds it (mask.data lags the GPU); null when there is none. */
  mask: string | null;
  /** A group's adjustment nodes as the store holds them, without ids; null for other layers. */
  adjustments: SnapshotAdjustments | null;
}

export interface SnapshotAdjustments {
  enabled: boolean;
  nodes: Array<{ type: string; enabled: boolean; params: Record<string, unknown> }>;
}

export interface DocSnapshot {
  document: { width: number; height: number; colorMode: string };
  /** In `layerOrder` order, bottom to top. */
  layers: SnapshotLayer[];
  /** Index in `layers` of the active layer. */
  activeLayer: number | null;
  /** Indices in `layers` of the selected layers, ascending. */
  selectedLayers: number[];
  selection: {
    active: boolean;
    bounds: { x: number; y: number; width: number; height: number } | null;
    /** Hash of the selection mask bytes, or null when there is none. */
    mask: string | null;
  };
  history: { undo: string[]; redo: string[] };
  /** Vector paths in the store's order, with each anchor's point in document pixels. */
  paths: SnapshotPath[];
  /** Ruler guides in the order they were added; a guide's position is in document pixels. */
  guides: Array<{ orientation: string; position: number }>;
  /** Hash of the flattened document as Export renders it, so adjustments show in the comparison. */
  composite: string;
  /** Ambient editor state: compared only when a comparison asks for it with `withEditorState`. */
  editor: EditorState;
}

export interface SnapshotPath {
  closed: boolean;
  anchors: Array<{ x: number; y: number }>;
}

export interface EditorState {
  tool: string;
  /** Colours as the store holds them: 0-255 channels, alpha 0-1. */
  foreground: { r: number; g: number; b: number; a: number };
  background: { r: number; g: number; b: number; a: number };
}

interface StructureLayer extends Omit<SnapshotLayer, 'pixels' | 'mask'> {
  id: string;
}

type Structure = Omit<DocSnapshot, 'layers' | 'editor' | 'composite'> & { layers: StructureLayer[] };

/** The active tool and the foreground/background colours. */
export async function editorState(page: Page): Promise<EditorState> {
  return page.evaluate(() => {
    type Rgba = { r: number; g: number; b: number; a: number };
    const w = window as unknown as Record<string, { getState: () => Record<string, unknown> }>;
    const ui = w.__uiStore!.getState() as { activeTool: string };
    const tools = w.__toolSettingsStore!.getState() as { foregroundColor: Rgba; backgroundColor: Rgba };
    return { tool: ui.activeTool, foreground: { ...tools.foregroundColor }, background: { ...tools.backgroundColor } };
  });
}

async function readStructure(page: Page): Promise<Structure> {
  return page.evaluate(() => {
    type L = {
      id: string; name: string; type: string; visible: boolean; locked: boolean; opacity: number;
      blendMode: string; x: number; y: number; mask: { enabled: boolean } | null; effects: unknown;
      children?: readonly string[];
      adjustments?: ReadonlyArray<{ id: string; type: string; enabled: boolean } & Record<string, unknown>>;
      adjustmentsEnabled?: boolean;
    };
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: {
          width: number; height: number; colorMode: string; layers: L[]; layerOrder: string[];
          activeLayerId: string | null; selectedLayerIds: string[];
        };
        selection: {
          active: boolean;
          bounds: { x: number; y: number; width: number; height: number } | null;
          mask: ArrayLike<number> | null;
        };
        undoStack: Array<{ label: string }>;
        redoStack: Array<{ label: string }>;
        paths: Array<{ closed: boolean; anchors: Array<{ point: { x: number; y: number } }> }>;
      };
    };
    const ui = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { guides: Array<{ orientation: string; position: number }> };
    };
    const state = store.getState();
    const doc = state.document;
    const byId = new Map(doc.layers.map((l) => [l.id, l]));
    const ordered = doc.layerOrder.map((id) => byId.get(id)).filter((l): l is L => l !== undefined);
    const indexOf = new Map(ordered.map((l, i) => [l.id, i]));
    const parentOf = new Map<string, number>();
    for (const l of ordered) for (const child of l.children ?? []) parentOf.set(child, indexOf.get(l.id) ?? -1);
    const hashBytes = (bytes: ArrayLike<number>): string => {
      let h = 0x811c9dc5;
      for (let i = 0; i < bytes.length; i++) {
        h ^= bytes[i]! & 0xff;
        h = Math.imul(h, 0x01000193) >>> 0;
      }
      return `${bytes.length}:${h.toString(16).padStart(8, '0')}`;
    };
    const { selection } = state;
    return {
      document: { width: doc.width, height: doc.height, colorMode: doc.colorMode },
      layers: ordered.map((l) => ({
        id: l.id,
        name: l.name,
        type: l.type,
        visible: l.visible,
        locked: !!l.locked,
        opacity: l.opacity,
        blendMode: l.blendMode,
        x: l.x,
        y: l.y,
        hasMask: l.mask != null,
        maskEnabled: l.mask ? l.mask.enabled : null,
        effects: l.effects,
        parent: parentOf.get(l.id) ?? null,
        adjustments: l.type === 'group'
          ? {
              enabled: l.adjustmentsEnabled ?? true,
              nodes: (l.adjustments ?? []).map(({ id: _id, type, enabled, ...params }) => ({ type, enabled, params })),
            }
          : null,
      })),
      activeLayer: doc.activeLayerId === null ? null : (indexOf.get(doc.activeLayerId) ?? null),
      selectedLayers: doc.selectedLayerIds
        .map((id) => indexOf.get(id))
        .filter((i): i is number => i !== undefined)
        .sort((a, b) => a - b),
      selection: {
        active: selection.active,
        bounds: selection.active && selection.bounds ? { ...selection.bounds } : null,
        mask: selection.mask ? hashBytes(selection.mask) : null,
      },
      history: {
        undo: state.undoStack.map((e) => e.label),
        redo: state.redoStack.map((e) => e.label),
      },
      paths: state.paths.map((p) => ({ closed: p.closed, anchors: p.anchors.map((a) => ({ x: a.point.x, y: a.point.y })) })),
      guides: ui.getState().guides.map((g) => ({ orientation: g.orientation, position: g.position })),
    };
  });
}

/**
 * The document as JSON, with layers and the active/selected layers named by
 * their position, so two documents built the same way compare equal.
 */
export async function snapshot(page: Page): Promise<DocSnapshot> {
  await settle(page);
  await settleEngine(page);
  const structure = await readStructure(page);
  const layers: SnapshotLayer[] = [];
  for (const { id, ...layer } of structure.layers) {
    const pixels = layer.type === 'group' ? null : await docPixelHash(page, id);
    const mask = layer.hasMask ? await gpuMaskHash(page, id) : null;
    layers.push({ ...layer, pixels, mask });
  }
  return { ...structure, layers, composite: await compositeHash(page), editor: await editorState(page) };
}

/** Hash of the export composite (lossless RGBA), read through the bridge as the parity check reads it. */
export async function compositeHash(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const w = window as unknown as {
      __engineState?: { getEngine: () => unknown };
      __wasmBridge?: { compositeForExport: (engine: unknown) => Promise<Uint8Array> | Uint8Array };
    };
    const engine = w.__engineState?.getEngine();
    if (!engine || !w.__wasmBridge) throw new Error('the engine or __wasmBridge is not installed');
    const bytes = await w.__wasmBridge.compositeForExport(engine);
    let h = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) {
      h ^= bytes[i]!;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return `${bytes.length}:${h.toString(16).padStart(8, '0')}`;
  });
}

/** Hash of a layer's GPU mask, read through the bridge as mask-data-sync reads it. */
export async function gpuMaskHash(page: Page, layerId: string): Promise<string | null> {
  return page.evaluate(async (id) => {
    const w = window as unknown as {
      __engineState?: { getEngine: () => unknown };
      __wasmBridge?: { readMaskTexture: (engine: unknown, id: string) => Promise<Uint8Array | undefined> };
    };
    const engine = w.__engineState?.getEngine();
    if (!engine || !w.__wasmBridge) throw new Error('the engine or __wasmBridge is not installed');
    const bytes = await w.__wasmBridge.readMaskTexture(engine, id);
    if (!bytes) return null;
    let h = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) {
      h ^= bytes[i]!;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return `${bytes.length}:${h.toString(16).padStart(8, '0')}`;
  }, layerId);
}

export interface CompareOptions {
  width?: number;
  height?: number;
  transparent?: boolean;
  /** Runs on both sides, after the fresh document and before the operation. */
  setup?: (page: Page) => Promise<void>;
  viaUi: (page: Page) => Promise<void>;
  viaApi: (page: Page) => Promise<void>;
  /** Snapshot keys left out of the comparison. Justify each in a comment at the call. */
  ignore?: readonly (keyof DocSnapshot)[];
  /** Also compare `editor` (active tool and colours), which UI paths often change on the way. */
  withEditorState?: boolean;
}

export interface Comparison {
  ui: DocSnapshot;
  api: DocSnapshot;
}

async function freshSide(
  page: Page,
  options: CompareOptions,
  operation: (page: Page) => Promise<void>,
): Promise<DocSnapshot> {
  // A reload, so UI state one side leaves behind (tool, colours, dialogs) cannot leak into the other.
  await openCommandApi(page, EDITOR_PAGE);
  await createDocument(page, options.width ?? 200, options.height ?? 150, options.transparent ?? false);
  await page.waitForSelector('[data-testid="canvas-container"]');
  await settle(page, 300);
  if (options.setup) await options.setup(page);
  await operation(page);
  return snapshot(page);
}

function without(snap: DocSnapshot, ignore: readonly (keyof DocSnapshot)[]): Partial<DocSnapshot> {
  const copy: Partial<DocSnapshot> = { ...snap };
  for (const key of ignore) delete copy[key];
  return copy;
}

/**
 * Runs `setup` and then the operation once through the UI and once through
 * the command API, each on a reloaded page with a fresh document of the same
 * size made by the same helper, and asserts the two snapshots are equal.
 */
export async function compareUiAndApi(page: Page, options: CompareOptions): Promise<Comparison> {
  if ((openedPages.get(page) ?? EDITOR_PAGE) !== EDITOR_PAGE) {
    skipUiOnly('compareUiAndApi, which runs the operation through the editor\'s menus and panels');
  }
  const ui = await freshSide(page, options, options.viaUi);
  const api = await freshSide(page, options, options.viaApi);
  const ignore = [...(options.ignore ?? []), ...(options.withEditorState ? [] : ['editor' as const])];
  expect(without(api, ignore), 'the command left a different document than the UI did').toEqual(without(ui, ignore));
  return { ui, api };
}
