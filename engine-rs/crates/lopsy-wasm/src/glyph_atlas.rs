//! Glyph atlas: pack rasterized glyph bitmaps into a single GPU texture.
//!
//! Phase 1: cache tracking and etagere allocation only. GPU texture upload
//! is implemented in Phase 3 when render_text_layer is fully wired.

use std::collections::HashMap;
use lopsy_core::text_types::{GlyphEntry, GlyphKey};

/// Convert a cosmic-text fontdb ID to a stable u64 hash key.
pub fn font_id_to_u64(id: cosmic_text::fontdb::ID) -> u64 {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    id.hash(&mut h);
    h.finish()
}

/// Glyph atlas backed by a single R8 GPU texture. Allocation uses etagere
/// (shelf packing). The texture is created lazily on first `ensure_texture` call.
pub struct GlyphAtlas {
    pub allocator: etagere::AtlasAllocator,
    #[cfg(target_arch = "wasm32")]
    pub texture: Option<web_sys::WebGlTexture>,
    pub width: u32,
    pub height: u32,
    pub entries: HashMap<GlyphKey, GlyphEntry>,
    pub generation: u32,
}

impl GlyphAtlas {
    /// Create a new 1024×1024 atlas with no GPU texture allocated.
    pub fn new() -> Self {
        Self {
            allocator: etagere::AtlasAllocator::new(etagere::Size::new(1024, 1024)),
            #[cfg(target_arch = "wasm32")]
            texture: None,
            width: 1024,
            height: 1024,
            entries: HashMap::new(),
            generation: 0,
        }
    }

    /// Stub in Phase 1 — Phase 3 creates the R8 WebGL texture here.
    #[cfg(target_arch = "wasm32")]
    pub fn ensure_texture(&mut self, _gl: &web_sys::WebGl2RenderingContext) {}

    /// Look up a cached entry. Returns `None` if not in atlas.
    pub fn get(&self, key: &GlyphKey) -> Option<&GlyphEntry> {
        self.entries.get(key)
    }

    /// Insert a glyph. If the key is already present, returns the existing entry
    /// (idempotent). If the allocator is full, calls `clear()` then retries once.
    pub fn insert(
        &mut self,
        key: GlyphKey,
        bitmap_w: u32,
        bitmap_h: u32,
        offset_x: f32,
        offset_y: f32,
    ) -> &GlyphEntry {
        if self.entries.contains_key(&key) {
            return self.entries.get(&key).unwrap();
        }

        let size = etagere::Size::new(bitmap_w.max(1) as i32, bitmap_h.max(1) as i32);
        let allocation = match self.allocator.allocate(size) {
            Some(a) => a,
            None => {
                self.clear();
                self.allocator.allocate(size).unwrap_or_else(|| {
                    // Bitmap larger than the whole atlas — shrink to 1x1.
                    self.allocator
                        .allocate(etagere::Size::new(1, 1))
                        .expect("1x1 allocation must succeed")
                })
            }
        };

        let rect = allocation.rectangle;
        let u0 = rect.min.x as f32 / self.width as f32;
        let v0 = rect.min.y as f32 / self.height as f32;
        let u1 = rect.max.x as f32 / self.width as f32;
        let v1 = rect.max.y as f32 / self.height as f32;

        let entry = GlyphEntry {
            uv: [u0, v0, u1, v1],
            bitmap_w,
            bitmap_h,
            offset_x,
            offset_y,
            generation: self.generation,
        };
        self.entries.insert(key.clone(), entry);
        self.entries.get(&key).unwrap()
    }

    /// Clear all cached entries and bump the generation counter. The allocator
    /// is recreated at the same size rather than cleared (etagere has no clear API).
    pub fn clear(&mut self) {
        self.entries.clear();
        self.allocator = etagere::AtlasAllocator::new(etagere::Size::new(
            self.width as i32,
            self.height as i32,
        ));
        self.generation += 1;
    }

    /// Delete the WebGL texture. Called from EngineInner Drop.
    #[cfg(target_arch = "wasm32")]
    pub fn destroy(&mut self, gl: &web_sys::WebGl2RenderingContext) {
        if let Some(tex) = self.texture.take() {
            gl.delete_texture(Some(&tex));
        }
    }

    #[cfg(not(target_arch = "wasm32"))]
    pub fn destroy(&mut self) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_atlas_insert_and_lookup() {
        let mut atlas = GlyphAtlas::new();
        let key = GlyphKey { font_id: 1, glyph_id: 10, size_tenths: 160 };
        atlas.insert(key.clone(), 16, 16, 0.0, 0.0);
        let entry = atlas.get(&key).expect("entry should be cached");
        // UV within [0, 1]
        assert!(entry.uv[0] >= 0.0 && entry.uv[2] <= 1.0);
        assert!(entry.uv[1] >= 0.0 && entry.uv[3] <= 1.0);
        // Non-zero area
        assert!(entry.uv[2] > entry.uv[0]);
        assert!(entry.uv[3] > entry.uv[1]);
    }

    #[test]
    fn test_atlas_insert_idempotent() {
        let mut atlas = GlyphAtlas::new();
        let key = GlyphKey { font_id: 1, glyph_id: 10, size_tenths: 160 };
        atlas.insert(key.clone(), 16, 16, 0.0, 0.0);
        let uv_first = atlas.get(&key).unwrap().uv;
        atlas.insert(key.clone(), 16, 16, 0.0, 0.0);
        let uv_second = atlas.get(&key).unwrap().uv;
        assert_eq!(uv_first, uv_second);
    }

    #[test]
    fn test_atlas_clear_bumps_generation() {
        let mut atlas = GlyphAtlas::new();
        let gen_before = atlas.generation;
        atlas.clear();
        assert_eq!(atlas.generation, gen_before + 1);
        let key = GlyphKey { font_id: 1, glyph_id: 10, size_tenths: 160 };
        assert!(atlas.get(&key).is_none());
    }

    #[test]
    fn test_atlas_overflow_clears_and_retries() {
        let mut atlas = GlyphAtlas {
            allocator: etagere::AtlasAllocator::new(etagere::Size::new(32, 32)),
            #[cfg(target_arch = "wasm32")]
            texture: None,
            width: 32,
            height: 32,
            entries: HashMap::new(),
            generation: 0,
        };
        let gen_initial = atlas.generation;
        // Fill the 32×32 atlas with 8×8 glyphs (max 16 fit: 4×4 grid).
        // Inserting the 17th triggers overflow → clear → generation bumps.
        for i in 0..20u16 {
            let key = GlyphKey { font_id: 1, glyph_id: i, size_tenths: 160 };
            atlas.insert(key, 8, 8, 0.0, 0.0);
        }
        assert!(atlas.generation > gen_initial);
    }
}
