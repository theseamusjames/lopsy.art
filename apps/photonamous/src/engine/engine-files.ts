/**
 * The engine's wasm file for each build, as the bundler names them. The
 * RAF workers instantiate the one the page runs, and the service worker is
 * asked to keep that one for offline use (sw/register.ts): a visitor
 * downloads one build, not both.
 */

import webglWasmUrl from '@lopsy/engine-pkg/lopsy_wasm_bg.wasm?url';
import wgpuWasmUrl from '@lopsy/engine-pkg-wgpu/lopsy_wasm_bg.wasm?url';
import type { Renderer } from './renderer-choice';

export function wasmUrlFor(renderer: Renderer): string {
  return renderer === 'wgpu' ? wgpuWasmUrl : webglWasmUrl;
}
