# Memory

## Memories should be inlined in MEMORY.md, not in separate files

Keep everything in this single file. No separate memory files in .claude or elsewhere.

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

