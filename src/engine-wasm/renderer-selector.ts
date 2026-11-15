/**
 * Source of the module the dev server puts between `wasm-bridge.ts` and the
 * engine package, so one page load can run either renderer build:
 * `?renderer=wgpu` loads `pkg-wgpu`, anything else `pkg`. Pure: the Vite
 * plugin (scripts/vite-plugin-renderer.ts) does the file reading.
 *
 * Production builds do not use it. They import `pkg` directly.
 */

export type Renderer = 'webgl' | 'wgpu';

export interface SelectorOptions {
  /** Names the engine package exports, besides its default export. */
  exportNames: readonly string[];
  /** URL of the WebGL build's JS glue. */
  webglUrl: string;
  /** URL of the wgpu build's JS glue, or null when it has not been built. */
  wgpuUrl: string | null;
  /** What a page without `?renderer=` gets. */
  defaultRenderer: Renderer;
}

const EXPORT_DECLARATION = /^export\s+(?:async\s+)?(?:function|class)\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_LIST = /^export\s*\{([^}]*)\}/gm;

/** Named exports of a wasm-bindgen JS glue file, in source order. */
export function glueExportNames(source: string): string[] {
  const names: string[] = [];
  for (const match of source.matchAll(EXPORT_DECLARATION)) {
    if (match[1]) names.push(match[1]);
  }
  for (const match of source.matchAll(EXPORT_LIST)) {
    for (const item of (match[1] ?? '').split(',')) {
      const [local, exported] = item.trim().split(/\s+as\s+/);
      const name = exported ?? local;
      if (name && name !== 'default') names.push(name);
    }
  }
  return [...new Set(names)];
}

export function parseRenderer(value: string | null | undefined): Renderer | null {
  return value === 'wgpu' || value === 'webgl' ? value : null;
}

const MISSING_WGPU_BUILD = 'The wgpu engine build is missing. Run: npm run wasm:build:wgpu';

export function renderSelectorModule(options: SelectorOptions): string {
  const loadWgpu = options.wgpuUrl
    ? `await import(${JSON.stringify(options.wgpuUrl)})`
    : `(() => { throw new Error(${JSON.stringify(MISSING_WGPU_BUILD)}); })()`;
  return [
    `const search = typeof location === 'undefined' ? '' : location.search;`,
    `const asked = new URLSearchParams(search).get('renderer');`,
    `const renderer = asked === 'wgpu' || asked === 'webgl' ? asked : ${JSON.stringify(options.defaultRenderer)};`,
    `const glue = renderer === 'wgpu'`,
    `  ? ${loadWgpu}`,
    `  : await import(${JSON.stringify(options.webglUrl)});`,
    `export default glue.default;`,
    `export const { ${options.exportNames.join(', ')} } = glue;`,
    '',
  ].join('\n');
}
