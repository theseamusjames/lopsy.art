import { describe, it, expect } from 'vitest';
import { glueExports, renderSelectorModule } from './renderer-selector';

const GLUE = `
let wasm;
export class Engine {
    free() {}
}
export function createEngine(canvas) {}
export function setViewport(engine, zoom) {}
function initSync(module) {}
async function __wbg_init(module_or_path) {}
export { initSync, __wbg_init as default };
`;

describe('glueExports', () => {
  it('lists classes, functions and the export list, without the default', () => {
    expect(glueExports(GLUE)).toEqual([
      { name: 'Engine', kind: 'class' },
      { name: 'createEngine', kind: 'function' },
      { name: 'setViewport', kind: 'function' },
      { name: 'initSync', kind: 'function' },
    ]);
  });

  it('ignores declarations that are not exported', () => {
    expect(glueExports('function hidden() {}\nconst x = 1;\n')).toEqual([]);
  });

  it('reads an async export, as the wgpu glue could declare one', () => {
    expect(glueExports('export async function createEngine(canvas) {}')).toEqual([
      { name: 'createEngine', kind: 'function' },
    ]);
  });

  it('tells a class in the export list from a function', () => {
    expect(glueExports('class Engine {}\nfunction free() {}\nexport { Engine, free };')).toEqual([
      { name: 'Engine', kind: 'class' },
      { name: 'free', kind: 'function' },
    ]);
  });
});

type StandIn = Record<string, unknown>;

interface LoadedSelector {
  init: () => Promise<unknown>;
  loaded: string[];
  exported: () => { Engine: unknown; createEngine: (canvas: string) => unknown };
}

/** Evaluate a generated selector against stand-in packages. */
function load(source: string, modules: Record<string, StandIn>): LoadedSelector {
  const body = source
    .replace(/^import \* as (\w+) from ("[^"]+");$/m, 'const $1 = __modules[$2];')
    .replace(/^import \{ ([^}]+) \} from ("[^"]+");$/m, 'const { $1 } = __modules[$2];')
    .replace(/await import\(("[^"]+")\)/g, '(__loaded.push($1), __modules[$1])')
    .replace(/^export (let|function) /gm, '$1 ')
    .replace(/^export default async function init/m, 'async function init');
  const names = [...source.matchAll(/^export (?:let|function) (\w+)/gm)].map((m) => m[1] ?? '');
  const read = `return { init, loaded: __loaded, exported: () => ({ ${names.join(', ')} }) };`;
  const make = new Function('__modules', '__loaded', `${body}\n${read}`) as (
    m: typeof modules,
    l: string[],
  ) => LoadedSelector;
  return make(modules, []);
}

describe('renderSelectorModule', () => {
  const standIn = (name: string): StandIn => ({
    default: async () => `${name} ready`,
    Engine: `${name} Engine`,
    createEngine: (canvas: string) => `${name} engine on ${canvas}`,
  });
  const options = {
    exports: [
      { name: 'Engine', kind: 'class' as const },
      { name: 'createEngine', kind: 'function' as const },
    ],
    webglUrl: '/pkg/lopsy_wasm.js',
    wgpuUrl: '/pkg-wgpu/lopsy_wasm.js',
    choiceUrl: '/renderer-choice.ts',
    defaultRenderer: 'webgl' as const,
  };
  const noted: string[] = [];
  const modules = (renderer: string, canUse = true) => ({
    '/pkg/lopsy_wasm.js': standIn('webgl'),
    '/pkg-wgpu/lopsy_wasm.js': standIn('wgpu'),
    '/renderer-choice.ts': {
      requestedRenderer: () => renderer,
      canUseWebGpu: async () => canUse,
      noteRunningRenderer: (running: string) => noted.push(running),
    },
  });

  it('runs the WebGL package it imported and loads nothing else', async () => {
    const selector = load(renderSelectorModule(options), modules('webgl'));
    expect(await selector.init()).toBe('webgl ready');
    expect(selector.exported().Engine).toBe('webgl Engine');
    expect(selector.exported().createEngine('a canvas')).toBe('webgl engine on a canvas');
    expect(selector.loaded).toEqual([]);
  });

  it('calls the wgpu package once that is chosen', async () => {
    const selector = load(renderSelectorModule(options), modules('wgpu'));
    noted.length = 0;
    expect(await selector.init()).toBe('wgpu ready');
    expect(noted).toEqual(['wgpu']);
    expect(selector.exported().Engine).toBe('wgpu Engine');
    expect(selector.exported().createEngine('a canvas')).toBe('wgpu engine on a canvas');
    expect(selector.loaded).toEqual(['/pkg-wgpu/lopsy_wasm.js']);
  });

  it('a function kept from before the choice calls the package chosen after', async () => {
    const selector = load(renderSelectorModule(options), modules('wgpu'));
    const kept = selector.exported().createEngine;
    expect(kept('a canvas')).toBe('webgl engine on a canvas');
    await selector.init();
    expect(kept('a canvas')).toBe('wgpu engine on a canvas');
  });

  it('stays on WebGL when the browser has no usable WebGPU adapter', async () => {
    const selector = load(renderSelectorModule(options), modules('wgpu', false));
    noted.length = 0;
    expect(await selector.init()).toBe('webgl ready');
    expect(noted).toEqual(['webgl']);
    expect(selector.exported().createEngine('a canvas')).toBe('webgl engine on a canvas');
    expect(selector.loaded).toEqual([]);
  });

  it('passes the build default and whether the wgpu package exists to the choice', () => {
    const withBuild = renderSelectorModule({ ...options, defaultRenderer: 'wgpu' });
    expect(withBuild).toContain('requestedRenderer("wgpu", true)');
    const withoutBuild = renderSelectorModule({ ...options, wgpuUrl: null });
    expect(withoutBuild).toContain('requestedRenderer("webgl", false)');
    expect(withoutBuild).not.toContain('pkg-wgpu');
  });
});
