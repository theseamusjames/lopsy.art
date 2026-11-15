/**
 * Counts changes that can alter how the engine lays out text whose props
 * did not change: a font loading into the engine, or a layer's text state
 * being dropped (so its next layout re-shapes with whatever fonts are loaded
 * now). Caches of text measurements keyed by props compare against it.
 *
 * The wasm-bridge wrappers bump it, so callers never have to remember to.
 */

let generation = 0;

export function bumpTextLayoutGeneration(): void {
  generation += 1;
}

export function textLayoutGeneration(): number {
  return generation;
}
