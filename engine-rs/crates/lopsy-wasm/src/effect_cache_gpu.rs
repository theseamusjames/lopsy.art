//! GPU side of the live compositor's per-layer effect cache (the policy
//! lives in `lopsy_core::effect_cache`).
//!
//! Every effect pass renders a document-sized image into `scratch_a` and
//! blends it onto the composite. While filling the cache, the compositor
//! also copies the part of that image the effect can reach into a texture
//! of its own; on later frames it blends those copies instead of re-running
//! the blurs, distance fields and dilations. A copy is the same texels the
//! pass produced, blended with the same shader, so the cached frame matches
//! a recomputed one exactly — and the blend only touches the copy's region.
//!
//! Only the live compositor caches. Export, Merge Down and Rasterize Layer
//! Style render effects afresh through the same passes.

use web_sys::{WebGl2RenderingContext, WebGlTexture};
use lopsy_core::effect_cache::{CacheStats, CachedImage, EffectCacheStore};
use lopsy_core::geometry::Rect;
use lopsy_core::layer::{GlowDesc, ShadowDesc, StrokeDesc};
use crate::engine::EngineInner;
use crate::gpu::framebuffer::FramebufferHandle;
use crate::gpu::texture_pool::TextureHandle;

/// Bounds of the cache's VRAM budget. Within them it scales with the
/// document: two document-sized textures' worth.
const MIN_BUDGET_BYTES: u64 = 64 * 1024 * 1024;
const MAX_BUDGET_BYTES: u64 = 512 * 1024 * 1024;

pub type EffectCache = EffectCacheStore<EffectCacheKey, TextureHandle>;
pub type CachedEffect = CachedImage<TextureHandle>;

/// A doc-sized texture and the FBO backing it that layer and effect passes
/// composite into: the main composite, or the group scratch while the
/// children of a group with adjustments are being rendered. Effects must
/// follow their layer into the scratch so the group's adjustments apply
/// over them instead of the scratch covering them (#796).
#[derive(Clone, Copy)]
pub(crate) struct Target {
    pub tex: TextureHandle,
    pub fbo: FramebufferHandle,
}

/// Everything a layer's effect images are computed from. A cached entry is
/// replayed only while this is unchanged.
#[derive(Debug, Clone, PartialEq)]
pub struct EffectCacheKey {
    /// Bumped by `mark_layer_dirty` whenever the layer's pixels or mask
    /// change (every texture and mask writer marks the id it wrote).
    pub content_gen: u64,
    pub texture: TextureHandle,
    pub texture_size: (u32, u32),
    pub origin: (i32, i32),
    /// The mask the effects trace through (#977): handle, size and document
    /// origin, or `None` when no mask applies (none, disabled, or the mask is
    /// being edited and the layer shows unmasked).
    pub mask: Option<(TextureHandle, u32, u32, f32, f32)>,
    /// Shadow and outside-stroke knockouts depend on it.
    pub opacity: f32,
    pub doc_size: (u32, u32),
    pub outer_glow: Option<GlowDesc>,
    pub inner_glow: Option<GlowDesc>,
    pub drop_shadow: Option<ShadowDesc>,
    pub stroke: Option<StrokeDesc>,
}

pub fn new_cache() -> EffectCache {
    EffectCacheStore::new(MIN_BUDGET_BYTES)
}

/// The cache budget for a document: two document-sized textures' worth,
/// within [64 MB, 512 MB].
pub fn budget_for_document(doc_width: u32, doc_height: u32, bytes_per_texel: u64) -> u64 {
    (2 * u64::from(doc_width) * u64::from(doc_height) * bytes_per_texel).clamp(MIN_BUDGET_BYTES, MAX_BUDGET_BYTES)
}

pub fn bytes_per_texel(engine: &EngineInner) -> u64 {
    if engine.texture_pool.use_float() { 8 } else { 4 }
}

pub fn image_bytes(rects: &[Rect], bytes_per_texel: u64) -> u64 {
    rects.iter().map(|r| u64::from(r.width) * u64::from(r.height) * bytes_per_texel).sum()
}

/// Which list a captured image belongs to.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Behind,
    Above,
}

/// The images captured while rendering one layer's effects on a cache miss.
pub struct EffectCapture {
    pub behind: Vec<CachedEffect>,
    pub above: Vec<CachedEffect>,
    pub phase: Phase,
    /// Textures of the layer's stale entry, reused for same-sized images so
    /// a layer that changes every frame (dragged, effect slider moving)
    /// doesn't allocate textures every frame.
    recycle: Vec<TextureHandle>,
    pub failed: bool,
}

impl EffectCapture {
    pub fn new(recycle: Vec<TextureHandle>) -> Self {
        Self { behind: Vec::new(), above: Vec::new(), phase: Phase::Behind, recycle, failed: false }
    }

    pub fn rects(&self) -> Vec<Rect> {
        self.behind.iter().chain(self.above.iter()).map(|img| img.rect).collect()
    }

    /// Hand back every texture the capture holds (its images and unused
    /// recycled ones), leaving it empty.
    pub fn take_textures(&mut self) -> Vec<TextureHandle> {
        let mut out: Vec<TextureHandle> = self.recycle.drain(..).collect();
        out.extend(self.behind.drain(..).map(|img| img.handle));
        out.extend(self.above.drain(..).map(|img| img.handle));
        out
    }

    fn texture_for(&mut self, engine: &mut EngineInner, w: u32, h: u32) -> Option<TextureHandle> {
        let reuse = self.recycle.iter().position(|&t| engine.texture_pool.get_size(t) == Some((w, h)));
        if let Some(i) = reuse {
            return Some(self.recycle.swap_remove(i));
        }
        let handle = engine.texture_pool.acquire(&engine.gl, w, h).ok()?;
        // Sampled 1:1 at texel centres, like the scratch it was copied from.
        engine.texture_pool.set_nearest_filter(&engine.gl, handle);
        Some(handle)
    }

    /// Copy `rect` of the effect image in `scratch_a` into a texture of its
    /// own and record it in the current phase.
    pub fn record_scratch(&mut self, engine: &mut EngineInner, rect: Rect) {
        if self.failed {
            return;
        }
        let Some(handle) = self.texture_for(engine, rect.width, rect.height) else {
            self.failed = true;
            return;
        };
        let Some(dst) = engine.texture_pool.get(handle).cloned() else {
            self.failed = true;
            self.recycle.push(handle);
            return;
        };
        engine.fbo_pool.attach_texture(&engine.gl, engine.render_fbo, &dst);
        engine.fbo_pool.blit_region(
            &engine.gl,
            engine.scratch_fbo_a,
            engine.render_fbo,
            (rect.x, rect.y, rect.width as i32, rect.height as i32),
            (0, 0),
        );
        engine.fbo_pool.unbind(&engine.gl);
        let image = CachedImage { handle, rect };
        match self.phase {
            Phase::Behind => self.behind.push(image),
            Phase::Above => self.above.push(image),
        }
    }
}

/// Where an effect pass's image goes: blended onto `target`, and — while
/// the compositor fills the cache — copied into `capture` as well.
pub(crate) struct EffectOut<'a> {
    pub target: Target,
    pub capture: Option<&'a mut EffectCapture>,
}

impl EffectOut<'_> {
    pub fn direct(target: Target) -> EffectOut<'static> {
        EffectOut { target, capture: None }
    }
}

/// Blend the effect image now in `scratch_a` onto the output's target,
/// capturing the part of it inside `extent` (the region the effect can
/// paint, computed only when capturing) first.
pub(crate) fn emit_effect(engine: &mut EngineInner, out: &mut EffectOut, extent: impl FnOnce() -> Rect) {
    if let Some(capture) = out.capture.as_deref_mut() {
        let clipped = lopsy_core::effect_cache::clip_to_document(extent(), engine.doc_width, engine.doc_height);
        if let Some(rect) = clipped {
            capture.record_scratch(engine, rect);
        }
    }
    let Some(scratch) = engine.texture_pool.get(engine.scratch_texture_a).cloned() else { return };
    blend_effect_image(engine, &scratch, None, out.target);
}

/// Blend a cached effect image onto `target`.
pub(crate) fn blend_cached_effect(engine: &mut EngineInner, image: &CachedEffect, target: Target) {
    let Some(tex) = engine.texture_pool.get(image.handle).cloned() else { return };
    blend_effect_image(engine, &tex, Some(image.rect), target);
}

/// Normal-blend an effect image onto `target` via `scratch_b`. `region`
/// `None` is a document-sized image; `Some(rect)` is an image covering just
/// `rect`, and both passes are scissored to it. Outside its source rect the
/// blend shader returns the destination texel unchanged, so leaving those
/// texels untouched produces the same target as a full-document pass.
pub(crate) fn blend_effect_image(engine: &mut EngineInner, src: &WebGlTexture, region: Option<Rect>, target: Target) {
    let comp_tex = match engine.texture_pool.get(target.tex) {
        Some(t) => t.clone(),
        None => return,
    };
    let doc_w = engine.doc_width as f32;
    let doc_h = engine.doc_height as f32;
    let (src_x, src_y, src_w, src_h) = match region {
        Some(r) => (r.x as f32, r.y as f32, r.width as f32, r.height as f32),
        None => (0.0, 0.0, doc_w, doc_h),
    };

    let gl = &engine.gl;
    if let Some(r) = region {
        gl.enable(WebGl2RenderingContext::SCISSOR_TEST);
        gl.scissor(r.x, r.y, r.width as i32, r.height as i32);
    }

    // Normal-mode blend shader: src = effect, dst = target → scratch_b.
    let shader = &engine.shaders.blend_normal;
    gl.use_program(Some(&shader.program));
    gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(src));
    gl.active_texture(WebGl2RenderingContext::TEXTURE1);
    gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&comp_tex));
    if let Some(loc) = shader.location(gl, "u_srcTex") { gl.uniform1i(Some(&loc), 0); }
    if let Some(loc) = shader.location(gl, "u_dstTex") { gl.uniform1i(Some(&loc), 1); }
    if let Some(loc) = shader.location(gl, "u_opacity") { gl.uniform1f(Some(&loc), 1.0); }
    if let Some(loc) = shader.location(gl, "u_srcOffset") { gl.uniform2f(Some(&loc), src_x, src_y); }
    if let Some(loc) = shader.location(gl, "u_srcSize") { gl.uniform2f(Some(&loc), src_w, src_h); }
    if let Some(loc) = shader.location(gl, "u_docSize") { gl.uniform2f(Some(&loc), doc_w, doc_h); }
    if let Some(loc) = shader.location(gl, "u_srcPremultiplied") { gl.uniform1i(Some(&loc), 0); }
    if let Some(loc) = shader.location(gl, "u_overlayEnabled") { gl.uniform1i(Some(&loc), 0); }
    if let Some(loc) = shader.location(gl, "u_hasMask") { gl.uniform1i(Some(&loc), 0); }
    if let Some(loc) = shader.location(gl, "u_maskOverlay") { gl.uniform1i(Some(&loc), 0); }
    if let Some(loc) = shader.location(gl, "u_wrapLayer") { gl.uniform1i(Some(&loc), 0); }

    engine.fbo_pool.bind(gl, engine.scratch_fbo_b);
    gl.viewport(0, 0, doc_w as i32, doc_h as i32);
    engine.draw_fullscreen_quad();

    // Break feedback loop: unbind the target texture from TEXTURE1 before
    // rendering to the FBO it backs.
    gl.active_texture(WebGl2RenderingContext::TEXTURE1);
    gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, None);

    // Copy scratch_b → target
    engine.fbo_pool.bind(gl, target.fbo);
    gl.viewport(0, 0, doc_w as i32, doc_h as i32);
    gl.use_program(Some(&engine.shaders.blit.program));
    gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    if let Some(tex) = engine.texture_pool.get(engine.scratch_texture_b) {
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(tex));
    }
    if let Some(loc) = engine.shaders.blit.location(gl, "u_tex") { gl.uniform1i(Some(&loc), 0); }
    engine.draw_fullscreen_quad();

    if region.is_some() {
        gl.disable(WebGl2RenderingContext::SCISSOR_TEST);
    }
}

/// Store what a cache miss captured as `layer_id`'s entry, or free it when
/// the capture failed or no longer fits the budget.
pub fn store_capture(engine: &mut EngineInner, layer_id: &str, key: EffectCacheKey, mut capture: EffectCapture) {
    let leftover: Vec<TextureHandle> = capture.recycle.drain(..).collect();
    delete_textures(engine, leftover);
    if capture.failed {
        let images = capture.take_textures();
        delete_textures(engine, images);
        return;
    }
    let bytes = image_bytes(&capture.rects(), bytes_per_texel(engine));
    let behind = std::mem::take(&mut capture.behind);
    let above = std::mem::take(&mut capture.above);
    let handles: Vec<TextureHandle> = behind.iter().chain(above.iter()).map(|img| img.handle).collect();
    let mut released = Vec::new();
    if !engine.effect_cache.insert(layer_id, key, behind, above, bytes, &mut released) {
        released.extend(handles);
    }
    delete_textures(engine, released);
}

/// Delete cache textures outright. They are never handed back to the pool:
/// their sizes are one-offs, and the pool keeps two free textures of every
/// size it has seen, so released cache images would pile up there (#1019).
pub fn delete_textures(engine: &mut EngineInner, handles: Vec<TextureHandle>) {
    for handle in handles {
        engine.texture_pool.delete(&engine.gl, handle);
    }
}

/// Drop `layer_id`'s cached effect images, if any.
pub fn evict_layer(engine: &mut EngineInner, layer_id: &str) {
    let mut released = Vec::new();
    engine.effect_cache.remove(layer_id, &mut released);
    delete_textures(engine, released);
}

/// Drop every cached effect image.
pub fn clear(engine: &mut EngineInner) {
    let mut released = Vec::new();
    engine.effect_cache.clear(&mut released);
    delete_textures(engine, released);
}

pub fn stats(engine: &EngineInner) -> CacheStats {
    engine.effect_cache.stats()
}
