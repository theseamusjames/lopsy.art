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

use lopsy_core::effect_cache::{CacheStats, CachedImage, EffectCacheStore};
use lopsy_core::geometry::Rect;
use lopsy_core::layer::{GlowDesc, ShadowDesc, StrokeDesc};
use crate::compositor::{blend_through_scratch, BlendSource, Scratch};
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
pub(crate) struct DocTarget {
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
        let handle = engine.texture_pool.acquire(w, h).ok()?;
        // Sampled 1:1 at texel centres, like the scratch it was copied from.
        engine.texture_pool.set_nearest_filter(handle);
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
        if !engine.gpu().copy_region(engine.scratch_fbo_a, rect, handle) {
            self.failed = true;
            self.recycle.push(handle);
            return;
        }
        let image = CachedImage { handle, rect };
        match self.phase {
            Phase::Behind => self.behind.push(image),
            Phase::Above => self.above.push(image),
        }
    }
}

/// Where an effect pass's image goes: blended onto `target`, and — while
/// the compositor fills the cache — copied into `capture` as well. With
/// `clip`, the blend only touches the region the effect can paint.
pub(crate) struct EffectOut<'a> {
    pub target: DocTarget,
    pub capture: Option<&'a mut EffectCapture>,
    pub clip: bool,
}

impl EffectOut<'_> {
    /// Unclipped, uncached: how export and the single-layer bake draw
    /// effects, so they stay an independent reference for the live view.
    pub fn direct(target: DocTarget) -> EffectOut<'static> {
        EffectOut { target, capture: None, clip: false }
    }
}

/// Blend the effect image now in `scratch_a` onto the output's target,
/// capturing the part of it inside `extent` (the region the effect can
/// paint, computed only when capturing) first.
pub(crate) fn emit_effect(engine: &mut EngineInner, out: &mut EffectOut, extent: impl FnOnce() -> Rect) {
    let needs_extent = out.capture.is_some() || out.clip;
    let clipped = if needs_extent {
        lopsy_core::effect_cache::clip_to_document(extent(), engine.doc_width, engine.doc_height)
    } else {
        None
    };
    if let (Some(capture), Some(rect)) = (out.capture.as_deref_mut(), clipped) {
        capture.record_scratch(engine, rect);
    }
    if out.clip && clipped.is_none() {
        // Nothing of the effect is on the canvas.
        return;
    }
    blend_effect_image(engine, engine.scratch_texture_a, None, if out.clip { clipped } else { None }, out.target);
}

/// Blend a cached effect image onto `target`.
pub(crate) fn blend_cached_effect(engine: &mut EngineInner, image: &CachedEffect, target: DocTarget) {
    blend_effect_image(engine, image.handle, Some(image.rect), Some(image.rect), target);
}

/// Normal-blend an effect image onto `target` via `scratch_b`. `src_rect`
/// `None` is a document-sized image; `Some(rect)` is an image covering just
/// `rect`. With `scissor`, both passes only touch that region: where the
/// effect image is transparent the blend shader returns the destination
/// texel unchanged, so leaving those texels alone produces the same target
/// as a full-document pass.
fn blend_effect_image(engine: &EngineInner, src: TextureHandle, src_rect: Option<Rect>, scissor: Option<Rect>, target: DocTarget) {
    let (offset, size) = match src_rect {
        Some(r) => ((r.x as f32, r.y as f32), (r.width as f32, r.height as f32)),
        None => ((0.0, 0.0), (engine.doc_width as f32, engine.doc_height as f32)),
    };
    let source = BlendSource::new(src, offset, size);
    blend_through_scratch(engine, &engine.shaders.blend_normal, &source, target, Scratch::B, scissor);
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
        engine.texture_pool.delete(handle);
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
