# Renderer Adapter Plan

## Goal

Decouple the rendering engine from WebGL2 so that different GPU backends can be used per platform:
- **Web**: WebGL2 (current) or WebGPU
- **macOS**: Metal
- **Windows**: DirectX 12
- **Linux / cross-platform native**: Vulkan

## Current State

### What's already platform-agnostic
- **`lopsy-core`** — Pure Rust, no web dependencies. Contains blend math, brush geometry, color conversion, compression, flood fill, selection ops, layer descriptors, pixel buffer utilities. This crate needs zero changes.

### What's tightly coupled to WebGL2
- **`lopsy-wasm`** — Every GPU module depends on `web_sys::WebGl2RenderingContext` directly. ~380 direct WebGL2 calls across 12 source files.

| Module | Direct GL calls | Coupling |
|--------|----------------|----------|
| `compositor.rs` | ~100 | Blending, viewport, uniforms, FBO bind |
| `layer_manager.rs` | ~50 | Temp FBOs, texture params, blit |
| `brush_gpu.rs` | ~25 | Blend equation (MAX), FBO creation |
| `shape_gpu.rs` | ~25 | Blend func, FBO for rendering |
| `filter_gpu.rs` | ~20 | Generic filter + temp FBO |
| `gradient_gpu.rs` | ~20 | FBO creation, blit |
| `engine.rs` | ~30 | Temp FBOs, direct framebuffer ops |
| `selection_gpu.rs` | ~15 | FBO + uniform pattern |
| `clone_stamp_gpu.rs` | ~15 | FBO + stamp texture |
| `dodge_burn_gpu.rs` | ~15 | Temp FBO |
| `overlay_renderer.rs` | ~10 | Minimal |
| `lib.rs` | ~5 | Mask upload |

### Existing partial abstraction (in `gpu/`)
- **`TexturePool`** — Opaque `TextureHandle(usize)` handles, pooled allocation, upload/readback methods. Good abstraction, but methods take `&WebGl2RenderingContext` as first arg.
- **`FramebufferPool`** — Opaque `FramebufferHandle(usize)`, create/bind/release. Same GL-param issue.
- **`ShaderPrograms`** — 40+ compiled programs stored in a struct. Compilation is WebGL-specific. Shaders are GLSL `include_str!()`.
- **`GpuContext`** — Thin wrapper: holds `WebGl2RenderingContext` + capability flags (`has_half_float`, `has_float_blend`).

### Key rendering patterns that repeat everywhere
1. **"Render to texture via shader"** (~30 sites): create temp FBO → attach texture → bind program → set uniforms → draw fullscreen triangle → unbind → delete FBO
2. **Blend state toggle**: `gl.enable(BLEND)` / `gl.disable(BLEND)` / `gl.blend_equation(MAX)` / `gl.blend_func(ONE, ONE_MINUS_SRC_ALPHA)`
3. **Uniform setting**: `gl.get_uniform_location()` + `gl.uniform1f/2f/3f/4f/1i()`
4. **Fullscreen draw**: `gl.draw_arrays(TRIANGLES, 0, 3)` with gl_VertexID-based vertex shader (no VBO/VAO)

---

## Recommended Approach: `wgpu` for Native, Keep WebGL2 for Web

### Why not just wgpu everywhere?

`wgpu` supports WebGL2/WebGPU as backends, so in theory it could replace the current WebGL2 code entirely. However:

1. **wgpu's WebGL2 backend has limitations** — no compute shaders, limited texture format support, overhead from the abstraction layer. The current hand-tuned WebGL2 code is already optimized for the web case.
2. **Bundle size** — wgpu compiled to WASM adds significant weight vs. thin `web-sys` bindings.
3. **The current WebGL2 code works well** — rewriting it through wgpu for the web gains nothing.

The pragmatic path: keep the current WebGL2 implementation for the web target, and use `wgpu` for native desktop targets (which gives us Vulkan, Metal, and DX12 for free).

### Why a trait layer instead of using wgpu's API directly?

A thin trait layer between the rendering logic and the GPU backend lets us:
- Keep the existing WebGL2 code largely intact (implement the trait on top of it)
- Use wgpu natively without the rendering modules caring
- Test rendering logic against a mock/null backend
- Potentially add a WebGPU-native backend later without touching rendering code

---

## Architecture

### New crate structure

```
engine-rs/
  crates/
    lopsy-core/         # Unchanged — pure Rust utilities
    lopsy-gpu/          # NEW — GPU backend trait + types
    lopsy-webgl/        # Refactored from lopsy-wasm's gpu/ — WebGL2 backend impl
    lopsy-wgpu/         # NEW — wgpu backend impl (native)
    lopsy-renderer/     # NEW — Rendering logic (compositor, brush, filters, etc.)
    lopsy-wasm/         # Slimmed down — just #[wasm_bindgen] glue + WebGL backend wiring
    lopsy-native/       # NEW — Native app entry point (winit + wgpu backend wiring)
```

### `lopsy-gpu`: The backend trait crate

This is the central abstraction. No dependencies on `web-sys`, `wgpu`, or any specific GPU API.

```rust
// lopsy-gpu/src/lib.rs

/// Opaque handle to a GPU texture.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct TextureId(pub u32);

/// Opaque handle to a render target (framebuffer / render pass).
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct RenderTargetId(pub u32);

/// Opaque handle to a compiled shader pipeline.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct PipelineId(pub u32);

/// Texture format.
pub enum TextureFormat {
    Rgba8Unorm,
    Rgba16Float,
}

/// Blend equation for compositing.
pub enum BlendEquation {
    Add,
    Max,
}

/// GPU capability flags.
pub struct GpuCapabilities {
    pub supports_float_textures: bool,
    pub supports_float_blending: bool,
    pub max_texture_size: u32,
    pub preferred_format: TextureFormat,
}

/// Uniform values that can be set on a pipeline.
pub enum UniformValue {
    Float(f32),
    Vec2([f32; 2]),
    Vec3([f32; 3]),
    Vec4([f32; 4]),
    Int(i32),
    Mat3([f32; 9]),
}

/// A draw command: bind pipeline + textures + uniforms → draw fullscreen.
pub struct DrawCommand {
    pub pipeline: PipelineId,
    pub target: RenderTargetId,
    pub textures: Vec<(u32, TextureId)>,    // (binding slot, texture)
    pub uniforms: Vec<(&'static str, UniformValue)>,
    pub blend: Option<BlendEquation>,
    pub viewport: Option<(u32, u32, u32, u32)>,    // x, y, w, h
}

/// The GPU backend trait.
pub trait GpuBackend {
    /// Query GPU capabilities.
    fn capabilities(&self) -> &GpuCapabilities;

    // --- Textures ---
    fn create_texture(&mut self, width: u32, height: u32, format: TextureFormat) -> TextureId;
    fn destroy_texture(&mut self, id: TextureId);
    fn upload_rgba8(&mut self, id: TextureId, x: u32, y: u32, w: u32, h: u32, data: &[u8]);
    fn upload_rgba_f32(&mut self, id: TextureId, x: u32, y: u32, w: u32, h: u32, data: &[f32]);
    fn read_rgba8(&mut self, target: RenderTargetId, x: u32, y: u32, w: u32, h: u32) -> Vec<u8>;
    fn clear_texture(&mut self, id: TextureId);
    fn texture_size(&self, id: TextureId) -> (u32, u32);

    // --- Render Targets ---
    fn create_render_target(&mut self, texture: TextureId) -> RenderTargetId;
    fn destroy_render_target(&mut self, id: RenderTargetId);
    fn screen_target(&self) -> RenderTargetId;  // the default framebuffer / swapchain

    // --- Pipelines ---
    fn create_pipeline(&mut self, desc: &PipelineDesc) -> PipelineId;
    fn destroy_pipeline(&mut self, id: PipelineId);

    // --- Drawing ---
    fn draw(&mut self, cmd: &DrawCommand);

    // --- Frame lifecycle ---
    fn begin_frame(&mut self);
    fn end_frame(&mut self);
}

/// Describes a shader pipeline to compile.
pub struct PipelineDesc {
    pub label: &'static str,
    pub vertex_source: ShaderSource,
    pub fragment_source: ShaderSource,
}

/// Shader source, per-backend.
pub enum ShaderSource {
    Glsl(&'static str),
    Wgsl(&'static str),
    Hlsl(&'static str),
    Msl(&'static str),
    /// Let the backend pick from available sources.
    Multi {
        glsl: Option<&'static str>,
        wgsl: Option<&'static str>,
    },
}
```

### Key design decisions in the trait

1. **Fullscreen-only draw calls** — The current engine never uses vertex buffers. Every draw is a fullscreen triangle with shader math. The trait reflects this: `draw()` takes a pipeline + uniforms + textures and draws a fullscreen pass. No vertex buffer API needed.

2. **Opaque handles everywhere** — `TextureId`, `RenderTargetId`, `PipelineId` are just `u32` indices. Backend maps them to real GPU objects internally.

3. **No raw GL/Vulkan/Metal types leak** — The renderer crate never sees backend-specific types.

4. **Multi-format shaders** — `ShaderSource::Multi` lets us ship GLSL for WebGL2, WGSL for wgpu/WebGPU. At build time or runtime, the backend picks the format it understands.

5. **Stateless draw commands** — Instead of `gl.enable(BLEND)` / `gl.bindTexture()` / etc. scattered through the code, each `DrawCommand` is self-contained: target, pipeline, textures, uniforms, blend mode. The backend translates this to its own state machine.

---

## Implementation Phases

### Phase 1: Extract the `lopsy-gpu` trait crate

**Effort**: Small. No existing code changes.

1. Create `engine-rs/crates/lopsy-gpu/` with the trait, handle types, and `DrawCommand`.
2. Add to the workspace.
3. Write a null/mock backend for testing.

### Phase 2: Extract rendering logic into `lopsy-renderer`

**Effort**: Large. This is the bulk of the work.

The compositor, brush, filters, shapes, gradients, selection, layer manager, and overlay renderer all move from `lopsy-wasm` to a new `lopsy-renderer` crate that depends on `lopsy-gpu` (the trait) and `lopsy-core`, but NOT on `web-sys` or `wgpu`.

The `EngineInner` struct splits into two parts:
- **`Renderer`** (in `lopsy-renderer`) — All the rendering state: textures, FBOs, shaders, layer stack, brush state, compositor logic. Generic over `B: GpuBackend`.
- **`WasmEngine`** (remains in `lopsy-wasm`) — The `#[wasm_bindgen]` glue. Owns a `Renderer<WebGlBackend>` and delegates to it.

```rust
// lopsy-renderer/src/lib.rs
pub struct Renderer<B: GpuBackend> {
    gpu: B,
    pipelines: Pipelines,          // all compiled shader pipelines
    layer_textures: HashMap<String, TextureId>,
    layer_masks: HashMap<String, TextureId>,
    composite_target: RenderTargetId,
    scratch_a: RenderTargetId,
    scratch_b: RenderTargetId,
    // ... rest of current EngineInner fields (minus gl, gpu_ctx, shaders, texture_pool, fbo_pool)
}
```

**Refactoring strategy for each module:**

For each `*_gpu.rs` file, the work is:
1. Replace `&WebGl2RenderingContext` params with `&mut B` (the generic backend).
2. Replace inline FBO creation → `gpu.create_render_target()` + `gpu.destroy_render_target()`.
3. Replace `gl.use_program()` + `gl.uniform*()` + `gl.draw_arrays()` → `gpu.draw(DrawCommand { ... })`.
4. Replace `texture_pool.acquire/release()` → `gpu.create_texture()` / `gpu.destroy_texture()`.
5. Replace direct blend state changes → `DrawCommand.blend` field.

**Suggested order** (each step leaves the engine compilable and functional):

| Step | Module | Lines of code | Complexity |
|------|--------|--------------|------------|
| 2a | `gpu/texture_pool.rs` → trait methods | ~300 | Medium |
| 2b | `gpu/framebuffer.rs` → trait methods | ~80 | Low |
| 2c | `gpu/shader.rs` → `Pipelines` struct using `PipelineId` | ~200 | Medium |
| 2d | `engine.rs` → split into `Renderer<B>` | ~90 | Medium |
| 2e | `compositor.rs` → use `DrawCommand` | ~400 | High — most complex module |
| 2f | `brush_gpu.rs` → use `DrawCommand` | ~200 | Medium |
| 2g | `layer_manager.rs` → use `DrawCommand` | ~350 | High |
| 2h | `filter_gpu.rs` → use `DrawCommand` | ~150 | Medium |
| 2i | `shape_gpu.rs`, `gradient_gpu.rs` | ~200 | Medium |
| 2j | `selection_gpu.rs`, `clone_stamp_gpu.rs`, `dodge_burn_gpu.rs` | ~200 | Medium |
| 2k | `overlay_renderer.rs` | ~100 | Low |
| 2l | `lib.rs` → `WasmEngine` wrapping `Renderer<WebGlBackend>` | ~300 | Medium |

### Phase 3: Implement `WebGlBackend`

**Effort**: Medium. Mostly wrapping existing `gpu/` code.

Create `lopsy-webgl` crate (or keep it inside `lopsy-wasm`). Implements `GpuBackend` using the existing WebGL2 code:

```rust
// lopsy-webgl/src/lib.rs
pub struct WebGlBackend {
    gl: WebGl2RenderingContext,
    capabilities: GpuCapabilities,
    textures: SlotMap<TextureId, WebGlTextureEntry>,
    render_targets: SlotMap<RenderTargetId, WebGlFramebuffer>,
    pipelines: SlotMap<PipelineId, WebGlPipelineEntry>,
}

impl GpuBackend for WebGlBackend {
    fn draw(&mut self, cmd: &DrawCommand) {
        // 1. gl.use_program(pipeline.program)
        // 2. For each texture: gl.active_texture(TEXTURE0+slot), gl.bind_texture(tex)
        // 3. For each uniform: gl.uniform*(location, value)
        // 4. If blend: gl.enable(BLEND), gl.blend_equation(...)
        // 5. gl.draw_arrays(TRIANGLES, 0, 3)
        // 6. gl.disable(BLEND)
    }
    // ...
}
```

This is where the existing ~380 GL calls consolidate — into the trait implementation methods rather than scattered across rendering modules.

### Phase 4: Implement `WgpuBackend` for native

**Effort**: Medium-Large.

Create `lopsy-wgpu` crate. Implements `GpuBackend` using the `wgpu` crate:

```rust
// lopsy-wgpu/src/lib.rs
pub struct WgpuBackend {
    device: wgpu::Device,
    queue: wgpu::Queue,
    capabilities: GpuCapabilities,
    textures: SlotMap<TextureId, wgpu::Texture>,
    render_targets: SlotMap<RenderTargetId, wgpu::TextureView>,
    pipelines: SlotMap<PipelineId, wgpu::RenderPipeline>,
}
```

**Shader cross-compilation**: The GLSL shaders need WGSL equivalents for wgpu. Options:

| Approach | Pros | Cons |
|----------|------|------|
| **`naga`** (runtime GLSL→WGSL) | Ship only GLSL, convert at init | Runtime cost, may not handle all GLSL features |
| **Dual-author WGSL** | Full control, optimal code | 40+ shaders to maintain in two languages |
| **`naga` at build time** | Ship pre-converted WGSL, no runtime cost | Needs build script, still verify output |
| **`naga-oil`** | Shader composition/preprocessing | Additional dependency |

**Recommendation**: Use `naga` at build time via a `build.rs` script. Convert each GLSL fragment shader to WGSL and embed via `include_str!()`. Review generated WGSL and hand-tune where needed. Use `ShaderSource::Multi` so each backend picks its format.

### Phase 5: Native app shell (`lopsy-native`)

**Effort**: Medium.

Create a native entry point using `winit` (window management) + `lopsy-wgpu`:

```rust
// lopsy-native/src/main.rs
fn main() {
    let event_loop = winit::event_loop::EventLoop::new();
    let window = winit::window::WindowBuilder::new()
        .with_title("Lopsy")
        .build(&event_loop)?;

    let gpu = WgpuBackend::new(&window)?;
    let renderer = Renderer::new(gpu);
    // ... event loop, integrate with a native UI framework
}
```

This phase is about proving the backend works. Full native UI (menus, panels, toolbox) is a separate project.

---

## Shader Strategy Detail

The current engine has 40+ GLSL fragment shaders. They all share one vertex shader (`FULLSCREEN_QUAD_VERT`). The shaders use:

- `#version 300 es` (WebGL2 / GLSL ES 3.0)
- `precision highp float`
- `uniform sampler2D` for textures
- Standard math functions (`mix`, `clamp`, `smoothstep`, etc.)
- No compute shaders
- No storage buffers
- No advanced features (no geometry/tessellation shaders)

This is good news: the shader subset used is simple enough for `naga` to translate automatically.

**Migration path:**
1. Keep all GLSL sources in `lopsy-renderer/shaders/` (moved from `lopsy-wasm/src/gpu/shaders/`)
2. Add a `build.rs` to `lopsy-renderer` that runs `naga` to generate `.wgsl` from each `.glsl`
3. In `Renderer::new()`, pass `ShaderSource::Multi { glsl, wgsl }` to `gpu.create_pipeline()`
4. Each backend picks its preferred format

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Trait is too narrow for future features (compute, vertex buffers) | Medium | Design trait to be extensible via optional sub-traits |
| naga can't translate some GLSL shaders | Low | The GLSL subset used is basic; test each shader early |
| Performance regression from abstraction | Low | `DrawCommand` can be inlined; hot path is GPU-bound not CPU-bound |
| Massive refactor breaks things | High | Phase 2 is done module-by-module; each step is independently testable |
| wgpu's WebGL2 backend tempts "just use wgpu everywhere" | Medium | Keep the dedicated WebGL2 backend; it's already optimized |

---

## Immediate Next Steps

If we decide to proceed:

1. **Create `lopsy-gpu` crate** with the trait definition, handle types, `DrawCommand`, and a null backend.
2. **Prototype on one module** — pick `filter_gpu.rs` (simplest rendering module, ~150 lines, uses the standard FBO→shader→draw pattern). Refactor it to use the trait. Verify the WebGL backend still works.
3. **Iterate on the trait API** based on what filter_gpu needs, then tackle compositor (the hardest module).

This validates the trait design before committing to the full refactor.

---

## What We're NOT Doing

- Not replacing the WASM/web target — it stays WebGL2 via the current code, wrapped in the trait.
- Not building a full native app — Phase 5 is a proof of concept, not a shipping desktop app.
- Not adding compute shader support — the current engine doesn't use them, so the trait doesn't need them yet.
- Not abstracting the JS bridge (`wasm-bridge.ts`, `engine-sync.ts`) — those stay web-only. A native app would have its own state sync mechanism.
