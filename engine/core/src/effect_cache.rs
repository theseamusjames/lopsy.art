//! Bookkeeping for the compositor's per-layer cache of live effect output.
//!
//! Drop shadows, glows and strokes are distance fields, blurs and dilations
//! over the whole document; recomputing them for every styled layer on every
//! frame made documents with many styled layers slow to pan or paint on. The
//! compositor keeps each layer's effect images — cropped to the region the
//! effect can paint — and replays them while nothing they depend on has
//! changed. This module holds the parts that need no GPU: where each effect
//! can paint, and the store that decides what stays cached within a VRAM
//! budget.

use std::collections::HashMap;

use crate::geometry::Rect;
use crate::layer::{GlowDesc, ShadowDesc, StrokeDesc, StrokePosition};

/// The largest blur radius the glow and shadow passes use (the Gaussian
/// kernel uniform holds 64 weights).
const MAX_BLUR_RADIUS: u32 = 63;

/// Extra pixels around every extent, so rounding in a shader's bounds test
/// can never put a painted texel outside the cached region.
const MARGIN: i64 = 2;

fn padded(x0: i64, y0: i64, x1: i64, y1: i64, pad: i64) -> Rect {
    let pad = pad + MARGIN;
    let (x0, y0) = (x0 - pad, y0 - pad);
    let (x1, y1) = (x1 + pad, y1 + pad);
    let clamp = |v: i64| v.clamp(i64::from(i32::MIN), i64::from(i32::MAX));
    Rect::new(clamp(x0) as i32, clamp(y0) as i32, (x1 - x0).clamp(0, i64::from(u32::MAX)) as u32, (y1 - y0).clamp(0, i64::from(u32::MAX)) as u32)
}

fn rect_padded(src: Rect, pad: i64) -> Rect {
    let x0 = i64::from(src.x);
    let y0 = i64::from(src.y);
    padded(x0, y0, x0 + i64::from(src.width), y0 + i64::from(src.height), pad)
}

/// The radius the separable blur runs at for an effect of `size` px:
/// `ceil(size)` capped at the kernel limit.
fn blur_radius(size: f32) -> u32 {
    let r = size.ceil();
    if r.is_nan() || r <= 0.0 { 0 } else { (r as u32).min(MAX_BLUR_RADIUS) }
}

/// Where an outer glow cast by the silhouette in `src` can paint. Below a
/// 2 px size the glow is a single unblurred pass inside the silhouette;
/// otherwise the blur spreads it by its radius.
pub fn outer_glow_extent(src: Rect, glow: &GlowDesc) -> Rect {
    let r = blur_radius(glow.size);
    rect_padded(src, if r < 2 { 0 } else { i64::from(r) })
}

/// Where an inner glow can paint: only over the layer's own pixels.
pub fn inner_glow_extent(src: Rect) -> Rect {
    rect_padded(src, 0)
}

/// Where a drop shadow cast by the silhouette in `src` can paint: the
/// silhouette moved by the (possibly fractional) offset and spread by the
/// blur radius.
pub fn drop_shadow_extent(src: Rect, shadow: &ShadowDesc) -> Rect {
    let finite = |v: f32| if v.is_finite() { f64::from(v) } else { 0.0 };
    let x0 = (f64::from(src.x) + finite(shadow.offset_x)).floor() as i64;
    let y0 = (f64::from(src.y) + finite(shadow.offset_y)).floor() as i64;
    let x1 = (f64::from(src.x) + f64::from(src.width) + finite(shadow.offset_x)).ceil() as i64;
    let y1 = (f64::from(src.y) + f64::from(src.height) + finite(shadow.offset_y)).ceil() as i64;
    padded(x0, y0, x1, y1, i64::from(blur_radius(shadow.blur)))
}

/// Where a stroke on the layer in `src` can paint. The distance-field pass
/// looks one pixel past the full width whatever the position, so this
/// covers inside and centre strokes too.
pub fn stroke_extent(src: Rect, stroke: &StrokeDesc) -> Rect {
    let w = stroke.width.ceil();
    let reach = if w.is_nan() || w <= 0.0 { 0 } else { w as i64 };
    rect_padded(src, reach + 1)
}

/// `rect` clipped to the document, or `None` when nothing of it is on the
/// canvas (the compositor's effect passes only cover the document).
pub fn clip_to_document(rect: Rect, doc_width: u32, doc_height: u32) -> Option<Rect> {
    rect.intersect(&Rect::new(0, 0, doc_width, doc_height))
}

/// A layer's enabled effects that trace its silhouette.
#[derive(Debug, Clone, Copy, Default)]
pub struct ShapeEffects<'a> {
    pub outer_glow: Option<&'a GlowDesc>,
    pub inner_glow: Option<&'a GlowDesc>,
    pub drop_shadow: Option<&'a ShadowDesc>,
    pub stroke: Option<&'a StrokeDesc>,
}

/// The document regions of the images a layer's effects produce, in the
/// order the compositor draws them: behind the layer (outer glow and drop
/// shadow, cast by the layer grown by an outside or centre stroke, then an
/// outside stroke) and over it (inner glow, then an inside or centre stroke
/// — a centre stroke wider than 20 px is drawn as two halves). Regions
/// entirely off the canvas are left out. Used to size a cache entry before
/// rendering it.
pub fn planned_images(layer: Rect, fx: ShapeEffects, doc_width: u32, doc_height: u32) -> (Vec<Rect>, Vec<Rect>) {
    let clip = |r: Rect| clip_to_document(r, doc_width, doc_height);
    let mut behind = Vec::new();
    if fx.outer_glow.is_some() || fx.drop_shadow.is_some() {
        let cast = fx.stroke.and_then(StrokeDesc::outside_reach).map_or(layer, |reach| {
            let r = crate::layer::stroke_silhouette_rect(
                crate::layer::DocRect { x: layer.x as f32, y: layer.y as f32, width: layer.width, height: layer.height },
                reach,
            );
            Rect::new(r.x as i32, r.y as i32, r.width, r.height)
        });
        behind.extend(fx.outer_glow.and_then(|g| clip(outer_glow_extent(cast, g))));
        behind.extend(fx.drop_shadow.and_then(|s| clip(drop_shadow_extent(cast, s))));
    }
    let mut above = Vec::new();
    above.extend(fx.inner_glow.and_then(|_| clip(inner_glow_extent(layer))));
    if let Some(stroke) = fx.stroke {
        if let Some(r) = clip(stroke_extent(layer, stroke)) {
            match stroke.position {
                StrokePosition::Outside => behind.push(r),
                StrokePosition::Inside => above.push(r),
                StrokePosition::Center => {
                    above.push(r);
                    if stroke.width * 0.5 > 10.0 {
                        above.push(r);
                    }
                }
            }
        }
    }
    (behind, above)
}

/// One cached effect image: a texture `handle` holding the document region
/// `rect` of what the effect painted.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CachedImage<H> {
    pub handle: H,
    pub rect: Rect,
}

/// A layer's cached effect images, valid while its key is unchanged.
/// `behind` are composited (in order) under the layer, `above` over it.
#[derive(Debug, Clone)]
pub struct CacheEntry<K, H> {
    pub key: K,
    pub behind: Vec<CachedImage<H>>,
    pub above: Vec<CachedImage<H>>,
    bytes: u64,
    used_frame: u64,
}

impl<K, H: Copy> CacheEntry<K, H> {
    fn handles(&self) -> impl Iterator<Item = H> + '_ {
        self.behind.iter().chain(self.above.iter()).map(|img| img.handle)
    }
}

/// Live counters for the cache, for dev tooling and tests.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct CacheStats {
    pub entries: u32,
    pub images: u32,
    pub bytes: u64,
    pub hits: u64,
    pub misses: u64,
}

/// Per-layer effect images within a byte budget. Generic over the key and
/// the texture handle so the policy is testable without a GPU; every handle
/// it drops is handed back to the caller to release.
///
/// Entries are kept while their layer is drawn every frame. An entry a frame
/// did not use is dropped at the end of that frame, so hidden, deleted or
/// effect-less layers never hold VRAM. A new entry that would exceed the
/// budget is refused rather than evicting one in use this frame, so a
/// document with more styled layers than fit keeps a stable cached set
/// instead of thrashing.
pub struct EffectCacheStore<K, H> {
    entries: HashMap<String, CacheEntry<K, H>>,
    budget_bytes: u64,
    bytes: u64,
    frame: u64,
    hits: u64,
    misses: u64,
}

impl<K: PartialEq, H: Copy> EffectCacheStore<K, H> {
    pub fn new(budget_bytes: u64) -> Self {
        Self { entries: HashMap::new(), budget_bytes, bytes: 0, frame: 1, hits: 0, misses: 0 }
    }

    pub fn budget_bytes(&self) -> u64 {
        self.budget_bytes
    }

    pub fn set_budget_bytes(&mut self, budget_bytes: u64) {
        self.budget_bytes = budget_bytes;
    }

    /// The entry for `layer_id` if it was built from `key`; marks it used
    /// this frame. A stale entry is removed and its handles returned in
    /// `released` so the caller can free them.
    pub fn lookup(&mut self, layer_id: &str, key: &K, released: &mut Vec<H>) -> Option<&CacheEntry<K, H>> {
        let is_fresh = self.entries.get(layer_id).map(|e| e.key == *key);
        match is_fresh {
            Some(true) => {
                self.hits += 1;
                let frame = self.frame;
                let entry = self.entries.get_mut(layer_id)?;
                entry.used_frame = frame;
                Some(entry)
            }
            Some(false) => {
                self.misses += 1;
                self.remove(layer_id, released);
                None
            }
            None => {
                self.misses += 1;
                None
            }
        }
    }

    /// Whether `bytes` more would fit in the budget.
    pub fn has_room_for(&self, bytes: u64) -> bool {
        self.bytes.saturating_add(bytes) <= self.budget_bytes
    }

    /// Store a freshly rendered entry. Returns `false` (keeping nothing) when
    /// it doesn't fit the budget; the caller then releases the images.
    pub fn insert(&mut self, layer_id: &str, key: K, behind: Vec<CachedImage<H>>, above: Vec<CachedImage<H>>, bytes: u64, released: &mut Vec<H>) -> bool {
        self.remove(layer_id, released);
        if !self.has_room_for(bytes) {
            return false;
        }
        self.bytes += bytes;
        let entry = CacheEntry { key, behind, above, bytes, used_frame: self.frame };
        self.entries.insert(layer_id.to_string(), entry);
        true
    }

    /// Keep `layer_id`'s entry alive this frame without drawing it (its
    /// output is already folded into another cache).
    pub fn touch(&mut self, layer_id: &str) {
        let frame = self.frame;
        if let Some(entry) = self.entries.get_mut(layer_id) {
            entry.used_frame = frame;
        }
    }

    pub fn remove(&mut self, layer_id: &str, released: &mut Vec<H>) {
        if let Some(entry) = self.entries.remove(layer_id) {
            self.bytes -= entry.bytes;
            released.extend(entry.handles());
        }
    }

    /// Drop every entry the frame just finished did not use, then start a
    /// new frame.
    pub fn end_frame(&mut self, released: &mut Vec<H>) {
        let frame = self.frame;
        let stale: Vec<String> = self.entries.iter()
            .filter(|(_, e)| e.used_frame != frame)
            .map(|(id, _)| id.clone())
            .collect();
        for id in stale {
            self.remove(&id, released);
        }
        self.frame += 1;
    }

    pub fn clear(&mut self, released: &mut Vec<H>) {
        for (_, entry) in self.entries.drain() {
            released.extend(entry.handles());
        }
        self.bytes = 0;
    }

    pub fn stats(&self) -> CacheStats {
        CacheStats {
            entries: self.entries.len() as u32,
            images: self.entries.values().map(|e| (e.behind.len() + e.above.len()) as u32).sum(),
            bytes: self.bytes,
            hits: self.hits,
            misses: self.misses,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn glow(size: f32) -> GlowDesc {
        GlowDesc { enabled: true, color: [1.0; 4], size, spread: 0.0, opacity: 1.0 }
    }

    fn shadow(offset_x: f32, offset_y: f32, blur: f32) -> ShadowDesc {
        ShadowDesc { enabled: true, color: [0.0, 0.0, 0.0, 1.0], offset_x, offset_y, blur, spread: 0.0, opacity: 1.0 }
    }

    fn stroke(position: StrokePosition, width: f32) -> StrokeDesc {
        StrokeDesc { enabled: true, color: [0.0, 0.0, 0.0, 1.0], width, position, opacity: 1.0 }
    }

    const LAYER: Rect = Rect { x: 100, y: 50, width: 200, height: 80 };

    #[test]
    fn outer_glow_reaches_its_blur_radius_past_the_silhouette() {
        assert_eq!(outer_glow_extent(LAYER, &glow(10.0)), Rect::new(88, 38, 224, 104));
        // Fractional sizes blur at the rounded-up radius.
        assert_eq!(outer_glow_extent(LAYER, &glow(9.2)), Rect::new(88, 38, 224, 104));
    }

    #[test]
    fn tiny_outer_glow_stays_inside_the_silhouette() {
        assert_eq!(outer_glow_extent(LAYER, &glow(1.0)), Rect::new(98, 48, 204, 84));
    }

    #[test]
    fn glow_blur_is_capped_at_the_kernel_limit() {
        let r = outer_glow_extent(LAYER, &glow(500.0));
        assert_eq!(r.x, 100 - 63 - 2);
        assert_eq!(r.width, 200 + 2 * (63 + 2));
    }

    #[test]
    fn inner_glow_paints_only_over_the_layer() {
        assert_eq!(inner_glow_extent(LAYER), Rect::new(98, 48, 204, 84));
    }

    #[test]
    fn drop_shadow_moves_with_its_offset_and_spreads_by_its_blur() {
        assert_eq!(drop_shadow_extent(LAYER, &shadow(10.0, -5.0, 4.0)), Rect::new(104, 39, 212, 92));
        // A fractional offset widens the extent to whole pixels on both sides.
        assert_eq!(drop_shadow_extent(LAYER, &shadow(0.5, 0.0, 0.0)), Rect::new(98, 48, 205, 84));
    }

    #[test]
    fn stroke_extent_covers_the_full_width_for_every_position() {
        let expected = Rect::new(100 - 13, 50 - 13, 200 + 26, 80 + 26);
        assert_eq!(stroke_extent(LAYER, &stroke(StrokePosition::Outside, 10.0)), expected);
        assert_eq!(stroke_extent(LAYER, &stroke(StrokePosition::Center, 10.0)), expected);
        assert_eq!(stroke_extent(LAYER, &stroke(StrokePosition::Inside, 10.0)), expected);
    }

    #[test]
    fn extents_are_clipped_to_the_document() {
        let r = outer_glow_extent(Rect::new(-50, -50, 100, 100), &glow(20.0));
        assert_eq!(clip_to_document(r, 400, 300), Some(Rect::new(0, 0, 72, 72)));
        assert_eq!(clip_to_document(Rect::new(500, 0, 10, 10), 400, 300), None);
    }

    #[test]
    fn planned_images_follow_the_compositor_draw_order() {
        let g = glow(10.0);
        let s = shadow(20.0, 20.0, 0.0);
        let st = stroke(StrokePosition::Outside, 12.0);
        let fx = ShapeEffects { outer_glow: Some(&g), drop_shadow: Some(&s), stroke: Some(&st), inner_glow: None };
        let (behind, above) = planned_images(LAYER, fx, 1000, 1000);
        // Glow and shadow are cast by the layer grown by the stroke (13 px pad).
        let cast = Rect::new(87, 37, 226, 106);
        assert_eq!(behind, vec![
            outer_glow_extent(cast, &g),
            drop_shadow_extent(cast, &s),
            stroke_extent(LAYER, &st),
        ]);
        assert!(above.is_empty());
    }

    #[test]
    fn planned_images_put_inner_effects_over_the_layer() {
        let g = glow(5.0);
        let narrow = stroke(StrokePosition::Center, 8.0);
        let fx = ShapeEffects { inner_glow: Some(&g), stroke: Some(&narrow), ..Default::default() };
        let (behind, above) = planned_images(LAYER, fx, 1000, 1000);
        assert!(behind.is_empty());
        assert_eq!(above, vec![inner_glow_extent(LAYER), stroke_extent(LAYER, &narrow)]);

        // A centre stroke too wide for the distance pass is drawn in two halves.
        let wide = stroke(StrokePosition::Center, 30.0);
        let fx = ShapeEffects { stroke: Some(&wide), ..Default::default() };
        let (_, above) = planned_images(LAYER, fx, 1000, 1000);
        assert_eq!(above.len(), 2);
    }

    #[test]
    fn planned_images_skip_effects_entirely_off_the_canvas() {
        let s = shadow(-500.0, 0.0, 0.0);
        let fx = ShapeEffects { drop_shadow: Some(&s), ..Default::default() };
        let (behind, _) = planned_images(LAYER, fx, 1000, 1000);
        assert!(behind.is_empty());
    }

    fn img(handle: u32, w: u32) -> CachedImage<u32> {
        CachedImage { handle, rect: Rect::new(0, 0, w, 1) }
    }

    #[test]
    fn a_matching_key_hits_and_a_changed_key_frees_the_stale_images() {
        let mut store: EffectCacheStore<u32, u32> = EffectCacheStore::new(1000);
        let mut released = Vec::new();
        assert!(store.lookup("a", &1, &mut released).is_none());
        assert!(store.insert("a", 1, vec![img(10, 1)], vec![img(11, 1)], 100, &mut released));
        assert!(store.lookup("a", &1, &mut released).is_some());
        assert!(released.is_empty());

        assert!(store.lookup("a", &2, &mut released).is_none());
        assert_eq!(released, vec![10, 11]);
        assert_eq!(store.stats().bytes, 0);
        assert_eq!(store.stats().hits, 1);
        assert_eq!(store.stats().misses, 2);
    }

    #[test]
    fn entries_over_budget_are_refused_instead_of_evicting_live_ones() {
        let mut store: EffectCacheStore<u32, u32> = EffectCacheStore::new(250);
        let mut released = Vec::new();
        assert!(store.insert("a", 1, vec![img(1, 1)], vec![], 100, &mut released));
        assert!(store.insert("b", 1, vec![img(2, 1)], vec![], 100, &mut released));
        assert!(!store.insert("c", 1, vec![img(3, 1)], vec![], 100, &mut released));
        assert!(released.is_empty(), "a refused insert hands nothing back; the caller frees its own images");
        assert_eq!(store.stats().entries, 2);
        assert_eq!(store.stats().bytes, 200);
    }

    #[test]
    fn end_of_frame_drops_entries_the_frame_did_not_use() {
        let mut store: EffectCacheStore<u32, u32> = EffectCacheStore::new(1000);
        let mut released = Vec::new();
        store.insert("a", 1, vec![img(1, 1)], vec![], 100, &mut released);
        store.insert("b", 1, vec![img(2, 1)], vec![], 100, &mut released);
        store.insert("c", 1, vec![img(3, 1)], vec![], 100, &mut released);
        store.end_frame(&mut released);
        assert!(released.is_empty());

        // Next frame draws "a", folds "b" into another cache, skips "c".
        assert!(store.lookup("a", &1, &mut released).is_some());
        store.touch("b");
        store.end_frame(&mut released);
        assert_eq!(released, vec![3]);
        assert_eq!(store.stats().entries, 2);
        assert_eq!(store.stats().bytes, 200);
    }

    #[test]
    fn remove_and_clear_hand_back_every_handle() {
        let mut store: EffectCacheStore<u32, u32> = EffectCacheStore::new(1000);
        let mut released = Vec::new();
        store.insert("a", 1, vec![img(1, 1), img(2, 1)], vec![img(3, 1)], 100, &mut released);
        store.insert("b", 1, vec![img(4, 1)], vec![], 100, &mut released);
        store.remove("a", &mut released);
        assert_eq!(released, vec![1, 2, 3]);
        released.clear();
        store.clear(&mut released);
        assert_eq!(released, vec![4]);
        assert_eq!(store.stats(), CacheStats { entries: 0, images: 0, bytes: 0, hits: 0, misses: 0 });
    }
}
