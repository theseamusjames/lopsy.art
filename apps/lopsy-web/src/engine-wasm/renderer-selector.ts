/**
 * Source of the module that stands between `wasm-bridge.ts` and the engine
 * package, so one page load can run either build of the engine. Pure: the
 * Vite plugin (scripts/vite-plugin-renderer.ts) does the file reading.
 *
 * The bridge imports the package's functions by name, and an import cannot
 * be chosen at run time. So the generated module imports the WebGL package
 * statically and exports a function of the same name for each of the
 * package's, which calls whichever package is running. Its default export,
 * the wasm `init` the bridge already awaits before anything else, decides
 * which that is (renderer-choice.ts): the WebGL package it already holds,
 * or the wgpu one, which it imports then.
 *
 * The exported functions never change, so code may keep one in a constant
 * or a table when its module loads, before the choice is made: the bridge
 * does (`asyncReadback(rawReadLayerPixels)`). A class cannot be stood in
 * for that way, so a class is exported as a binding that is pointed at the
 * running package's; do not keep a class in a constant at load.
 *
 * A page that runs WebGL loads nothing of the wgpu build.
 */

import type { Renderer } from './renderer-choice';

export interface SelectorOptions {
  /** What the engine package exports, besides its default export. */
  exports: readonly GlueExport[];
  /** Module id of the WebGL build's JS glue. */
  webglUrl: string;
  /** Module id of the wgpu build's JS glue, or null when it has not been built. */
  wgpuUrl: string | null;
  /** Module id of renderer-choice.ts. */
  choiceUrl: string;
  /** What a page that names no renderer gets. */
  defaultRenderer: Renderer;
}

export interface GlueExport {
  name: string;
  kind: 'function' | 'class';
}

const EXPORT_DECLARATION = /^export\s+(?:async\s+)?(function|class)\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_LIST = /^export\s*\{([^}]*)\}/gm;

/** Named exports of a wasm-bindgen JS glue file, in source order. */
export function glueExports(source: string): GlueExport[] {
  const found = new Map<string, GlueExport>();
  for (const match of source.matchAll(EXPORT_DECLARATION)) {
    const name = match[2];
    if (name) found.set(name, { name, kind: match[1] === 'class' ? 'class' : 'function' });
  }
  for (const match of source.matchAll(EXPORT_LIST)) {
    for (const item of (match[1] ?? '').split(',')) {
      const [local, exported] = item.trim().split(/\s+as\s+/);
      const name = exported ?? local;
      if (!local || !name || name === 'default' || found.has(name)) continue;
      const isClass = new RegExp(`^class\\s+${local.replace(/\$/g, '\\$')}\\b`, 'm').test(source);
      found.set(name, { name, kind: isClass ? 'class' : 'function' });
    }
  }
  return [...found.values()];
}

export function renderSelectorModule(options: SelectorOptions): string {
  const quote = (value: string) => JSON.stringify(value);
  const hasWgpuBuild = options.wgpuUrl !== null;
  const classes = options.exports.filter((item) => item.kind === 'class').map((item) => item.name);
  const functions = options.exports.filter((item) => item.kind === 'function').map((item) => item.name);
  const lines = [
    `import * as webgl from ${quote(options.webglUrl)};`,
    `import { canUseWebGpu, noteRunningRenderer, requestedRenderer } from ${quote(options.choiceUrl)};`,
    `let active = webgl;`,
    ...classes.map((name) => `export let ${name} = webgl.${name};`),
    // `apply` with `arguments` forwards a call without allocating.
    ...functions.map((name) => `export function ${name}() { return active.${name}.apply(undefined, arguments); }`),
    `export default async function init(input) {`,
    `  const renderer = requestedRenderer(${quote(options.defaultRenderer)}, ${String(hasWgpuBuild)});`,
  ];
  if (options.wgpuUrl !== null) {
    lines.push(
      `  if (renderer === 'wgpu' && (await canUseWebGpu())) {`,
      `    active = await import(${quote(options.wgpuUrl)});`,
      ...classes.map((name) => `    ${name} = active.${name};`),
      `    noteRunningRenderer('wgpu');`,
      `    return active.default(input);`,
      `  }`,
    );
  }
  lines.push(`  noteRunningRenderer('webgl');`, `  return webgl.default(input);`, `}`, '');
  return lines.join('\n');
}
