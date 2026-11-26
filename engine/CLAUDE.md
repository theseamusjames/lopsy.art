# Lopsy engine — development rules

The Rust rendering engine. The web app that embeds it is in
`apps/lopsy-web/` (rules in `apps/lopsy-web/CLAUDE.md`, including how the
app syncs its state to the engine, undo snapshots and masks). The
repository's map and the rules that apply everywhere are in the root
`CLAUDE.md`. The migration this layout came from is
`docs/engine-migration-plan.md`.

Feature code must not add raw GL calls outside `engine/src/gpu/webgl/`,
the WebGL backend: `apps/lopsy-web/scripts/check-gl-debt.mjs` (part of
`npm run lint`) fails on any GL type or call named anywhere else, and the
context is private to `gpu/`.

## Layout

The rendering engine is a Cargo workspace in `engine/`. The engine crate
itself (`lopsy-engine`, with no host) is at its top; `core/` is CPU-only
(`lopsy-core`); `hosts/wasm/` is the browser host that `wasm-pack` builds
(`lopsy-wasm`); and `shaderc/` (`lopsy-shaderc`) runs only in the engine's
build script:

```
engine/
  core/             # lopsy-core: pure Rust utilities (no web dependencies)
    src/
      blend.rs        # Blend mode math
      brush.rs        # Brush dab geometry
      color.rs        # Color space conversions
      working_space.rs # The develop working space: gamuts, matrices from primaries, the input step
      cct.rs          # Correlated colour temperature and tint of a white point, and back
      raf/            # RAF decode: the baked import, and linear camera RGB for the develop chain
      dng/            # DNG decode: the baked import (mod.rs), linear camera RGB (linear.rs),
                      # and camera colour by the DNG specification's method (camera_color.rs)
      arw/            # Sony ARW decode (lossy, uncompressed, lossless; the SR2 block) onto
                      # the DNG decode's plane, renders and baked finish; colour is approximate
      tone.rs         # The develop tone step (scene to rendered) and its curve's shoulder
      scene_tone.rs   # Tone on scene data: the tone sliders and masks, a monotone map in stops
      look.rs         # Colour in OkLab, colour grading and curves on rendered linear data
      detail.rs       # Noise reduction, sharpening, and local contrast and haze on encoded values
      linear_detail.rs # Large and small details on log luminance, haze on scene data
      output.rs       # The develop output step: roll-off, gamut mapping, transfer, dither
      compress.rs     # RLE compression for undo snapshots
      layer.rs        # Layer descriptor types (GlowDesc, ShadowDesc, etc.)
      pixel_buffer.rs # crop_to_content_bounds, pixel utilities
      sparse.rs       # Sparse pixel storage (from_sparse, to_sparse)
      flood_fill.rs   # Bucket fill algorithm
      selection.rs    # Selection mask operations
  shaderc/          # lopsy-shaderc: build-time only, WGSL -> GLSL ES 3.00 through naga
  hosts/
    wasm/           # lopsy-wasm: browser host, wasm-bindgen exports only
      src/
        lib.rs            # Engine handle, createEngine, a few CPU helpers
        api/              # One export per command; each is a single call
    cli/            # lopsy-cli: the `lopsy` binary, the engine on a native GPU with no browser
  Cargo.toml        # The workspace, and the lopsy-engine crate
  build.rs          # Translates the shaders and embeds the built-in brushes
  tests/            # Render tests and golden renders on a native GPU (`--features native`)
  src/              # lopsy-engine: the engine. No #[wasm_bindgen] anywhere
    commands/         # What a host can ask for: plain Rust in, Result<_, String> out
    host.rs           # Logging, clock and "the GPU is gone", installed by the host
    task.rs           # `Cx`: lends the engine to an async command one poll at a time
    imaging/          # Adjustments and filters as passes over a source texture; no layers
    engine.rs         # EngineInner struct: holds all GPU state
    document/         # What makes an image a document. Works on the layer stack
      compositor.rs     # Per-frame compositing pipeline
      layer_manager.rs  # Texture upload/read/duplicate for layers
      filter_gpu.rs     # Applies an imaging operation to a layer (selection, write-back)
      selection_gpu.rs  # Selection mask GPU operations
      effect_cache_gpu.rs # Cached glow, shadow and stroke images per layer
      overlay_renderer.rs # Grid, rulers, marching ants, brush cursor
      paint/            # Tools that put pixels on a layer
        brush_gpu.rs      # Brush & eraser dab rendering (GPU)
        clone_stamp_gpu.rs # Clone stamp per-dab rendering
        dodge_burn_gpu.rs # Dodge/burn tool
        gradient_gpu.rs   # Linear/radial gradient rendering
        shape_gpu.rs      # Shape rasterization (rect, ellipse, polygon)
      text/             # Font decoding, shaping, glyph atlas, text rendering
    gpu/
      pass.rs         # The pass layer: the only way feature code draws
      shader.rs       # The typed shader list and the compiled programs
      uniforms.rs     # Typed uniform structs (`uniforms!`) and their checks
      params/         # One uniform struct per shader, grouped like shaders/
      shaders/        # WGSL source files (see below)
      webgl/          # The WebGL2 backend: the only code that names WebGL
        context.rs      # WebGL2 context wrapper, extension detection
        texture_pool.rs # Texture allocation, RGBA8/RGBA16F, upload/read
        framebuffer.rs  # FBO pool for render-to-texture
        program.rs      # Shader compilation, linking, uniform upload
        pass.rs         # What a pass does to the WebGL context
      read.rs         # `Read<T>`: a readback the backend completes when it can
      loss.rs         # Engine ids, and why a freed engine never reports a lost device
      wgpu/           # The wgpu backend, compiled in place of webgl/ by
                      # `--features wgpu`: the same modules as webgl/, plus
        read.rs         # texture -> buffer -> mapped bytes, as a `Read`
```


### Key Shaders

Every shader is WGSL. `include/` holds the code shaders share.

```
gpu/shaders/
  blend.wgsl              # Layer compositing (all blend modes, mask sampling)
  final_blit.wgsl         # Composite → screen (viewport transform; no clamp, for an HDR canvas)
  blit.wgsl               # Texture-to-texture copy
  brush/
    brush_dab_*.wgsl      # Brush dab: circle, alpha tip, colour tip
    eraser_dab.wgsl       # Eraser dab with selection mask support
    clone_stamp.wgsl      # Per-dab clone with bounds checking
    dodge_burn.wgsl       # Dodge/burn dab
  effects/
    glow.wgsl             # Inner/outer glow (distance field based)
    shadow.wgsl           # Drop shadow
    separable_edt.wgsl    # Stroke effect band (two-pass Euclidean distance)
    stroke_apply.wgsl     # Stroke effect ring from that band
  filters/
    adjustments.wgsl      # Exposure, contrast, highlights, shadows, whites, blacks
    vignette.wgsl         # Vignette effect
    gaussian_blur.wgsl    # Two-pass Gaussian blur
    box_blur.wgsl         # Box blur
    invert.wgsl, hue_sat.wgsl, sharpen.wgsl, noise.wgsl, posterize.wgsl, threshold.wgsl
  gradient/
    gradient_linear.wgsl, gradient_radial.wgsl
  develop/                # Photonamous' develop chain (src/develop/mod.rs lists them)
    raw_develop.wgsl      # RAW stage: linear camera RGB → sRGB (or scene Rec. 2020)
    working_space.wgsl    # Input step, and into and out of the display encoding
    tone.wgsl             # Tone pass: scene → rendered, linear Rec. 2020 (tone sliders, masks, profile)
    look.wgsl             # Look pass: OkLab colour, colour grading, curves on rendered linear data
    output.wgsl           # Output step: rendered → the screen's or a file's space
    noise_reduce.wgsl, local_contrast.wgsl, detail_sharpen.wgsl, blur_axis.wgsl
    luminance_stats.wgsl  # What the linear local contrast and haze blur: log-luminance moments, the veil
    local_contrast_log.wgsl # Large and small details on rendered linear data (working space on)
    haze.wgsl             # Haze on scene data, before the tone pass (working space on)
    color_mixer.wgsl, areas.wgsl, area_layer.wgsl, finish.wgsl, clip_warning.wgsl
```

### The Photonamous develop chain

`src/develop/mod.rs` is the map: the stage order (RAW develop, noise
reduction, local contrast and haze, image adjustments, colour mixer, areas
and each area's layer, sharpening, finish, then the screen-only views; with
the working space, noise reduction and haze on scene data, the tone pass,
local contrast, the look pass, the areas' layers, sharpening, finish,
output), where each pass lives, the
JS API, and the deviations from `docs/photonamous-spec.md` 6.10. Rules:

- Every stage is off (`None`) by default, and then the composite is
  byte-identical to Lopsy's. Keep it that way.
- The working space (`develop::working_space`, `setDevelopWorkingSpace`)
  is a per-document opt-in that Photonamous turns on and Lopsy never does.
  With it the image is unclamped linear Rec. 2020 from the RAW (or input)
  step to the output step. Tone (the tone sliders and the areas' built-in
  ones, through their masks) runs on scene data in the tone pass, and
  colour, grading and curves on rendered data in the look pass
  (`lopsy_core::scene_tone`, `lopsy_core::look`, set with `setDevelop…`);
  Lopsy's image adjustments, the old colour by hue and the old areas pass
  do not run at all then. Noise reduction (today's algorithm, inside a
  display encoding that keeps values above 1 and below 0) and haze run on
  scene data before the tone pass (`compositor::scene_stages`), and large
  and small details on rendered data after it (`lopsy_core::linear_detail`;
  `setImageDetail` and `setImageLocalContrast` drive them). The stages that
  still assume sRGB-encoded values (sharpening, finish) run inside a
  display encoding (`compositor::MIDDLE_STAGES`; move a stage out by
  changing its `space`). Without it nothing changes: the render tests that
  predate it hold that. Readbacks that are statistics
  (histogram, pixel readout) read the output rendered for sRGB, never the
  screen's space.
- Every stage has a CPU reference in `lopsy-core` (`raf::develop`,
  `detail`, `linear_detail`, `color_mixer`, `areas`, `finish`, `working_space`, `tone`, `scene_tone`, `look`,
  `output`). Change a shader and its
  reference together; the tests compare them.
- **Camera colour.** The RAW step takes a white-balance gain (`wbRatio`)
  and a camera matrix (`camToRgb`, to linear sRGB, carried on to Rec.
  2020). For a RAF the matrix is one daylight matrix per sensor
  generation and Kelvin is a readout fitted to the body's presets
  (`raf::wb_presets`); nothing about it follows the white balance. For a
  DNG the matrix comes from the file's own calibration by the DNG
  specification's method (`dng::camera_color`: two illuminants
  interpolated by inverse colour temperature, forward matrices or Bradford
  to D50) and is recomputed on the CPU for each white balance, and Kelvin
  and tint are real (`cct`); the app sends `wbRatio` and `camToRgb`
  together. The tests on real DNGs read `LOPSY_DNG_SAMPLES`
  (`core/tests/dng_develop.rs`, `--release`), and `dng_baked_hash.rs`
  pins both DNG decodes bit for bit. A Sony ARW follows the RAF model:
  one fixed matrix (Sony's `ColorMatrix` from the file's SR2 block, which
  is only part of the camera's colour, so the decode says its colour is
  approximate) and `wbRatio` as gains. The tests on real ARWs read
  `LOPSY_ARW_SAMPLES` (`core/tests/arw_decode.rs`, `--release`).
- Develop shaders compile lazily through `ShaderPrograms::<name>()`, never
  in `compile_all`.
- Screen-only views (overlays, clipping warning, mask view) run only in the
  live `compositor::composite`, never on an export path, and a test checks
  that exports are byte-identical with them on.
- `tests/render.rs` compares every stage's shader with its reference on
  a real GPU (`--features native`), with a tolerance each test explains.
  The CPU side stores its blurs and results as half floats, both ways a
  GPU may round them, so a mean difference of more than a few 16-bit
  steps is a real disagreement: fix the side that is wrong, do not widen
  the tolerance.
- A decoder checks header sizes before allocating from them
  (`lopsy_core::decode::DecodeLimits`: `PNG_LIMITS`, `RAW_LIMITS`), and
  allocates large buffers with `try_reserve`.

### Golden renders

`tests/golden.rs` develops real RAF files through the whole chain on a
native GPU (decoded as Photonamous decodes its working image, binned to a
512-pixel long edge) with a fixed set of settings, and compares a
fingerprint of each result (with the working space on, rendered for
sRGB, as Photonamous renders it), the mean R, G and B of a 12 × 8 grid of
cells, with the one stored in `tests/golden/<file>.txt`. A cell channel
more than 256 of 65535 off fails, and the message names the file, the
settings and each cell that moved. The RAF files are not in this
repository: point `LOPSY_RAF_SAMPLES` at a clone of
`theseamusjames/sample-raf-images`; without it the test notes that and
passes.

```bash
cd engine
LOPSY_RAF_SAMPLES=/path/to/sample-raf-images cargo test -p lopsy-engine --features native --test golden
# Rendering changed on purpose: make the fingerprints again
LOPSY_RAF_SAMPLES=/path/to/sample-raf-images LOPSY_GOLDEN_UPDATE=1 cargo test -p lopsy-engine --features native --test golden
```

A change that moves how a photo renders must come with its new
fingerprints, in the same commit.

### Adding an engine function JS can call

Write the logic as a function in `engine/src/commands/` that takes
`&mut EngineInner` and plain Rust values, then add a one-line
`#[wasm_bindgen]` export in `engine/hosts/wasm/src/api/` that calls it. An export
never holds logic, and nothing in `lopsy-engine` outside `gpu/` names
`wasm_bindgen`, `web_sys` or `js_sys`: log through `host::log` and read the
time with `host::now_ms`.

A command that reads pixels back cannot return them directly: WebGPU has
no synchronous read. It returns a `gpu::read::Read<T>` (use `map` to work
on the pixels), or, when it needs the engine again after the read, it is
an `async fn` that takes a `task::Cx` and owned arguments and borrows the
engine with `cx.with(|engine| ...)`, re-checking that what it read is
still there before writing. Its export is declared with `readback_export!`
(`engine/hosts/wasm/src/readback.rs`) and wrapped in `asyncReadback` in
`wasm-bridge.ts`: pass `'any-time'` only for a read whose result changes
nothing in the document (a thumbnail, the eyedropper).

On WebGL a read answers at once, blocking on whatever the GPU still has
queued. An export declared with `deferred_readback_export!` instead runs
its command inside `gpu::deferred`: the read goes into a pixel-pack buffer
behind a fence (`gpu/webgl/read.rs`) and the export answers later, as on
WebGPU. Use it only for reads nothing inside the engine waits on (the
thumbnails and the lazy mask read), and type the export in `wasm-bridge.ts`
with `answersLater`.

### Hosts

A host is what embeds the engine: it starts it and calls `commands/`.
`hosts/wasm` is the browser's. `hosts/cli` is a second, and shows what a
host that is not a page needs: `GpuContext::headless()`, a `Host` for
logging and time, and a `block_on` that polls. It is a workspace member
but not a default one, because it turns on the engine's `native` feature
and cargo would then build every other member's engine with it too: build
and test it with `-p lopsy-cli`.

### Shader uniforms

A shader declares every non-sampler uniform in one struct, `Params`, and
`gpu/params/<family>.rs` holds the matching Rust struct, declared with
`uniforms!`: field `layer_offset` feeds member `u_layerOffset`, in the same
order with the same types. A pass
is created with that struct, or `()` for a shader that only samples:

```rust
engine.pass(&engine.shaders.posterize, PosterizeParams { levels: 4.0 })
    .texture("u_tex", src)
    .draw(Target::Texture(dst));
```

Adding or changing a uniform means editing both structs together; `cargo test` fails when they differ. A new shader is listed in
`typed_shaders!` in `gpu/shader.rs`. There is no way to set a uniform by
name.

### Shader source: WGSL

Shaders are written in WGSL; the WebGL backend runs GLSL generated from
them. `lopsy-engine`'s build script runs every `.wgsl` file under
`gpu/shaders/` through `lopsy-shaderc` (naga) and `gpu/shader.rs` embeds
the generated GLSL with `translated!("<path>")`. The conventions, which
the translator checks:

- One fragment entry point, `fs_main(@location(0) uv: vec2<f32>) ->
  @location(0) vec4<f32>`. It may take `@builtin(position)` as well or
  instead.
- Uniforms in one struct named `Params`, at `@group(0) @binding(0)`, with
  members named as the Rust struct expects (`u_layerOffset`). Textures and
  samplers follow. Read `params.u_x` member by member; do not pass the
  struct to a function.
- A texture `u_tex` with its sampler `u_tex_sampler`. A pass binds it as
  `"u_tex"`.
- Shared code goes in `gpu/shaders/include/<name>.wgsl` and is spliced in
  with `//#include <name>`.
- `Params` cannot hold `array<f32, N>` or `bool`: pack floats as
  `array<vec4<f32>, N/4>` (`Vec4Array::from_floats`) and use `i32` for a
  switch. Avoid swizzle assignment and one texture used with two samplers.
- After a return or `discard` that depends on the pixel, sample with
  `textureSampleLevel(..., 0.0)`. No texture has mipmaps, so it reads the
  same texels. A texture read only with `textureLoad` needs no sampler.
- Constants fold at higher precision than f32. Where an expression of two
  literals is not exact (`1.0 / 2.4`, `1.0 - 0.8`), type one operand
  (`1.0 / f32(2.4)`) so it folds as the GPU would compute it.
- WGSL's `%` truncates; for GLSL's `mod` write `x - y * floor(x / y)`.
- A choice made when the shader is compiled, not per pixel, is a
  `//#if NAME == n` branch, built once per value listed in `VARIANT_SETS`
  in `lopsy-shaderc`. `blend.wgsl` is built once per blend mode this way.

`npm run wgsl:check` compiles every shader's WGSL with headless Chromium's
WebGPU, which is stricter than naga; CI runs it. Run it when you add or
change a `.wgsl` file.

### Build

```bash
cd engine && wasm-pack build hosts/wasm --target web --out-dir ../../../apps/lopsy-web/src/engine-wasm/pkg
```

Output goes to `apps/lopsy-web/src/engine-wasm/pkg/` (gitignored generated files). The JS bridge in `apps/lopsy-web/src/engine-wasm/wasm-bridge.ts` re-exports typed functions from the pkg.

### Compositor Pipeline (`compositor.rs`)

Each frame: clear composite FBO → for each visible layer: render behind-effects (outer glow, drop shadow) → blend layer texture onto composite (with mask, blend mode, opacity) → blend active stroke texture → render mask edit overlay → render above-effects (inner glow, stroke) → apply image adjustments (exposure/contrast/vignette) → final blit to screen with viewport transform.

When only the viewport (or channel mask) changed, `render` skips all of that and runs just the final blit (`compositor::present`) from the existing composite texture: those setters set `needs_present`, not `needs_recomposite`. Anything that writes the composite texture outside `composite()` (export, single-layer bake) must set `needs_recomposite`.

Effect images (glows, shadow, stroke) are cached per layer in the live compositor (`effect_cache_gpu.rs`, policy in `engine/core/src/effect_cache.rs`) and replayed until the layer's content generation, position, opacity, mask state or effect settings change. The content generation is bumped by `mark_layer_dirty(id)`, so **every layer- or mask-texture writer must call `mark_layer_dirty` with the id it wrote** — a writer that doesn't leaves stale effects on screen. Export and Rasterize Layer Style never use the cache. The live compositor also scissors each layer blend (`blend_layer_rect_onto_target`) and effect blend (`EffectOut::clip`) to its rectangle — exact because the blend shader passes the destination through outside the source; seamless wrap keeps the full pass.

### FP16 / Wide Gamut

- `texture_pool.rs` detects `EXT_color_buffer_float` and uses `RGBA16F` textures when available.
- `engine-state.ts` sets `drawingBufferColorSpace = 'display-p3'` on capable displays.
- With the develop working space on, the output step renders the live frame for the space `setScreenOutput` last said (sRGB or Display P3, SDR) before the final blit; the final blit's dither is the screen's only dither. While the canvas really is HDR (`screenIsHdr`) and the HDR view is on (`setDevelopHdr`), it renders for the HDR canvas instead: highlights above white up to a peak, sRGB curve extended past 1 (`develop/mod.rs`, "The screen"). `readHdrOutputF32` is the HDR picture for a file.
- `final_blit.wgsl` passes values through without clamping. On the wgpu engine the canvas is HDR (`rgba16float`, extended tone mapping) while the display is (`screen-output.ts`, `setScreenOutput`), and the document's own adjustments then keep what they push above white (`OverWhite::Kept`). Without the working space everything else in the pipeline is 0..1: `docs/hdr-support.md` lists what HDR editing would need.

### Commands

```bash
# From the repository root. ALWAYS use npm run for the wasm builds, never wasm-pack directly
npm run wasm:build
npm run wasm:build:wgpu   # the wgpu backend, into apps/lopsy-web/src/engine-wasm/pkg-wgpu
npm run wasm:test         # cargo test: every default member, on the WebGL configuration
npm run wasm:test:wgpu    # the wgpu backend's Rust tests and the command-line host's, on this machine's GPU
npm run wgsl:check        # every shader's WGSL through headless Chromium's WebGPU

# The command-line host: each PNG through the engine on the native GPU, results in out/
cd engine && cargo run -p lopsy-cli -- --op blur=8 --op invert --out out photo.png
```
