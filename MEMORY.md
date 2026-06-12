# Memory

## render() skips clean frames — mutations must set needs_recomposite

`render()` (lib.rs) returns early unless `engine.needs_recomposite` is
set. Any new engine code that changes what the composite looks like
(layer pixels, masks, overlays, adjustments, viewport) must set the
flag — layer-texture writes should call `engine.mark_layer_dirty(id)`,
which also invalidates the group pre-adjustment cache. If a new
operation renders correctly in tests that read the composite texture
but shows a stale canvas in the app, a missing dirty mark is the first
thing to check. Marching-ants / text-cursor animation deliberately does
NOT dirty the engine — it repaints only the 2D overlay canvas via
`renderOverlayFrame()`.

## Memories should be inlined in MEMORY.md, not in separate files

Keep everything in this single file. No separate memory files in .claude or elsewhere.

## Performance optimization workflow

When diagnosing perf issues, write a benchmark e2e test that reproduces the exact user scenario on a large canvas (4K+). Profile with CDP (`Profiler.start/stop` via `page.context().newCDPSession`), collect per-event timestamps (unsorted, to preserve temporal patterns), and compute self-time per function from the profile's nodes/samples/timeDeltas. Fix one bottleneck at a time and re-run the same test to verify. Temporarily disabling suspect code paths (early return) to confirm they're the bottleneck before writing a real fix is very effective. See `e2e/brush-perf-6k.spec.ts` for a working example that profiles brush strokes, marching ants, and move-tool drag.

## All pixel manipulation must happen in Rust/WASM engine, never JS Canvas 2D

## Undo snapshots use normalized u16, not raw FP16 bits

Undo snapshots read GPU RGBA16F textures as normalized u16 (value * 65535) and restore by dividing back (u16 / 65535). This linear encoding can't preserve FP16's extra precision at small magnitudes. Values above ~0.03 round-trip losslessly; darker values can shift by a few FP16 ULPs (worst case ~8 ULPs near 0.001).

| Value range | FP16 ULP | u16 step | u16 steps per FP16 step | Lossless? |
|---|---|---|---|---|
| ~1.0 | 9.77e-4 | 1.53e-5 | ~64 | Yes |
| ~0.5 | 4.88e-4 | 1.53e-5 | ~32 | Yes |
| ~0.03 | 1.53e-5 | 1.53e-5 | ~1 | Borderline |
| ~0.01 | 7.6e-6 | 1.53e-5 | ~0.5 | No — loses 1-2 ULPs |
| ~0.001 | 9.5e-7 | 1.53e-5 | ~0.06 | No — loses ~8 ULPs |

Not worth fixing. The precision loss is perceptually invisible — sub-1-bit error in deep shadows only. Fixing would require storing raw FP16 bit patterns instead of normalized u16, changing the readback/upload pipeline in texture_pool.rs and the compressed snapshot format.

