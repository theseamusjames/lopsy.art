/**
 * Which build of the engine a page load runs: the WebGL one or the wgpu
 * one. Decided once, before the engine's wasm is fetched, because the two
 * builds are separate packages.
 *
 * In order: `?renderer=wgpu|webgl` in the URL; the choice stored by View >
 * Renderer; the default the build was made with. WebGPU is only ever
 * chosen where the browser offers it and this build includes the wgpu
 * package, and never again in a tab where it has just failed to start.
 */

export type Renderer = 'webgl' | 'wgpu';

/** localStorage: the renderer the user picked in View > Renderer. */
export const RENDERER_STORAGE_KEY = 'lopsy:renderer';
/** sessionStorage: set when the wgpu engine failed to start in this tab. */
export const RENDERER_FAILED_KEY = 'lopsy:renderer-failed';

export function parseRenderer(value: string | null | undefined): Renderer | null {
  return value === 'wgpu' || value === 'webgl' ? value : null;
}

export interface RendererChoiceInput {
  /** `location.search`. */
  search: string;
  /** The stored preference, if any. */
  stored: string | null;
  /** What a page that names nothing gets. */
  fallback: Renderer;
  /** Whether the browser has `navigator.gpu`. */
  hasWebGpu: boolean;
  /** Whether this build includes the wgpu package. */
  hasWgpuBuild: boolean;
  /** Whether the wgpu engine already failed to start in this tab. */
  hasFailed: boolean;
}

export function chooseRenderer(input: RendererChoiceInput): Renderer {
  const asked = parseRenderer(new URLSearchParams(input.search).get('renderer'));
  const wanted = asked ?? parseRenderer(input.stored) ?? input.fallback;
  if (wanted === 'webgl') return 'webgl';
  const isAvailable = input.hasWebGpu && input.hasWgpuBuild && !input.hasFailed;
  return isAvailable ? 'wgpu' : 'webgl';
}

function readStorage(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key);
  } catch {
    // Storage is blocked in some privacy modes.
    return null;
  }
}

/** The renderer this page load runs, from the page's own URL and storage. */
export function requestedRenderer(fallback: Renderer, hasWgpuBuild: boolean): Renderer {
  if (typeof location === 'undefined') return 'webgl';
  return chooseRenderer({
    search: location.search,
    stored: readStorage(() => localStorage, RENDERER_STORAGE_KEY),
    fallback,
    hasWebGpu: hasWebGpu(),
    hasWgpuBuild,
    hasFailed: readStorage(() => sessionStorage, RENDERER_FAILED_KEY) !== null,
  });
}

interface WebGpuAdapter {
  limits?: { maxTextureDimension2D?: number };
}

let adapterTextureLimit: number | null = null;

/**
 * Whether the browser will hand out a WebGPU adapter. `navigator.gpu`
 * exists in browsers that then refuse one: on a blocklisted GPU, or with
 * hardware acceleration off. Notes the adapter's largest texture side,
 * which is what the wgpu engine asks its device for.
 */
export async function canUseWebGpu(): Promise<boolean> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<WebGpuAdapter | null> } }).gpu;
    if (gpu === undefined) return false;
    const adapter = await gpu.requestAdapter();
    if (adapter === null) return false;
    const limit = adapter.limits?.maxTextureDimension2D;
    adapterTextureLimit = typeof limit === 'number' && limit > 0 ? limit : null;
    return true;
  } catch {
    return false;
  }
}

/**
 * The largest texture side the WebGPU adapter allows, or null until
 * `canUseWebGpu` has been answered with one.
 */
export function webGpuTextureLimit(): number | null {
  return adapterTextureLimit;
}

/** Whether the browser has WebGPU at all. */
export function hasWebGpu(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

let running: Renderer | null = null;

/** Record which build this page load initialized. */
export function noteRunningRenderer(renderer: Renderer): void {
  running = renderer;
}

/** The build this page load is running, once the engine's wasm has been initialized. */
export function runningRenderer(): Renderer | null {
  return running;
}

/** The preference stored by View > Renderer, if one was. */
export function storedRenderer(): Renderer | null {
  return parseRenderer(readStorage(() => localStorage, RENDERER_STORAGE_KEY));
}

/** Store the renderer to use from the next page load on. */
export function storeRenderer(renderer: Renderer): void {
  try {
    localStorage.setItem(RENDERER_STORAGE_KEY, renderer);
  } catch {
    // Without storage the choice lasts only as long as a `?renderer=` URL.
  }
}

/**
 * Record that the wgpu engine could not start, so a reload of this tab
 * runs WebGL. Returns false if it was already recorded: the caller
 * reloads once, not in a loop.
 */
export function markRendererFailed(): boolean {
  try {
    if (sessionStorage.getItem(RENDERER_FAILED_KEY) !== null) return false;
    sessionStorage.setItem(RENDERER_FAILED_KEY, '1');
    return true;
  } catch {
    return false;
  }
}
