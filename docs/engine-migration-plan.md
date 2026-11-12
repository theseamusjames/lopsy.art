# Engine Migration Plan: WebGL → portable engine on wgpu

Goal: turn `engine-rs/` into an engine that several apps can consume
(Lopsy web, a native Lopsy, a raw editor, iOS apps), rendering through
wgpu so one codebase covers WebGPU, Metal, Vulkan and DX12.

Constraint: the work merges to `main` in reviewable batches, each leaving
Lopsy unchanged for users. There is no long-lived rewrite branch.

Status: in progress. `scripts/check-gl-debt.mjs` holds the live counts.

| Phase | State |
|---|---|
| 0 | Done, in review: CI guards (#1643), verification tooling (#1644). Spikes S1 and S2 are under way; S3 not run |
| 1 | In progress: 766 of 2,481 raw GL references removed across #1645, #1646, #1648, #1649 and #1650. Filters, layers and the compositor remain |
| 2–7 | Not started |

---

## 1. Where we start

Measured on `main` at the time of writing:

| Fact | Number |
|---|---|
| Raw GL references (`gl.*` calls, `WebGl*` types and constants) outside `gpu/`, as counted by `scripts/check-gl-debt.mjs` | 2,481 across 32 files |
| Largest holders | `compositor.rs` 663, `layer_manager.rs` 446, `brush_gpu.rs` 187, `engine.rs` 125 |
| Functions with raw GL types in their signature | ~50 |
| Per-uniform `gl.uniform*` call sites, by string name | ~750 |
| Fragment shaders | 93 files, ~4,400 lines GLSL ES 3.00 |
| Vertex shaders | 1 (fullscreen triangle) |
| `draw_arrays` call sites | 1 (`EngineInner::draw_fullscreen_quad`) |
| Blend configurations in use | 4 (off, premultiplied over, MAX, one separate-factor case) |
| Texture formats | RGBA8, RGBA16F, R8 |
| `#[wasm_bindgen]` exports | ~330, in `lib.rs` and `api/` |
| TS call sites of synchronous pixel readbacks | ~36 |
| Rust tests | 409 in `lopsy-core`, 111 in `lopsy-wasm` |
| PR CI | wasm build, lint, typecheck, Vitest. No `cargo test`, no e2e |

Two consequences shape the plan:

- Every GPU operation in the engine is the same shape: run one fragment
  shader, with uniforms and input textures, into a rect of a target
  texture, with one of four blend modes. The interface between features
  and the GPU can therefore be very small.
- The coupling is wide, not deep. Most of the work is mechanical and can
  be cut into file-sized pieces.

---

## 2. Target shape

```
engine/
  core/        CPU only: decode (RAF/DNG/PSD), colour, compression, export   (today: lopsy-core)
  gpu/         pass layer: textures, passes, shader registry
    webgl/     existing web-sys WebGL2 backend
    wgpu/      new backend: WebGPU, Metal, Vulkan, DX12
  imaging/     stateless ops: adjustments, filters, LUTs, resample
  document/    layers, masks, effects, compositor, brush, text, selection
  hosts/
    wasm/      wasm-bindgen shell                                            (today: lib.rs + api/)
    cli/       headless: tests, batch export
    ffi/       C interface for Swift / Kotlin / C#
apps/
  lopsy-web/
```

The pass layer is the seam. Feature code describes a pass and never
touches GPU state:

```rust
engine.pass(&engine.shaders.blit)
    .texture("u_tex", scratch)
    .f32("u_opacity", 1.0)               // becomes a typed struct in Phase 2
    .scissor(Scissor::Rect(rect))        // Inherit | Off | Rect
    .blend(Blend::Off)                   // Inherit | Off | PremulOver | Max | OverKeepAlpha
    .draw(Target::Texture(dst));         // Texture | Framebuffer | Screen
```

Backends are selected at compile time by a cargo feature and a type
alias (`pub type Gpu = webgl::Gpu` or `wgpu::Gpu`), not by a generic
parameter. That keeps `EngineInner` and every function signature free of
`<B: Backend>` noise and works with wasm-bindgen, which cannot export
generics.

The existing WebGL backend stays, as the fallback for browsers without
WebGPU. It is one small module behind a narrow interface, which is
different from writing a backend per platform by hand.

---

## 3. Commits and PRs

The commit is the small unit; the PR is a batch of them.

- **A commit** is one logical change: one module converted, one shader
  ported, one struct split out. Each commit builds and passes
  `cargo test`, so the history stays bisectable.
- **A PR** is a themed batch of commits that is reviewable in one
  sitting and leaves `main` shippable: a batch of module conversions, a
  shader family, one track of a phase.

The one hard requirement: **every PR leaves `main` building and fully
usable.** No PR relies on a later one to make the app work again. Old
and new code paths coexist until the new one is complete, and unfinished
work sits behind a cargo feature that the default build does not
compile. PR size and grouping are a convenience; this is not.

Rules for every PR:

1. No behaviour change unless the PR title says so.
2. The per-PR checks below pass.
3. The GL-reference ratchet (Phase 0) does not go up.
4. New dependencies are pinned and at least seven days old at the time
   they are added.

### Verification

The full e2e suite takes hours, so it is not run per PR.

**Every PR:**

- CI: wasm build, lint with the ratchet, typecheck, Vitest, `cargo test`.
- The e2e specs that exercise the code the PR touches, listed in the PR
  description.
- One full composition whose engine output matches the baseline from
  `main`, at the tolerance stated for the phase. Phases 1–4 require
  pixel-identical output. The default is `composition-koi-fish`; add
  `composition-shapes` for drawing, path, selection and transform work.
- The bundle size check (see Budgets).

Which compositions repeat exactly, from running each twice on unchanged
code and hashing the export composite and every layer at each
checkpoint:

| Composition | Covers | Repeats exactly? | Time |
|---|---|---|---|
| `koi-fish` | Brush, pencil, eraser, masks, gradients, selections, layer effects, opacity | Yes: 19 checkpoints, 111 layer reads | 1.2 min |
| `shapes` | Shapes, paths, stroke path, marquee, lasso, wand, fill, copy and paste, flip, rotate | Yes: 17 checkpoints, 90 layer reads | 35 s |
| `export-roundtrip` | 20+ layers, PNG and PSD export | Not tested. No random features found; loads Google Fonts over the network | – |
| `painting` | – | No: uses a scatter brush | – |
| `photoediting` | – | No: Add Noise, Clouds, Smoke | – |
| `cosmic-xray`, `masked-monk`, `uncharted-fjords`, `zen-enclaves` | – | No: Clouds or Add Noise | – |

These runs used the Playwright `chromium` project, which renders with
SwiftShader (software GL). That is why output repeats regardless of the
machine's GPU. Repeatability on a real GPU is not tested.

What varies run to run, and so must stay out of an exact comparison:

- Add Noise, Clouds, Smoke and Fibers each pick a `Math.random()` seed.
- Spray, brush scatter, and brush size and hardness jitter use
  `Math.random()`.
- Brush texture rotation is seeded from the clock at stroke start.
- Speed-based brush size reads the clock between pointer events.

No repeatable composition covers the filters yet. Filter PRs rely on the
targeted filter specs until those seeds can be pinned from a test, which
would make `photoediting` usable too.

**A/B on a cluster.** The two compositions do not reach every tool, so
a PR that converts a group of tools also compares the old and new engine
on the specs that exercise them:

1. `python3 scripts/parity-ab-instrument.py <spec>...` adds a checkpoint
   after every screenshot step and at the end of every test in those
   specs: the engine's export composite, a hash of every layer, and the
   canvas pixels (which also show what is drawn only to the screen).
2. Run the specs with `PARITY_OUT` set, on the new engine.
3. `git checkout <base> -- engine-rs && npm run wasm:build`, run them
   again into a second directory, then `git checkout HEAD -- engine-rs`
   and rebuild.
4. `node scripts/parity-compare.mjs <old-dir> <new-dir>`.
5. `git checkout -- e2e` to drop the instrumentation.

A checkpoint that differs is only a regression if it repeats: tests that
use scatter, jitter or a random filter seed differ between two runs of
the same engine.

**Milestones:** the full e2e suite except the `composition-*` specs,
plus two or three compositions, plus `brush-perf-6k`.

| Milestone | Why here |
|---|---|
| Phase 1 complete | Every GPU call now goes through the pass layer |
| Phase 5 complete | Every shader now comes from WGSL |
| Before wgpu becomes the default (Phase 6) | The backend users run is about to change |

A fourth run after the crate move (3.3) is optional; it is a pure move
and the build catches most of what can go wrong.

### Budgets

Bundle size and initial load time are tracked through the whole
migration, not only at the end.

**Bundle size, every PR.** `npm run wasm:size`
(`scripts/check-bundle-size.mjs`) runs in the CI wasm build job. It
measures the wasm binary and its JS glue, raw and gzipped, and fails if
either is more than 3% over the budget recorded in the script, unless
the PR raises the budget explicitly. The margin absorbs toolchain drift.
Baseline, as built by CI: `lopsy_wasm_bg.wasm` 4.23 MB raw, 1.82 MB gzip;
`lopsy_wasm.js` 236 KB raw, 27 KB gzip. A local macOS build of the same
source is about 1.8% larger. The app's own JS chunks are not covered, because
PR CI does not run `vite build`.

**Initial load time, at milestones and on PRs that change startup
work.** Those PRs are the Phase 2 and Phase 5 foundations and everything
in Phase 6 from 6.2 on. `npm run build && npm run perf:load`
(`scripts/measure-load-time.mjs`) serves the production build and does
several cold loads, each in a freshly launched browser on the real GPU:
SwiftShader's shader compile time is not representative. It reads two
User Timing measures the app records:

- `lopsy:wasm-init`: navigation start until the wasm module is fetched,
  compiled and ready.
- `lopsy:engine-create`: time inside `createEngine`, which is the GL
  context plus compiling about 90 shader programs.

Baseline on an Apple M4 Max, local preview server:

| Measure | Median | First run after a build |
|---|---|---|
| `lopsy:wasm-init` | 138 ms | 148 ms |
| `lopsy:engine-create` | 135 ms | 3,005 ms |

The first run pays the full shader compile; later runs are fast even in
a fresh browser profile, which points to a compiled-shader cache kept by
the OS. The first-run number is what a first-time visitor pays and is
the one most likely to move when shaders change (Phases 5 and 6), so the
script reports the slowest run as well as the median.

| Phase | Bundle size | Load time |
|---|---|---|
| 1 | Flat or smaller: the pass layer replaces repeated GL boilerplate | Flat |
| 2 | Flat | One uniform-block setup per program; expected flat |
| 5 | Up: generated GLSL is more verbose than hand-written | Shader compile time may change; measured in the foundation PR before the fan starts |
| 6 | wgpu adds code (spike S1). It ships as a separate artifact, so a user downloads one backend, not both | Pipelines replace programs; they can be created lazily or asynchronously |

wgpu becomes the default (6.11) only if both numbers are within an
agreed margin of the WebGL path.

---

## 4. Phases

Phases 0–4 do not involve wgpu at all. Each is worth having even if the
migration stopped there, and none commits the project to anything.

| Phase | What | Depends on | Rough size |
|---|---|---|---|
| 0 | Safety net: ratchet, parity check, baselines, spikes | – | 2 PRs |
| 1 | Pass layer on the existing WebGL code | 0 | ~10 PRs |
| 2 | Typed uniform structs | 1 (per module) | ~7 PRs |
| 3 | Engine / host split and subsystem split | 1 | ~4 PRs |
| 4 | Async readbacks at the TS boundary | – | ~3 PRs |
| 5 | WGSL as the shader source, still on WebGL | 2, spike S2 | ~7 PRs |
| 6 | wgpu backend behind a flag, then rollout | 2, 4, 5 | ~5 PRs |
| 7 | Multi-document, headless and FFI hosts, repo layout | 3, 6 | as needed |

PR counts are estimates of scale, not commitments: roughly 35–40 PRs in
total, each holding many commits. Phases 3 and 4 are independent tracks
and can run alongside 1 and 2.

### Merge order

Nothing here needs stacked branches. Every PR is cut from `main` once
its prerequisite has merged. Most phases have the same shape: one
foundation PR, then a fan of PRs that are independent of each other,
then a cap PR that removes what the fan made obsolete.

| Phase | Shape |
|---|---|
| 0 | Two independent PRs |
| 1 | Foundation, fan of eight, cap |
| 2 | Foundation (`.uniforms()` plus the first shader family), then a fan by shader family. A family needs only the Phase 1 PR for the modules that use it, not all of Phase 1 |
| 3 | Sequential: 3.1–3.2, 3.3, 3.4, 3.5 |
| 4 | Three independent PRs, independent of every other phase |
| 5 | Foundation (build step plus first shaders), then a fan by shader family |
| 6 | Sequential, behind a cargo feature |

What makes the fans safe:

- **Phase 1:** the neutral-state contract, so converted and unconverted
  modules can interleave in any order, and clusters that each own their
  shared helper, so none has to wait for another.
- **Phases 2 and 5:** each shader's uniform block and source file are
  private to that shader.

Fan PRs are also the ones that parallelise, across people or agent
worktrees. The only file they all touch is the ratchet allowlist, where
each lowers different lines.

Two scheduling constraints:

- **The crate move (3.3)** renames the path of every engine file and
  conflicts with any open engine PR. Do it at a quiet point, between the
  Phase 1 cap and the start of Phase 2, or between Phases 2 and 5.
- **Sequential PRs can be stacked** to work ahead of review (Phases 3
  and 6, the two compositor PRs), but nothing requires it.

### Phase 0 — Safety net

No engine code changes. Two PRs: CI guards (0.1, 0.2) and the
composition parity tooling with baselines (0.3, 0.4). The spikes are not
merged.

**0.1 GL-reference ratchet.** Add `scripts/check-gl-debt.mjs`, modelled
on `scripts/check-pixel-debt.mjs`: a per-file allowlist of how many raw
GL references each file outside `gpu/` may contain. Counts may only go
down. Wire it into `npm run lint`. This is the smallest possible first
change and it makes progress visible from then on.

**0.2 `cargo test` in PR CI.** `pr.yml` does not run it today.

**0.3 Composition parity check.** Reuse the existing composition specs
instead of building a new scene suite.

- `e2e/parity.ts` adds `parityCheckpoint(page, composition, name)`.
  When `PARITY_OUT` is set it writes the engine's output at that point:
  the export composite as raw bytes and a hash of every layer. It does
  not use page screenshots, which include UI chrome. Without
  `PARITY_OUT` it does nothing. `koi-fish` and `shapes` call it at each
  of their existing screenshot steps.
- `scripts/parity-compare.mjs` compares two output directories and
  reports the largest per-channel difference.
- `npm run parity:record` writes `.parity/baseline`; run it on `main`.
- `npm run parity:check` writes `.parity/current` on the branch and
  compares. Both take under two minutes.

The baseline is recorded from `main` on the same machine that checks the
branch, so GPU and driver differences cancel out and refactor phases can
demand pixel-identical output. No golden images are committed.

`koi-fish` and `shapes` have been checked this way and repeat exactly
(see Verification). Any other composition is recorded twice on `main`
before it is relied on.

**0.4 Baselines and budgets.** Record the `brush-perf-6k` numbers and
the initial load time, and add the bundle size check to CI (see
Budgets), so later phases have something to compare against.

**0.5 Spikes.** Throwaway branches, never merged. Each answers one
question the later phases depend on:

| Spike | Question | If the answer is no |
|---|---|---|
| S1 | How much does wgpu add to the wasm bundle, WebGPU-only? | Ship it as a second artifact loaded only where used (already the plan for rollout) |
| S2 | Can naga turn WGSL into GLSL ES 3.00 at build time for `blend`, `adjustments` and `stroke_edt`, with output the WebGL backend can bind? | Phase 5 keeps GLSL and WGSL side by side, checked against each other by the composition check |
| S3 | Does a native wgpu surface on Metal give display-P3 and extended range? | Reach past wgpu to the `CAMetalLayer` for presentation only |

### Phase 1 — Pass layer on WebGL

Tolerance: bit-identical.

**1.1 Introduce `gpu::pass`.** `gpu/pass.rs` holds the builder,
implemented with the same GL calls the engine makes today, and
`EngineInner::pass(program)` starts one. In this phase the builder takes
uniforms by name (`.f32("u_opacity", 1.0)`), so each conversion is a
mechanical one-to-one rewrite.

**Neutral-state contract.** Converted and unconverted code coexist for
the whole phase, on one GL context. A pass therefore changes only the
state it is told to set, and puts that state back afterwards:

- `Blend::Inherit` and `Scissor::Inherit`, the defaults, leave the
  context as found. A converted call site states its blend and scissor
  only where the hand-written code did.
- A blend mode that enables blending is switched off again after the
  draw, and a scissor rect is disabled again.
- `Target::Texture` unbinds the framebuffer afterwards, as
  `render_to_texture` did. `Target::Framebuffer` leaves it bound, as the
  code it replaces did.

The `Inherit` variants exist only for this transition. The cap PR (1.5)
removes them, so every pass states its full state, and adds state
caching to skip redundant GL calls.

**1.2 Convert modules by cluster.** One commit per file, or per function
group for the large ones. Counts are the ratchet baselines when the
migration started.

Modules are grouped by the helpers they share, not by size, because
three helpers expose GL types across module boundaries:

- `EngineInner::render_to_texture(&WebGlTexture, ..)`, called from 18
  files.
- `filter_gpu::apply_filter*`, whose `set_uniforms` closure receives the
  raw GL context; called from every `api/filter/*` file and
  `api/color_mode`.
- `dab_pass_gpu::scratch_dab_pass` and `with_scissor`, called from the
  dab-based tools.

Each shared helper is converted together with its callers, in its own
cluster PR, so no cluster waits on another. `render_to_texture` is
replaced by the pass builder itself and is deleted in the cap PR (1.5)
once its last caller is gone.

| PR | Cluster | Files | State |
|---|---|---|---|
| #1645 | Foundation | `gpu::pass` and leaf modules: `glyph_atlas` 4, `api/paint` 13, `text_transform_gpu` 20, `content_bounds_gpu` 21 | In review |
| #1646 | Dab tools | `clone_stamp_gpu` 11, `smudge_gpu` 12, `dab_pass_gpu` 15, `stamp_preview_gpu` 31, `healing_brush_gpu` 37, `coverage_stroke_gpu` 55 | In review |
| #1648 | Brush | `brush_gpu` 187 | In review |
| #1649 | Gradients and masks | `gradient_gpu` 72, `mask_paint_gpu` 94, `quick_mask_gpu` 99 | In review |
| #1650 | Shapes, selection, fill | `api/fill` 28, `selection_gpu` 31, `shape_gpu` 36 | In review |
| – | Filters | `filter_gpu` 104, `api/color_mode` 1, `api/filter/`: `adjust` 9, `noise` 17, `preview` 17, `render` 42, `blur` 44, `distort` 57, `stylize` 70 | Not started |
| – | Layers | `thumbnail_gpu` 35, `layer_transform_gpu` 45, `engine.rs` 125, `layer_manager` 446 | Not started |
| – | Compositor | `effect_cache_gpu` 40, `compositor` 663 | Not started |
| – | Cap | 1.5 | Not started |

The PRs so far are stacked in the order listed, because nothing merged
while they were written. In content each cluster depends only on the
foundation.

The grouping moved from the first draft of this plan as the shared
helpers became clear: gradients travel with the two mask modules, which
called the gradient uniform helper; the layer transform and thumbnails
travel with the layers cluster.

What the remaining clusters need that the pass layer does not have yet:

- **Filters:** an unsigned-integer uniform setter; a pass-based version
  of `compositor::set_standalone_adjustment_uniforms`, which Brightness /
  Contrast calls with a raw GL program; and, for an exact A/B, a pinned
  `Math.random` in the test page, because Add Noise, Clouds, Smoke and
  Fibers take their seed from it.
- **Layers:** a target for 8-bit staging textures (thumbnails and the R8
  mask readback render into textures that are not in the pool's format);
  a clear limited to a rect; and `bind_transform_program`, which the
  layer transform and `layer_manager`'s float transform share.
- **Compositor:** the persistent framebuffers and the screen target,
  which the pass layer has but nothing uses yet.

`compositor.rs` splits along its own stages: present, layer blend,
behind-effects, above-effects, group adjustments, document adjustments,
overlays, export. `layer_manager.rs` splits into upload, read, duplicate
and snapshot, resize and crop.

**1.3 Remove raw GL types from signatures.** The ~50 functions that take
`&WebGlTexture` or `&WebGl2RenderingContext` change to take
`TextureHandle` or a pass builder. This includes the
`set_uniforms: impl FnOnce(&WebGl2RenderingContext, &ShaderProgram)`
closures in `filter_gpu.rs`. Done alongside each module's conversion.

**1.4 Route uploads, copies and readbacks through `gpu`.** `read_pixels`,
`tex_image_2d`, `blit_framebuffer` and the canvas upload become methods
on the backend.

**1.5 Close the door.** Make `EngineInner.gl` private to `gpu/`. The
ratchet is now zero and the script becomes a hard ban.

End state: `web_sys` GL types appear only in `gpu/` and in engine
creation.

### Phase 2 — Typed uniforms

Tolerance: bit-identical.

Per shader, in one commit:

1. Replace the shader's loose uniforms with one `Params` uniform block.
2. Add a matching Rust struct.
3. Change its call sites from named setters to `.uniforms(&Params {..})`.
4. Add a unit test that the struct's layout matches the block.

PRs follow the shader directories: core blits and transforms; filters
in two or three; effects; the brush family; gradient, shape, selection
and text; then `blend` with `adjustments`.

The WebGL backend uploads the struct as a uniform buffer. Sampler
bindings are already handled by `.texture(..)` from Phase 1.

Order: smallest shaders first (`blit`, `invert`, `threshold`,
`posterize`), `blend.glsl` and the brush dab family last.

Traps:

- `vec3` and `mat3` padding differs between a naive Rust struct and the
  block layout. The layout test exists to catch this.
- The brush dab path uploads uniforms once per dab. Run `brush-perf-6k`
  before and after converting those shaders. If a per-dab buffer upload
  is slower on WebGL, the WebGL backend can keep setting those few
  shaders' uniforms individually behind the same typed interface.

### Phase 3 — Engine / host split

Tolerance: bit-identical. These are moves and renames. Four PRs: 3.1
with 3.2, then 3.3, 3.4 and 3.5.

**3.1 Thin the API layer.** `api/` files contain rendering logic today
(`api/layer.rs`, `api/filter/stylize.rs`). Move that logic down into
engine functions so each export only converts arguments and calls one
function.

**3.2 Abstract the remaining browser touch points.** Canvas upload
becomes a backend method taking a host-defined external image. Console
logging goes through a small host hook.

**3.3 Create `lopsy-engine`.** Move the engine modules into a crate with
no `wasm_bindgen`. `lopsy-wasm` keeps `lib.rs` and `api/`. One module
family per commit.

**3.4 Split `EngineInner` into subsystems.** One struct per commit:
brush state, floating selection, clipboard, previews, overlays, group
adjustments. No behaviour change; fields move, access paths change.

**3.5 Separate `imaging` from `document`.** Filters and adjustments move
under `imaging/` as operations that take a source texture, a destination
and parameters. The compositor's adjustment pass becomes a call to the
same standalone function. This is what lets a raw editor use the develop
pipeline without the layer machinery.

This differs from the earlier suggestion to do the imaging split during
Phase 1. Keeping it separate makes both sets of PRs smaller.

### Phase 4 — Async readbacks

Tolerance: bit-identical output; this phase changes TypeScript
signatures.

WebGPU has no synchronous readback on the web. The bridge wrappers
change to return Promises while the implementation underneath is still
synchronous, one function per commit, with its callers. Three PRs:
export and backup; thumbnails and clipboard; the interactive paths.

Current call sites, outside tests:

| Function | Callers |
|---|---|
| `readLayerAsImageData` | 8 |
| `compositeForExport` | 5 |
| `readLayerThumbnail` | 4 |
| `readLayerPixels` | 3 |
| `readLayerCompressed`, `readSelectionMask`, `getLayerContentBounds`, `readClipboardPixels`, `rasterizeLayerEffects` | 2 each |
| `sampleColor`, `readQuickMaskPixels`, `readCompositeThumbnail`, `exportPng16`, `readLayerPixelsForFill`, `readChannelThumbnail` | 1 each |

Order: non-interactive first (export, thumbnails, backup, clipboard),
interactive last (eyedropper, bucket fill, content bounds).

Each interactive caller needs a decision about what happens if the
document changes between the request and the result: the eyedropper
takes the latest result and drops stale ones; fill checks the layer's
content generation before applying. Undo is unaffected, since history
snapshots are GPU-side copies with no readback.

### Phase 5 — WGSL as the shader source

Gate: spike S2. Tolerance: at most one 8-bit step per channel, with the
measured maximum per shader recorded in each PR. PRs: the build step
with the first few shaders, then the same shader families as Phase 2.

**5.1 Build step.** `build.rs` runs naga over each `.wgsl` file and
emits GLSL ES 3.00 plus a binding table. The WebGL backend consumes
that. naga is a build dependency only and adds nothing to the wasm
bundle.

**5.2 Port shaders, one per commit.** Because Phase 2 already gave each
shader a single uniform block and typed struct, a port changes only the
shader body. Ported shaders run for every user on the existing WebGL
backend as soon as their PR merges, so problems surface a family at a
time, and bisect to one shader, instead of appearing at a backend
switch.

**5.3 Includes and variants.** The `//#include` splice
(`hsl_common`, `premul_sample`, `lab_common`) and the `BLEND_MODE`
define injection carry over as string preprocessing before naga runs.

Order: `blit` first, then by size, with `blend` and the brush dab
header, body and footer assembly last.

If S2 fails, this phase instead adds a `.wgsl` file beside each `.glsl`
file, unused until Phase 6, and the compositions compare the two once
the wgpu backend can run them.

### Phase 6 — wgpu backend

Tolerance: set from measurement in 6.8.

Because every feature already goes through the pass layer, the backend
implements about ten primitives and all features work at once. There is
no per-feature porting in this phase.

The wgpu build is a second wasm artifact behind a cargo feature. The
default bundle does not change until rollout.

| Step | Content | PR |
|---|---|---|
| 6.1 | `gpu/wgpu` skeleton; CI builds the second artifact; nothing loads it | 1 |
| 6.2 | Device and surface creation, clear, present; `?renderer=wgpu` in dev builds | 1 |
| 6.3 | Texture pool, byte uploads, external-image upload | 1 |
| 6.4 | Passes: pipeline cache keyed by program, blend and target format; bind groups; uniform buffer; scissor | 1 |
| 6.5 | Texture-to-texture copy | 1 |
| 6.6 | Async readback and thumbnails | 2 |
| 6.7 | Device loss wired to the existing backup and restore path | 2 |
| 6.8 | All compositions on wgpu against the WebGL baseline; fix differences; fix the tolerance | 3 |
| 6.9 | `brush-perf-6k` on both backends | 3 |
| 6.10 | Headless native host; render tests runnable from `cargo test` | 4 |
| 6.11 | Rollout: opt-in setting, then default where WebGPU exists, WebGL otherwise | 5 |

PR 1 is the largest in the plan, but it is all new code behind a cargo
feature that the default build does not compile.

Orientation: WebGL and WebGPU disagree on which way is up. For
render-to-texture the difference is expected to reduce to the vertex
shader's UV calculation, plus a flip in the final blit to the screen.
The backend owns both. This is the most likely source of parity
failures in 6.8.

### Phase 7 — Multiple consumers

Started when a second app is actually being built.

- **Multi-document.** Today one engine is one canvas and one document.
  Split into a shared device, a `Document` that owns layer textures and
  compositor state, and a `Surface` that presents one. Needed for a file
  browser grid and for bulk export.
- **FFI host.** A C interface over the same engine functions the wasm
  host calls.
- **Repo layout.** Move `engine-rs/` to `engine/` and `src/` to
  `apps/lopsy-web/`. Large diffs, purely mechanical, one directory per
  PR.

---

## 5. What stays the same

- The wasm-bindgen export names, through Phases 1–3, 5 and 6. Only
  Phase 4 changes TypeScript signatures.
- `engine-sync.ts` and the Zustand document model.
- GPU-side undo snapshots and the snapshot ledger.
- The context-loss backup and restore path.

---

## 6. Risks

| Risk | Where | Mitigation |
|---|---|---|
| Code relies on GL state leaking between draws | Phase 1 | Neutral-state contract; bit-identical parity check; one module per commit for bisecting |
| Uniform block layout mismatch | Phase 2 | Layout unit test per struct |
| Per-dab uniform buffer upload slower on WebGL | Phase 2 | Benchmark; keep individual uniforms for those shaders if needed |
| Async readback reorders work | Phase 4 | One function per commit; generation checks on interactive paths |
| naga's GLSL output differs numerically from hand-written GLSL | Phase 5 | Per-shader commits with measured tolerance |
| Orientation mismatch | Phase 6 | Backend owns the convention; composition check |
| Shader compile hitches (93 programs plus blend variants as pipelines) | Phase 6 | Keep the lazy blend-variant cache; create pipelines asynchronously |
| The per-PR subset misses a path | all | Composition matched to the cluster; targeted specs; full suite at milestones; nightly e2e as the backstop |
| A composition is not deterministic run to run | Phase 0 | Use `koi-fish` and `shapes`, which are checked; record any other twice on `main` first |
| Bundle size or load time creeps up across many PRs | all | Size budget in CI on every PR; load time at milestones and on startup-affecting PRs |

---

## 7. Not yet verified

These are assumptions until the Phase 0 spikes run:

- wgpu's bundle size cost in wasm.
- That naga's GLSL ES output is usable by the existing WebGL backend for
  every shader.
- wgpu's control over surface colour space and extended range on native.
- That `koi-fish` and `shapes` repeat exactly on a real GPU; they were
  checked on SwiftShader only.
- Whether `export-roundtrip` repeats exactly.
- WebGPU availability on Linux browsers.
