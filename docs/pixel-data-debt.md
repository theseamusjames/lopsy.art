# Pixel Data Debt

Lopsy's policy, stated in `AGENTS.md`:

> All pixel data lives in GPU textures managed by the Rust engine. TypeScript
> never creates, manipulates, or stores pixel buffers.

This file tracks the places where that policy is not yet enforced, with
the reason each exception exists and the plan to retire it.

New code **must not** introduce new violations. Reduce, don't grow.

---

## Active exceptions

### 1. `src/app/store/pixel-data-slice.ts` — ImageData orchestration layer

Holds per-layer `ImageData` in the `pixelDataManager`, supports dense +
sparse storage, and re-uploads to the GPU on mutation.

**Why it exists.** The engine consumes `ImageData` via
`uploadLayerPixels(engine, layerId, rawBytes, w, h, x, y)`. Operations
that still originate on the CPU (filters that don't yet have a GPU
implementation, paste-from-clipboard) produce `ImageData` that this
slice caches until the GPU is ready for it. PSD import bypasses this
slice — it decodes in Rust and uploads directly to the layer texture
(u8 for 8-bit PSDs, f32 for 16-bit) via `decodeAndUploadPsdLayer`.

**Plan.** Every filter must land as a `filter_gpu.rs` shader. When the
last CPU filter path is retired, this slice collapses into a thin
"upload and forget" wrapper — the Maps go away.

**Tracked layers:** raster only. Text, shape, group, and adjustment
layers are not cached here.

---

### 2. `src/tools/text/**` — text rasterization via `<canvas>`

Text layers currently render through `CanvasRenderingContext2D.fillText`
into an `ImageData`, which is then uploaded to a layer texture.

**Why it exists.** The Rust engine has no TrueType/OpenType parser or
glyph rasterizer. Pulling `ttf-parser` + `rusttype` (or `fontdue`) into
`lopsy-core` is the only path forward, and it's a substantial project —
font metrics, shaping, kerning, fallback, subpixel AA.

**Plan.** Issue-tracked as a separate workstream. Until then, text stays
on CPU. The seam is clean — `text-interaction.ts` produces a text layer,
the rasterizer produces an `ImageData`, and the engine treats it as an
opaque upload. No other code leaks through this boundary.

---

### 3. Layer masks — CPU paint path (migration pending)

`handleMaskPaintMove` in `src/app/interactions/paint-handlers.ts` runs a
CPU per-pixel loop (`applyBrushDab`) against a `Uint8ClampedArray` owned
by the layer model. `src/app/interactions/mask-buffer.ts` keeps a shared
preview buffer that `useCanvasRendering` uploads to the GPU each frame.

**Why it's still here.** The mask is conceptually a scalar field but
uploaded as RGBA. The GPU brush/eraser shaders are written for RGBA
color painting with MAX-blend dab accumulation — not quite right for
additive/subtractive mask coverage. A proper migration wants:

1. A dedicated `mask_paint_dab.glsl` shader that does source-over
   blending of a fill value `{0.0, 1.0}` with a soft-hardness falloff.
2. New WASM APIs `paintMaskBrushDab`, `paintMaskEraserDab`,
   `paintMaskBrushDabBatch`, `paintMaskEraserDabBatch` in
   `src/engine-wasm/wasm-bridge.ts`.
3. Readback on stroke end (via a new `readLayerMaskBytes` helper) so
   the `layer.mask.data` byte array stays the source of truth for undo
   snapshots and PSD export. `resetTrackedState` must preserve the mask
   version across that readback.
4. Delete `src/app/interactions/mask-buffer.ts`, delete the CPU
   `handleMaskPaintMove` and its imports, and delete
   `createMaskSurface` if nothing else uses it.

**Plan.** Tracked. Not blocking any other cleanup. Next sprint.

---

## How to read "this is fine" vs "fix it"

| Case                                                   | OK or debt? |
|--------------------------------------------------------|-------------|
| Engine readback for undo snapshot (`gpu-pixel-access`) | OK          |
| Engine readback for PNG/JPEG export                    | OK          |
| PSD import (Rust → GPU, no ImageData detour)           | OK          |
| Filter computed on CPU and then uploaded               | **Debt**    |
| Brush/eraser touching a JS pixel buffer                | **Debt**    |
| Selection mask built by `selection-ops.ts`             | OK          |
| Font rasterizer in JS (text only)                      | OK (§2)     |

Anything in the **Debt** column needs a GitHub issue and a GPU
implementation plan, or it does not land.

---

## Enforcement

The linter rule lives at `scripts/check-pixel-debt.mjs` and runs as part
of `npm run lint`. It rejects `new ImageData`, `new Uint8ClampedArray`,
and `new Float32Array` outside an explicit allowlist. When you need to
add an allowlist entry, update this doc in the same PR.
