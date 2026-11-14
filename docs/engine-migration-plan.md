# Engine Migration Plan: WebGL → portable engine on wgpu

Goal: turn `engine-rs/` into an engine that several apps can consume
(Lopsy web, a native Lopsy, a raw editor, iOS apps), rendering through
wgpu so one codebase covers WebGPU, Metal, Vulkan and DX12.

Constraint: the work merges to `main` in reviewable batches, each leaving
Lopsy unchanged for users. There is no long-lived rewrite branch.

Status: in progress.

| Phase | State |
|---|---|
| 0 | Done (#1643, #1644). Spikes S1 and S2 done (results under Phase 0); S3 not run |
| 1 | Done (#1645, #1646, #1648 to #1653, #1667, cap #1683): no raw GL is left outside `gpu/` and the context is private to it. Milestone run on the cap, chromium: 1,449 e2e tests passed, 7 skipped, 1 failed (`history › redo all steps after undoing everything`, which passes on a re-run on either engine), and 7,065 checkpoints compared against `main`'s engine show no difference that repeats. Firefox and `brush-perf-6k` were not run |
| 2 | Done (#1685 to #1691): every shader takes a typed uniform struct and the by-name setters are gone. Results under Phase 2 |
| 3 | Done (#1693, #1694, #1696, #1697), except that ten multi-pass filters are still staged from `commands/`; see 3.5 |
| 4 | Export, thumbnail and clipboard readbacks answer with a Promise (#1699, #1698); Flatten Image and Copy Merged no longer read back, and the eyedropper awaits (#1701); Rasterize Layer Style, Merge Down and the filter preview commit no longer read back, and wand, bucket fill, quick select and feather await (#1702); selecting a layer's pixels and content bounds no longer block (#1703); mask bytes stay on the GPU and the layer backup awaits its reads (#1704). Commands that read inside the engine answer with a Promise or no longer read (#1705), and the last synchronous layer read is deleted (#1706). Phase 4 is done on the TypeScript side: nothing above the bridge reads the GPU synchronously. What is left is Rust's, in 6.6; see Phase 4 |
| 5 | Started. The build step and the first four shaders (`blit`, `invert`, `posterize`, `blit_resample`) are in #1707; eight more (`color_convert`, `mask_expand`, `color_overlay`, `flip`, `threshold`, `rotate90`, `mask_luminance`, `blit_region`) in #1708; eight more (`sharpen`, `solarize`, `pixelate`, `selection_mask_blend`, `bloom_threshold`, `chromatic_aberration`, `opacity_clamp`, `flood_fill_apply`) in #1710; six more (`mask_remap`, `composite`, `tonemap`, `hue_sat`, `color_lut`, `box_blur`) in #1711. Four shaders no pass used are removed (#1712), two of them already ported, so 24 are in WGSL and about 61 remain |
| 6–7 | Not started |

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
engine.pass(&engine.shaders.posterize, PosterizeParams { levels: 4.0 })   // the shader's uniform struct
    .texture("u_tex", scratch)
    .scissor(Scissor::Rect(rect))        // Off | Rect
    .blend(Blend::Off)                   // Off | PremulOver | Max | OverKeepAlpha
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
3. No raw GL outside `gpu/` (`scripts/check-gl-debt.mjs`).
4. New dependencies are pinned and at least seven days old at the time
   they are added.

### Verification

The full e2e suite takes hours, so it is not run per PR.

**Every PR:**

- CI: wasm build, lint with the raw-GL check, typecheck, Vitest, `cargo test`.
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
| 2 | Measured: wasm +1.1% raw (4,293,925 bytes against 4,246,140 on the same machine). The typed wrappers are thin over an untyped core; without that it was +4.7% | Measured flat: `wasm-init` 134 ms, `engine-create` 128 ms median; 496 ms on the first run after the build |
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

`main` takes squash merges, one commit per PR. A chain of PRs that each
target the branch below survives that only as a GitHub stack (linked
with `gh stack` or the stacks API): the stack merges from any PR
downward in one operation, each PR as its own commit, and GitHub rebases
what is left. Unlinked, every squash leaves the next PR conflicting.
Phase 1's nine conversion PRs went in that way.

Most phases have the same shape: one foundation PR, then a fan of PRs
that are independent of each other, then a cap PR that removes what the
fan made obsolete. Open them as one stack, or cut each from `main` once
its prerequisite has merged.

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

- **Phase 1:** the transitional `Inherit` states, so converted and
  unconverted modules could interleave in any order, and clusters that
  each owned their shared helper, so none had to wait for another.
- **Phases 2 and 5:** each shader's uniform block and source file are
  private to that shader.

Fan PRs are also the ones that parallelise, across people or agent
worktrees.

Two scheduling constraints:

- **The crate move (3.3)** renames the path of every engine file and
  conflicts with any open engine PR. Do it at a quiet point, between the
  Phase 1 cap and the start of Phase 2, or between Phases 2 and 5.
- **A stack assumes `main` holds still underneath it.** Another PR
  merging in between can break a stacked PR without touching its files:
  in Phase 1 an unrelated fix lowered a file's raw GL count and failed
  the ratchet baseline the stack had recorded.

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

**Spike results.** S1 and S2 were run on the local branch
`theseamusjames/spike-wgpu-naga` (code under `spikes/`, not pushed,
never to be merged). S3 has not been run.

*S1: WebGPU-only wgpu is small; wgpu's own WebGL backend is not.*
Built with the engine's release profile and wasm-opt flags, wgpu 30.0.1:

| Build | wasm raw | wasm gzip | Against the engine's wasm |
|---|---|---|---|
| wgpu, WebGPU only | +112 to +133 KB | +44 to +51 KB | about +3% |
| wgpu, WebGPU and its WebGL backend | +3.2 MB | +1.06 to +1.09 MB | about +74% raw, +58% gzip |

The range is a minimal renderer against one that also exercises
uploads, a uniform buffer, blending, scissor, copies and readback. This
confirms the choice in section 2: keep the hand-written WebGL backend as
the fallback and ship wgpu with only WebGPU enabled. A build with both
wgpu backends does pick WebGPU or WebGL at runtime, but at that size.

*S2: yes, with conditions.* naga 30.0.1 emitted valid `#version 300 es`
fragment GLSL for `blit`, `blit_resample`, `gaussian_blur`, `stroke_edt`
and all 16 modes of `blend`. Compiled in WebGL2 against the existing
vertex shader, the generated shaders rendered bit-identically to the
hand-written ones over 82 cases, in RGBA8 and RGBA16F, on SwiftShader
and on an Apple M4 Max. Conditions and findings:

- The build step must rename naga's varying to `v_uv` (GLSL ES 3.00
  links varyings by name) and can rename samplers and the output the
  same way. The existing vertex shader then works unchanged.
- Uniforms arrive as one std140 block per shader. naga's struct offsets
  matched what GL reported for every member.
- `BLEND_MODE` variants must be selected by text preprocessing before
  naga, as planned; a WGSL `const` does not prune the dead branches.
- WGSL constructs to avoid: `array<f32, N>` in a uniform struct (pack as
  `array<vec4<f32>, N/4>`), swizzle assignment, and one texture used
  with two samplers.
- **Passing naga does not prove a shader loads on WebGPU.** A
  `textureSample` after a varying-dependent early return is accepted by
  naga and rejected by Chromium's WebGPU compiler; `blend` does this and
  needs `textureSampleLevel`. Phase 5 therefore also validates each WGSL
  file in headless Chromium's WebGPU, which runs on SwiftShader.
- Size: generated GLSL is larger for small shaders and smaller for
  `blend` per variant, but 16 separate blend variants add about 133 KB
  of raw wasm (about 0.6 KB gzipped). The bundle budget will need
  raising for that, on purpose.
- naga's `var<immediate>` comes out as a plain uniform struct, not a
  block, so the per-dab shaders could keep individual uniform calls from
  the same WGSL. Translated only, not rendered.

Not covered by the spike: `filters/adjustments.glsl` and the brush dab
header, body and footer assembly were not ported; shader compile time of
the generated GLSL was not measured; no GPU other than Apple Metal.

*A dependency to sequence.* wgpu 30.0.1 needs wasm-bindgen 0.2.127 or
later. The engine locks 0.2.114, so a wasm-bindgen bump (and the matching
CLI in wasm-pack) comes before Phase 6.

### Phase 1 — Pass layer on WebGL

Tolerance: bit-identical.

**1.1 Introduce `gpu::pass`.** `gpu/pass.rs` holds the builder,
implemented with the same GL calls the engine makes today, and
`EngineInner::pass(program)` starts one. In this phase the builder takes
uniforms by name (`.f32("u_opacity", 1.0)`), so each conversion is a
mechanical one-to-one rewrite.

**State contract.** Between passes the context is in one known state:
blending off and the scissor test off. A pass that turns either on turns
it off again when it ends, from `Drop`, so an early return cannot leave
it on. `Target::Texture` unbinds the framebuffer afterwards;
`Target::Framebuffer` leaves it bound.

While the engine was being converted the contract was weaker: passes had
`Inherit` blend and scissor states that left the context as found, so
converted and hand-written GL code could interleave on one context. The
cap removed them.

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
replaced by the pass builder itself and was deleted with its last
caller, in the compositor PR.

| PR | Cluster | Files | State |
|---|---|---|---|
| #1645 | Foundation | `gpu::pass` and leaf modules: `glyph_atlas` 4, `api/paint` 13, `text_transform_gpu` 20, `content_bounds_gpu` 21 | Merged |
| #1646 | Dab tools | `clone_stamp_gpu` 11, `smudge_gpu` 12, `dab_pass_gpu` 15, `stamp_preview_gpu` 31, `healing_brush_gpu` 37, `coverage_stroke_gpu` 55 | Merged |
| #1648 | Brush | `brush_gpu` 187 | Merged |
| #1649 | Gradients and masks | `gradient_gpu` 72, `mask_paint_gpu` 94, `quick_mask_gpu` 99 | Merged |
| #1650 | Shapes, selection, fill | `api/fill` 28, `selection_gpu` 31, `shape_gpu` 36 | Merged |
| #1651 | Filters | `filter_gpu` 104, `api/color_mode` 1, `api/filter/`: `adjust` 9, `noise` 17, `preview` 17, `render` 42, `blur` 44, `distort` 57, `stylize` 70 | Merged |
| #1652 | Staging uploads, readbacks, thumbnails | `thumbnail_gpu` 35, `engine.rs` 117 of 125 | Merged |
| #1653 | Layers | `layer_transform_gpu` 45, `layer_manager` 446 | Merged |
| #1667 | Compositor | `effect_cache_gpu` 40, `compositor` 663, 5 of the last 8 in `engine.rs` | Merged |
| #1683 | Cap | 1.5 | Merged |

The cluster PRs were written as a chain and merged together as a GitHub
stack. In content each cluster depends only on the foundation.

The grouping moved from the first draft of this plan as the shared
helpers became clear: gradients travel with the two mask modules, which
called the gradient uniform helper; the layer transform and thumbnails
travel with the layers cluster.

How the compositor was converted, since it is the one cluster that
could not be done mechanically:

- **Framebuffer hand-offs became explicit targets.** Helpers used to
  leave a framebuffer bound for whatever ran next, and export read the
  composite back from whichever one the last pass left bound. Every
  pass now names its target, and export reads the composite texture by
  handle.
- **Textures travel as handles.** The compositor's own
  `Target { tex, fbo }` is now `DocTarget`, and layer, mask and effect
  textures are `TextureHandle`s instead of cloned `WebGlTexture`s.
- **Four copies of the blend setup became one.** The layer blend, the
  effect blend and the two mask overlays all go through
  `blend_through_scratch`.
- **The adjustment helpers build passes**, so Brightness / Contrast no
  longer needs `Pass::raw_uniforms`, which is gone.
- **`present` asks the pass layer for the screen size**
  (`GpuRef::screen_size`) instead of reaching into the GL context.

Benchmarked on the real GPU (ANGLE Metal, M4 Max) with
`e2e/effect-cache-perf.spec.ts`, a 4000×4000 document with 20 styled
layers: brushing and panning take the same time per input event on the
old and new engine (18 ms and 19 ms). A forced full composite takes
8.3 ms against 8.4 ms including the GPU drain; its CPU side went from
5.8 ms to 5.95 ms, because each blend makes a few more GL calls than the
hand-written code did. The cap's state caching is where that comes back.

Two things the conversion found that Phase 2 has to deal with, because
both work only while uniforms are per-program state that survives
between draws:

- **Passes that leaned on an earlier draw's uniforms.** The third pass
  of a blurred glow or shadow set only what changed from the first and
  relied on the colour, spread, opacity and document size still being
  on the program. Those passes now set every uniform they read.
- **One that still does.** `render_layer_plus_stroke` draws with
  `composite.glsl` and sets none of its brush-texture uniforms
  (`u_hasBrushTexture`, `u_textureScale`, `u_layerOffset`, ...). It gets
  whatever the last `end_stroke` left on the program. That is today's
  behaviour, kept as is; a typed uniform struct will force a decision.

The conversion also made unused samplers safe: a sampler uniform the
draw does not read (mask, backdrop, the adjustment LUTs, the glow's
original layer) now points at the source texture's unit, so it cannot
alias the render target whatever an earlier pass left bound.

**1.3 Remove raw GL types from signatures.** The ~50 functions that take
`&WebGlTexture` or `&WebGl2RenderingContext` change to take
`TextureHandle` or a pass builder. This includes the
`set_uniforms: impl FnOnce(&WebGl2RenderingContext, &ShaderProgram)`
closures in `filter_gpu.rs`. Done alongside each module's conversion.

**1.4 Route uploads, copies and readbacks through `gpu`.** `read_pixels`,
`tex_image_2d`, `blit_framebuffer` and the canvas upload become methods
on the backend.

**1.5 Close the door.** Done in the cap:

- The texture pool, the framebuffer pool and the shader set each hold
  their own handle to the context, instead of being passed it at about
  190 call sites. `EngineInner` has no `gl` field and `GpuContext`'s is
  visible only inside `gpu/`, so feature code cannot reach the context
  at all. `scripts/check-gl-debt.mjs` has no baselines left and fails on
  any GL type or call named outside `gpu/`.
- `Blend::Inherit` and `Scissor::Inherit` are gone. `Off` is the default
  and costs no GL call, because the state contract above already
  guarantees it; that also drops the explicit disable calls `Off` used
  to make.

- Uniforms are set through a borrowed location. The cache used to hand
  out a clone, and cloning a location is a round trip into JS and back,
  twice per uniform. On the 20-styled-layer benchmark that takes the CPU
  side of a composite from 6.02 ms to 5.91 ms, about what the compositor
  conversion had added.

Moved out of the cap, with the reason:

- **A pass unbinding its own textures** is still not done. The reason
  first given here was wrong: the brush-texture uniforms and sampler
  that `render_layer_plus_stroke` appeared to inherit are declared in
  `composite.glsl` and `blend.glsl` but read by neither, and Phase 2
  removed them. What is left is cost. Unbinding after every pass adds
  two GL calls per texture, on a path where calls into JS are most of
  the CPU time. The cheaper design is for `gpu` to remember what each
  unit holds and unbind only a texture that is about to become the
  render target; that would also retire the `unbind_textures` calls and
  the parked samplers (`sampler_unit`) in feature code.
- **Caching program and framebuffer binds** is not done. Blend and
  scissor needed no cache once the contract made them free. The
  remaining redundant calls are one `use_program` and one framebuffer
  bind per pass; the framebuffer pool and the texture pool both bind
  outside the pass layer, so a cache would have to cover them too.
- **`Target::Framebuffer` and `DocTarget`'s framebuffer half stay.**
  They are how the compositor avoids re-attaching a texture for every
  draw into the composite and scratch targets. They become texture
  views when the wgpu backend arrives (Phase 6).

End state: `web_sys` GL types appear only in `gpu/` and in engine
creation.

### Phase 2 — Typed uniforms

Tolerance: bit-identical.

A pass is created with the shader's uniform struct:

```rust
engine.pass(&engine.shaders.posterize, PosterizeParams { levels: 4.0 })
```

so every value uniform is given on every pass, and a wrong name or type
does not compile. Per shader:

1. Its non-sampler uniforms are one `Params` block in the GLSL source
   (`layout(std140) uniform Params { ... };`). Samplers stay outside.
2. `gpu/params/<family>.rs` has the matching struct, declared with
   `uniforms!`. Field `layer_offset` feeds member `u_layerOffset`.
3. `typed_shaders!` in `gpu/shader.rs` ties the source to the struct,
   and one unit test checks every struct against its block: same
   members, same types, same order, nothing left outside the block.
4. Call sites build the struct. `()` is the struct of a shader that only
   samples. A tool that redraws per dab keeps its struct and hands
   `ActivePass::set` a copy with the new centre.

**How the WebGL backend uploads it.** Not as a uniform buffer, which is
what this plan first said. The backend compiles the block as plain
uniforms (`flatten_params_block`, a line-for-line text rewrite at
program link) and sets members one by one, skipping any whose value is
what the program already holds. The block in the source is still the
single description of the interface, and it is what a WGSL port and the
wgpu backend will read.

The reason is a measurement. A fragment shader with fourteen uniforms,
drawn into a 4000×4000 RGBA16F target, median time per frame including
a readback that drains the GPU:

| Draws per frame | Backend | Plain uniforms | Buffer, `bufferSubData` | Buffer, `bufferData` (orphaned) |
|---|---|---|---|---|
| 60 full-target | ANGLE Metal | 6.3 ms | 6.4 ms | 6.3 ms |
| 400 scissored to 96 px | ANGLE Metal | 0.7 ms | 1.0 ms | 0.8 ms |
| 2,000 scissored to 32 px | ANGLE Metal | 2.1 ms | 5.3 ms | 4.2 ms |
| 60 full-target | ANGLE OpenGL | 1.9 ms | 24.9 ms | 1.7 ms |

A buffer buys nothing at compositor rates, costs two to two and a half
times as much at brush-dab rates, and with `bufferSubData` stalls
outright on one backend. ANGLE's Direct3D backend, which is what Chrome
uses on Windows, could not be measured here. Plain uniforms carry none
of that risk. Phase 5 decides again for naga's output, which declares a
block: its build step can flatten it the same way.

Skipping unchanged members is safe because a program's uniforms keep
their value between passes and a typed program's are written nowhere
else. It replaces the per-dab uniform slots of Phase 1: a dab sends only
its centre.

**PRs**, written as a chain and opened as one GitHub stack:

| PR | Family | Shaders |
|---|---|---|
| #1685 | Foundation | `gpu::uniforms`, `Pass` created with a struct; `blit`, `invert`, `posterize`, `threshold` |
| #1686 | Core | copies, flips, remaps, transforms, clipboard, selection fill, content bounds |
| #1687 | Filters | every filter but `adjustments` and `vignette`, with `color_convert` and `tonemap` |
| #1688 | Gradients, shapes, fill, selection, text | |
| #1689 | Brush | the dab shaders and the retouching tools |
| #1690 | Compositor | `blend`, `composite`, `final_blit`, the layer effects, `adjustments`, `vignette` |
| #1691 | Cap | removes the by-name setters, the uniform slots and the untyped constructors |

While the chain was open, an unconverted shader went through
`pass_untyped` and the `*_untyped` filter helpers; the cap deleted them.

**What every-field-every-pass turned up.** Each of these read a uniform
some earlier pass had left on the program. The conversion had to pick a
value; where the old value could reach a pixel, it is a behaviour fix.

- **Box Blur** never set `u_step`, so it ran with the stride of the last
  large Gaussian Blur (radius over 63). It passes 1.
- **Merge Down, the Move float and the transform commit** blend with the
  Normal program and never set `u_maskOverlay`, `u_hasBackdrop` or
  `u_docColorMode`; they used whatever the last composite's final
  Normal blend left. They pass 0 and the document's mode. Whether a
  stale mask tint could be reached from the UI was not tried.
- Unread in the pass that left them unset, so no effect: clipboard copy's
  `u_extendPastCanvas` without a mask, mask-pencil's selection uniforms,
  the Gaussian weights past the radius, gradient stops past the count.

Also found: `blend.glsl` and `composite.glsl` declared brush-texture
uniforms and a sampler that neither reads; removed. `marching_ants` and
`text_glyph` were compiled at startup and used nowhere; removed in
#1712, with `opacity_clamp` and `tonemap`, which were unused too.

**Left for Phase 5**, where each shader is rewritten anyway. WGSL cannot
hold these in a uniform struct as they stand:

- `float` arrays (`u_weights[64]`, `u_stopPositions[16]`): pack as
  `vec4` arrays (spike S2).
- `bool` members (`noise`, `texture`): make them `int`.
- `mat2` (`mask_remap`, the brush dab transform): WGSL lays it out
  differently from std140; pass a `vec4`.

Renamed so a field name maps to them: `adjustments.glsl`'s
`u_cb_shadows`-style names to camelCase, `emboss.glsl`'s `u_type` to
`u_embossType`, `text_glyph.glsl`'s `u_glyphUV` to `u_glyphUv`.

**Verification**, run on the tip of the stack. Each commit type-checks
without warnings and passes `cargo test`; the pixel comparison was not
repeated per PR.

- Against `main`'s engine over the e2e suite (every spec but the `perf`
  ones and the four multi-hour compositions), chromium: 7,068
  checkpoints, 7,030 identical. The other 38 are in seven tests that
  differ between two runs of one engine: four in `brush-jitter-texture`,
  `layer-dnd-autoscroll`, `shape-polygon-path-matches-pixels` (the idle
  crop lands or not before the checkpoint), and `merge-down-chained-undo`
  (a thumbnail that depends on timing: `main`'s engine gives the new
  engine's hash when the spec runs alone, and gave a different one in
  the loaded baseline run).
- e2e: 1,453 passed, 7 skipped, 1 failed (`composition-painting`, which
  fails on `main`'s engine too).
- Real GPU (ANGLE Metal, M4 Max), 4000×4000 with 20 styled layers: CPU
  time per forced composite 5.57 to 5.67 ms against 5.80 to 5.84 ms on
  `main`, 6.97 ms including the GPU drain on both. Brush 17.6 ms and pan
  19.2 ms per input event on both.
- `brush-perf-6k`: 19.6 to 21.8 strokes/s over four runs, against 17.3
  to 21.8 on `main`.
- Not run: Firefox, and any GPU other than Apple's. The Box Blur fix has
  no test.


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

**As built (3.1 to 3.3).**

- *3.1.* Every export in `lopsy-wasm/src/api/` is one call into the
  function of the same name in `lopsy-engine/src/commands/`, which takes
  `&mut EngineInner` and plain Rust values and returns `Result<_,
  String>` where it can fail. The 284 bodies were moved by script and
  are otherwise unchanged. Doc comments went with them, so the generated
  `.d.ts` no longer carries any; the exported signatures are identical.
- *3.2.* `host.rs` holds what the engine asks of its host: a log
  function and a clock, installed by `createEngine`. A canvas passed in
  for upload is `gpu::ExternalImage`, the backend's name for a
  host-owned image. Outside `gpu/` the engine names no browser type.
- *3.3.* Two commits, not one per module family: the GPU layer and host
  hooks first, which depend on nothing else, then everything else at
  once, because every other module reaches `EngineInner` and
  `EngineInner` holds a field from most of them. Files kept their names
  and relative paths. `lopsy-engine` still depends on `web-sys` and
  `wasm-bindgen` for the WebGL backend; it has no `#[wasm_bindgen]`
  item. The wasm grew 0.35% from the split, 0.45% over the two PRs.

- *3.4.* Six structs, one commit each, moved by script: `ClipboardState`,
  `FloatState`, `PreviewState`, `OverlayState`, `GroupState` and
  `BrushState`. `EngineInner` went from about 120 fields to 45. Only
  access paths changed (`engine.float_width` is `engine.float.width`).
  What is left on `EngineInner` is the GPU objects, the layer stack and
  textures, document and viewport state, selection, snapshots, text and
  a few single-purpose fields.
- *3.5.* `imaging/` holds operations that know nothing about documents
  or layers. Each takes an `Imaging` (the GPU and the shader set), a
  source texture and its own parameters, and returns the pass; the
  caller says where it draws.
  - `imaging::adjustments` is the develop pipeline: the adjustments
    pass, its parameter list, the vignette and `ImageAdjustmentState`.
    The compositor and the Brightness / Contrast filter call the same
    function.
  - `imaging::filters` has 25 single-pass filters. Each clamps its own
    parameters. The command keeps what needs the document: the no-op
    guard and, for radial blur, kaleidoscope and lens distortion, the
    layer geometry they are centred with.
  - **Not moved.** Ten filters still run from `commands/filter/`,
    because they stage several passes through the engine's scratch
    targets or upload a second texture: Gaussian blur, box blur, unsharp
    mask, bloom, pixelate, sunburst, pattern fill, colour LUT, mesh warp
    and the colour-mode conversions. Moving them needs an imaging-side
    way to ask for scratch targets, which nothing provides yet. Liquify
    is a tool session, not a filter, and stays with the document.

Verification is in the PRs: a whole-suite comparison against the engine
as it was before the step, for each.

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

**As built so far.** `asyncReadback` in `wasm-bridge.ts` wraps a
synchronous export so it returns a Promise, resolved or rejected before
it is returned. A converted caller awaits; on WebGL the continuation
runs in the same task, so nothing can change in between.

| PR | Functions | Callers converted |
|---|---|---|
| #1699 | `compositeForExport`, `exportPng16`, `quantizeCompositeToPalette`, `readLayerPixels`, `readLayerAsImageData` | Export and its preview, Flatten Image, Copy Merged, Convert Color Mode, Define Brush, Define Pattern, project save, Auto Tone / Contrast / Color, perspective crop |
| #1698 | `readLayerThumbnail`, `readCompositeThumbnail`, `readChannelThumbnail`, `readClipboardPixels` | The thumbnail read queue, Layers / Channels / Navigator panels, group histogram, system clipboard write, paste check |

`flattenImage`, `copyMerged` and `convertColorMode` are now store actions
that return a Promise. Specs that call the bridge through
`window.__wasmBridge` await it.

**Readbacks removed, not awaited.** Where the pixels only left the GPU
to come straight back, the engine got a command that keeps them there
(#1701):

- **Flatten Image** read the whole composite into JS and uploaded it as
  the new layer. `flattenIntoLayer` composites into the layer's texture.
  The flattened layer now keeps the composite's precision; the round
  trip had quantised it to 8 bits. Convert to Indexed flattens the same
  way.
- **Copy Merged** read the composite, cropped and masked it in JS and
  uploaded the clipboard. `clipboardCopyMerged` uses the pass plain Copy
  uses. A soft selection edge is therefore kept as coverage, as Copy
  does; the JS loop kept every pixel the mask touched at full strength.
- **The pointer-down layer read** for paint tools was unreachable: every
  paint tool takes the GPU path. It is deleted.

In a Lab document both commands still decode the composite to sRGB on
the CPU, inside the engine. That read is Rust's to make async in 6.6.

Two more went the same way (#1702):

- **Rasterize Layer Style and Merge Down** read the rendered layer and
  uploaded the same bytes. `bakeLayerEffects` copies the render into the
  layer's texture, at the composite's precision.
- **The filter and Color LUT preview commit** read the previewed layer
  as a compressed blob, restored the original for history, and uploaded
  the blob. `commitFilterPreview` holds the preview in a GPU snapshot
  across the history push. The snapshot is never in a history entry, so
  the commit releases it itself. `readLayerPixelsCompressedU16` is gone;
  the layer backup keeps the LZ4 read.

**Awaited reads and how each stays correct.** A click that takes a few
milliseconds longer is fine; what matters is that a late answer never
lands on newer state.

- The **eyedropper** awaits `sampleColor` and applies a colour only if
  no newer sample was requested since.
- The **magic wand** and the **contiguous bucket fill** apply when the
  pixels arrive (#1702). The fill is dropped if the layer's content
  generation changed in between. The wand's combine mode is the one held
  at the click.
- **Quick select** starts its stroke at pointer-down (#1702). Points
  that arrive before the pixels are queued and applied when they land; a
  stroke released early is finished then; a newer stroke drops the older
  one's pixels. No pointer-move waits on the read.
- **Feather** installs the feathered mask when its read arrives
  (#1702). A selection made in the meantime, feathered or not, wins.
- **Selecting a layer's pixels** (`selectLayerAlpha`) returns a promise
  and installs the selection when the layer has been read (#1703); a
  newer request or any selection made in the meantime wins. The Move
  tool calls it on pointer-down when a transform float is gone. That
  press hands back a held gesture with no start point, so moves do
  nothing until the selection is in place, and the float then follows
  the pointer from where it was pressed. A release first drops the drag.
- **Content bounds** (#1703). `layerContentRect` stays synchronous for
  the multi-layer Move box, which is drawn and hit-tested every frame:
  it returns the last rect known and asks for a redraw when a newer one
  has been read. `readLayerContentRect` is the awaited form that Align,
  Flip and Rotate Layer use; one read per layer is shared between them.

**Where selection reads the GPU.** Dragging a marquee, lasso or
magnetic lasso reads nothing back per move: the selection mask lives in
JS and is uploaded, and magnetic lasso snaps on the CPU against edges it
computed once. The reads are at the ends:

- Magnetic lasso reads the layer once at pointer-down, inside Rust.
  When that read is async (6.6), moves that arrive first should pass the
  raw point through until the edges are ready.
- Quick select reads the layer once at pointer-down and queues moves
  until it answers (above).
- Feather (a marquee, lasso or wand commit, and Select > Feather)
  uploads the mask, blurs it on the GPU and awaits `readSelectionMask`.
- Selecting a layer's pixels (Cmd-click a thumbnail, after paste, after
  a Move or transform commit) reads the layer to build the mask from its
  alpha, and awaits it (above).

**Mask bytes and the layer backup (#1704).** `layer.mask.data` already
lagged the GPU mask; what was synchronous was `materializeMaskData`,
called wherever JS needed current bytes at once. Each caller now either
awaits or leaves the mask on the GPU:

- Save Project and Export PSD await the masks they write.
- Duplicate Layer copies a lagging mask's texture to the copy
  (`snapshotMaskGpu` into the new layer) and queues the copy's bytes.
- Remove Mask records a pixel history entry, which holds the mask as a
  GPU snapshot, in place of a metadata entry that needed the bytes.
- Crop, resize, flip and rotate (`remapLayerMaskThrough`) resample on
  the GPU, give the mask its new size at once, and read the bytes in
  behind it. Until they land, `mask.data` keeps the old bytes at the old
  size, marked stale and as already uploaded. A stand-in buffer of the
  new size would have been a new JS pixel buffer, which the pixel-debt
  check rejects.

A read that was out while its mask was written again is dropped, by the
lazy queue (a cancel or newer request disowns it) and by
`materializeMaskData` (a per-layer write count).

The backup runner's `readBlob` answers with a Promise. A hidden-tab pass
reads every layer back to back with no idle callback between them and
commits when the last read has answered; on WebGL that is within the
task of the request. One loop owns a pass, so a hidden-tab request that
arrives while a sliced read is out takes that loop over. On a backend
whose reads take frames, a tab hidden for good before they answer keeps
its previous backup; that is the contract change the old `now` mode
could not survive, and it is not exercised yet.

**Reads inside engine commands (#1705).** Nine commands read the GPU
themselves, worked on the bytes and wrote a result back, behind
synchronous exports.

- **Two no longer read.** `cropLayerToContent` (the whole-layer Move
  grab, and the idle crop after a layer switch) and `beginLayerTransform`
  (a press on a multi-layer transform handle) took a layer's content
  bounds inside the engine, on a pointer-down. They now take them as
  arguments, from the content-rect cache, and check only that the rect
  still fits the texture. A grab crops and begins at once when the
  bounds are known and holds the press while they are read when they
  are not; a crop seeds the cache with its own result. A transform
  press starts its gesture at once and begins the engine session when
  the bounds are in, because the press itself (history push, float
  bake) marks them stale.
- **Magnetic lasso** (`magneticLassoBegin`) starts its trace at once and
  follows the pointer as a plain lasso until the edge field arrives,
  then snaps. A field that arrives after its trace ended is freed.
- **Six answer with a Promise** and their callers await: mask fill,
  quick-mask fill, leaving Quick Mask mode, PSD export, the Lab, CMYK
  and palette conversions, and Flatten Image and Copy Merged for their
  Lab decode. Leaving Quick Mask ends the mode at once and installs the
  selection when the read answers.

`extractChannelPixels`, an unused full-size read, went with its shader.

**The synchronous layer read is deleted (#1706).** The pixel store's
`expandLayerForEditing`, `getOrCreateLayerPixelData` and
`resolvePixelData` had no app callers left, but 26 e2e specs read layers
through them. Those specs now use two awaited helpers that
`e2e/fixtures.ts` installs on every page (`__readLayerImage`,
layer-local, and `__readLayerInDocument`, document-sized), and
`move-layer.spec.ts`, which imitated a Move grab by calling the store,
drives the Brush and Move tools instead. `readLayerAsImageDataSync` and
`readLayerPixelsSync` are gone.

**Left, all of it Rust's in 6.6:** the six commands above still read
synchronously inside the engine, as does every readback behind an
`asyncReadback` export. When the engine's read becomes async their
exports return a real Promise and nothing above the bridge changes.
`readQuickMaskPixels` has no callers in the app. One thing noticed and
not verified: Flatten Image in a Lab document writes the decoded sRGB
composite into a layer of a Lab document.

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

**As built so far (#1707).** The translation lives in its own crate,
`lopsy-shaderc`, which `lopsy-engine` uses only from its build script, so
naga is not in the wasm bundle. It also has a small binary that writes the
preprocessed WGSL and the GLSL to a directory, for tools.

- **The generated GLSL keeps the hand-written conventions**, so the WebGL
  backend did not change: the fragment input is renamed to `v_uv` and the
  output to `fragColor`, each sampler takes its WGSL texture's name, and
  naga's struct-plus-instance uniform block is rewritten as the one
  unnamed `layout(std140) uniform Params { ... };` block that
  `flatten_params_block` and the typed-shader test already expect. No
  separate binding table was needed for that.
- **Checked against WebGPU.** `npm run wgsl:check` compiles each shader's
  WGSL with headless Chromium's WebGPU (SwiftShader) and is a CI job. A
  probe with a `textureSample` after a varying-dependent return, which
  naga accepts, fails it.
- **Variants** (`BLEND_MODE`) are not wired yet; the `//#if` preprocessing
  is in the crate and tested, and the build script passes no defines.
- **Dependencies.** naga is pinned to 30.0.1. Cargo first resolved
  `naga-types 30.0.2` and `syn 3.0.10`, both under seven days old; they
  are held at 30.0.1 and 3.0.9 in `Cargo.lock`.

Two things the second batch (#1708) found. naga spells a square
matrix `mat3x3`, so the translator writes the short `mat3` in the block
for the Rust check. And a shader that sampled inside a branch on its
coordinate (`blit_region`) has to sample first and choose afterwards, or
use `textureSampleLevel`; the WebGPU check is what catches the first form.

Measured on #1707: the whole e2e suite, instrumented, on `main`'s
engine and on this one, differs only in tests that vary from run to run
(two of them, `text-rotate-reopen-1527` and `mask-gpu-undo-780`, were
confirmed by isolated reruns on both engines); maximum channel delta 0
elsewhere. wasm +1,291 bytes for the four shaders. Load time flat:
`engine-create` 130 ms median, 426 ms on the first run after the build.

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
| Code relies on GL state leaking between draws | Phase 1 | State contract; bit-identical parity check; one module per commit for bisecting |
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

Still open:

- That naga's GLSL ES output works for the shaders the spike did not
  port: `adjustments` and the brush dab family.
- Shader compile time of naga-generated GLSL.
- wgpu's control over surface colour space and extended range on native.
- That `koi-fish` and `shapes` repeat exactly on a real GPU; they were
  checked on SwiftShader only.
- Whether `export-roundtrip` repeats exactly.
- WebGPU availability on Linux browsers.
