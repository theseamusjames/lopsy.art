import { describe, it, expect } from 'vitest';
import { glueExportNames, parseRenderer, renderSelectorModule } from './renderer-selector';

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

describe('glueExportNames', () => {
  it('lists classes, functions and the export list, without the default', () => {
    expect(glueExportNames(GLUE)).toEqual(['Engine', 'createEngine', 'setViewport', 'initSync']);
  });

  it('ignores declarations that are not exported', () => {
    expect(glueExportNames('function hidden() {}\nconst x = 1;\n')).toEqual([]);
  });

  it('reads an async export, as the wgpu glue could declare one', () => {
    expect(glueExportNames('export async function createEngine(canvas) {}')).toEqual(['createEngine']);
  });
});

describe('parseRenderer', () => {
  it('accepts the two renderers and nothing else', () => {
    expect(parseRenderer('wgpu')).toBe('wgpu');
    expect(parseRenderer('webgl')).toBe('webgl');
    expect(parseRenderer('vulkan')).toBeNull();
    expect(parseRenderer(undefined)).toBeNull();
  });
});

describe('renderSelectorModule', () => {
  const options = {
    exportNames: ['Engine', 'createEngine'],
    webglUrl: '/pkg/lopsy_wasm.js',
    wgpuUrl: '/pkg-wgpu/lopsy_wasm.js',
    defaultRenderer: 'webgl' as const,
  };

  it('re-exports every name and the default from whichever glue it loaded', () => {
    const source = renderSelectorModule(options);
    expect(source).toContain('export default glue.default;');
    expect(source).toContain('export const { Engine, createEngine } = glue;');
    expect(source).toContain('await import("/pkg/lopsy_wasm.js")');
    expect(source).toContain('await import("/pkg-wgpu/lopsy_wasm.js")');
  });

  it('falls back to the given default when the page does not ask', () => {
    expect(renderSelectorModule({ ...options, defaultRenderer: 'wgpu' })).toContain(': "wgpu";');
  });

  it('fails loudly when wgpu is asked for but was not built', () => {
    const source = renderSelectorModule({ ...options, wgpuUrl: null });
    expect(source).not.toContain('pkg-wgpu');
    expect(source).toContain('npm run wasm:build:wgpu');
  });
});
