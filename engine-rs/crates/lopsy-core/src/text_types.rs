/// Quantize font size to tenths of a pixel so 16.0 and 16.04 map to the same
/// cache slot while 16.0 and 16.1 do not.
pub fn quantize_size(px: f32) -> u32 {
    (px * 10.0).round() as u32
}

/// Cache key for a single rasterized glyph.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct GlyphKey {
    pub font_id: u64,
    pub glyph_id: u16,
    pub size_tenths: u32,
}

/// Cached atlas entry for a single glyph.
#[derive(Debug, Clone)]
pub struct GlyphEntry {
    /// UV rect in the atlas (u0, v0, u1, v1), normalized 0..1.
    pub uv: [f32; 4],
    pub bitmap_w: u32,
    pub bitmap_h: u32,
    /// Horizontal bearing from glyph origin to left edge of bitmap.
    pub offset_x: f32,
    /// Vertical bearing from baseline to top of bitmap.
    pub offset_y: f32,
    /// Atlas generation when inserted — stale if generation mismatches.
    pub generation: u32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_quantize_size_same_bucket() {
        assert_eq!(quantize_size(16.0), quantize_size(16.04));
    }

    #[test]
    fn test_quantize_size_different_bucket() {
        assert_ne!(quantize_size(16.0), quantize_size(16.1));
    }

    #[test]
    fn test_glyph_key_equality() {
        let k1 = GlyphKey { font_id: 1, glyph_id: 42, size_tenths: 160 };
        let k2 = GlyphKey { font_id: 1, glyph_id: 42, size_tenths: 160 };
        assert_eq!(k1, k2);
    }

    #[test]
    fn test_glyph_key_inequality() {
        let k1 = GlyphKey { font_id: 1, glyph_id: 42, size_tenths: 160 };
        let k2 = GlyphKey { font_id: 1, glyph_id: 42, size_tenths: 161 };
        assert_ne!(k1, k2);
    }
}
