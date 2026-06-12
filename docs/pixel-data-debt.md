# Pixel Data Debt

Lopsy's policy, stated in `AGENTS.md`:

> All pixel data lives in GPU textures managed by the Rust engine. TypeScript
> never creates, manipulates, or stores pixel buffers.

This file tracks the places where that policy is not yet enforced, with
the reason each exception exists and the plan to retire it.

New code **must not** introduce new violations. Reduce, don't grow.

The authoritative per-file budget is `scripts/check-pixel-debt.mjs`,
which runs as part of `npm run lint`. This doc explains the *why* behind
each category; the script enforces the *how many*.

---

## How to read this doc

Every category below maps to a section of comments in the linter
allowlist. If you add or remove a file from the allowlist, refresh the
matching section here in the same PR.

| Category                                              | Status   |
|-------------------------------------------------------|----------|
| Test fixtures                                         | OK       |
| Tracked pixel-data debt (§1)                          | Debt     |
| Tracked mask debt (§2)                                | Debt     |
| Selection mask                                        | OK       |
| GPU readback                                          | OK       |
| File I/O (PNG/JPEG/PSD/DNG/.lopsy)                    | OK       |
| Clipboard paste                                       | OK       |
| Wide-gamut ImageData plumbing                         | OK       |
| Tracked GPU-port debt (§3)                            | Debt     |
| Pattern + thumbnail generation                        | OK       |
| Brush engine scaffolding (§4)                         | Mixed    |
| Transform matrices                                    | OK       |

---

## §1 — Active pixel-data debt

### `src/engine/pixel-data.ts` — ImageData orchestration layer

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

### `src/tools/text/**` — text rasterization via `<canvas>`

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

## §2 — Layer-mask CPU paint path (migration pending)

`handleMaskPaintMove` in `src/app/interactions/paint-handlers.ts` runs a
CPU per-pixel loop against a `Uint8ClampedArray` owned by the layer
model. `src/app/interactions/mask-buffer.ts` keeps a shared preview
buffer that `useCanvasRendering` uploads to the GPU each frame. The
nudge path in `useCanvasInteraction.ts` allocates a fresh full-size
mask buffer; `move-handlers.ts` and `quick-mask-move.ts` clone mask
data to preserve a snapshot during a drag.

**Allowlisted files in this category:**

- `src/app/interactions/move-handlers.ts` — drag-clones of `selection.mask`.
- `src/app/interactions/quick-mask-move.ts` — full-size mask alloc on commit.
- `src/app/store/actions/add-layer-mask.ts` — initial mask allocation.
- `src/app/useCanvasInteraction.ts` — nudge/mask copies.
- `src/engine/mask-utils.ts` — mask surface ↔ RGBA helpers.
- `src/tools/fill/fill-interaction.ts` — bucket fill writes mask data when active.

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

**Plan.** Tracked. Not blocking any other cleanup.

---

## §3 — Tracked GPU-port debt (per-file)

Each file below has a dedicated tracking issue. The CPU implementation
remains until the shader lands; new code must not grow the per-file
budget.

| File                                                       | Issue | What it does                                  |
|------------------------------------------------------------|-------|-----------------------------------------------|
| `src/panels/ChannelsPanel/channel-extract.ts`              | #440  | R/G/B/A channel preview generation            |
| `src/tools/crop/perspective-crop.ts`                       | #441  | Projective warp + bilinear interp             |
| `src/tools/liquify/liquify.ts`                             | #443  | Displacement-map liquify CPU pipeline         |
| `src/tools/quick-select/quick-select-interaction.ts`       | tbd   | GPU pixel readback into mask                  |
| `src/tools/quick-select/quick-select.ts`                   | tbd   | Magic-wand mask build                         |
| `src/tools/path/boolean-ops.ts`                            | #465  | Path boolean ops rendered through `<canvas>`  |

The `selection.ts` feather pass is also in this category but it isn't
listed above because the GPU helper (`featherSelectionMask` in
`wasm-bridge.ts`) already exists — see #442 for the migration to delete
the CPU box-blur and route every caller through the bridge.

---

## §4 — Brush engine scaffolding

The brush stack still allocates `Uint8ClampedArray` in a handful of
support paths. None of these are pixel painting; they're tip generation
and import/export plumbing that runs once per brush, not per dab.

| File                                                       | Why                                              |
|------------------------------------------------------------|--------------------------------------------------|
| `src/app/tool-settings-store.ts`                           | Built-in tip generation (procedural circle etc.) |
| `src/app/MenuBar/brush-actions.ts`                         | brush-from-selection / brush-from-layer rasterize |
| `src/components/BrushModal/BrushDabPreview.tsx`            | Modal-side preview blur                          |
| `src/components/BrushModal/BrushModal.tsx`                 | Imported texture image → grayscale               |
| `src/tools/brush/abr-parser.ts`                            | Photoshop `.abr` binary import                   |
| `src/tools/brush/brush-from-selection.ts`                  | "Define brush from selection" rasterize          |
| `src/tools/brush/brush.ts`                                 | `interpolatePoints` scratch (single Float64)     |
| `src/tools/brush/builtin-brushes.ts`                       | PNG → grayscale tip decode                       |
| `src/tools/brush/preset-io.ts`                             | Base64 → bytes for preset import                 |

These can stay CPU-side — they run on user action (import / define / open
modal), not on every frame. Mark as "OK" unless they grow further.

---

## How to read "this is fine" vs "fix it"

| Case                                                   | OK or debt? |
|--------------------------------------------------------|-------------|
| Engine readback for undo snapshot (`gpu-pixel-access`) | OK          |
| Engine readback for PNG/JPEG export                    | OK          |
| PSD import (Rust → GPU, no ImageData detour)           | OK          |
| Filter computed on CPU and then uploaded               | **Debt**    |
| Brush/eraser touching a JS pixel buffer                | **Debt**    |
| Selection mask built by `selection.ts`                 | OK          |
| Font rasterizer in JS (text only)                      | OK (§1)     |
| Pattern thumbnail preview (`pattern-store.ts`)         | OK          |
| Navigator thumbnail wrap                               | OK          |
| Brush tip / texture / preset import                    | OK (§4)     |

Anything in the **Debt** column needs a GitHub issue and a GPU
implementation plan, or it does not land.

---

## Enforcement

The linter rule lives at `scripts/check-pixel-debt.mjs` and runs as part
of `npm run lint`. It rejects `new ImageData`, `new Uint8ClampedArray`,
and `new Float32Array` outside an explicit allowlist. The allowlist is
the canonical, machine-readable shape of this document — its comments
mirror the section headings above. When you add an allowlist entry,
refresh the matching section here in the same PR.
