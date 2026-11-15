/**
 * Records how long a startup step took as a User Timing measure, so the
 * load-time budget in docs/engine-migration-plan.md can be read from any
 * build with `performance.getEntriesByName(...)` or the browser's
 * Performance panel. `scripts/measure-load-time.mjs` reads these.
 */
export const WASM_INIT_TIMING = 'lopsy:wasm-init';
export const ENGINE_CREATE_TIMING = 'lopsy:engine-create';

export function recordStartupTiming(name: string, start: number): void {
  if (typeof performance === 'undefined' || typeof performance.measure !== 'function') return;
  performance.measure(name, { start, end: performance.now() });
}
