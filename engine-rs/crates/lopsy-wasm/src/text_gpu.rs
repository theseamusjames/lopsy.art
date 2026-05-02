//! Text rendering state: font loading, shaping, layout, and measurement.
//!
//! Phase 1: font loading, text layout, and measurement via cosmic-text.
//! `render_text_layer` is a stub — Phase 3 implements the GPU pipeline.

use std::collections::HashMap;
use cosmic_text::{Attrs, Buffer, Family, FontSystem, Metrics, Shaping, Style, SwashCache, Weight, Wrap};

use crate::glyph_atlas::GlyphAtlas;

pub struct TextLayerState {
    pub buffer: Buffer,
    pub color: [f32; 4],
    /// Hash of the last serialized props JSON — skip re-layout when unchanged.
    pub props_hash: u64,
}

pub struct TextRendererState {
    pub font_system: FontSystem,
    pub swash_cache: SwashCache,
    pub glyph_atlas: GlyphAtlas,
    pub text_layers: HashMap<String, TextLayerState>,
}

fn hash_str(s: &str) -> u64 {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    s.hash(&mut h);
    h.finish()
}

impl TextRendererState {
    /// Create with an empty FontSystem (no system font scanning — correct for WASM).
    pub fn new() -> Self {
        let font_system = FontSystem::new_with_locale_and_db(
            "en-US".to_string(),
            cosmic_text::fontdb::Database::new(),
        );
        Self {
            font_system,
            swash_cache: SwashCache::new(),
            glyph_atlas: GlyphAtlas::new(),
            text_layers: HashMap::new(),
        }
    }

    /// Load raw font bytes into fontdb. Returns error if bytes are unparseable.
    pub fn load_font(&mut self, font_data: &[u8]) -> Result<(), String> {
        self.font_system
            .db_mut()
            .load_font_data(font_data.to_vec());
        Ok(())
    }

    /// Returns true if any font face with the given family name is loaded.
    pub fn is_font_loaded(&self, family: &str) -> bool {
        self.font_system.db().faces().any(|f| {
            f.families
                .iter()
                .any(|(name, _)| name.eq_ignore_ascii_case(family))
        })
    }

    /// Parse props_json and create or update the Buffer for layer_id.
    ///
    /// props_json schema:
    /// ```json
    /// { "text": str, "fontFamily": str, "fontSize": f32,
    ///   "fontWeight": u16, "fontStyle": "normal"|"italic",
    ///   "color": [r, g, b, a], "lineHeight": f32, "letterSpacing": f32,
    ///   "textAlign": "left"|"center"|"right"|"justify",
    ///   "areaWidth": f32 | null }
    /// ```
    pub fn set_text_content(
        &mut self,
        layer_id: &str,
        props_json: &str,
    ) -> Result<(), String> {
        let new_hash = hash_str(props_json);

        // Skip re-layout if nothing changed.
        if let Some(state) = self.text_layers.get(layer_id) {
            if state.props_hash == new_hash {
                return Ok(());
            }
        }

        let v: serde_json::Value =
            serde_json::from_str(props_json).map_err(|e| format!("invalid JSON: {e}"))?;

        let text = v["text"].as_str().unwrap_or("");
        let font_family = v["fontFamily"].as_str().unwrap_or("sans-serif");
        let font_size = v["fontSize"].as_f64().unwrap_or(16.0) as f32;
        let font_weight = v["fontWeight"].as_u64().unwrap_or(400) as u16;
        let font_style = v["fontStyle"].as_str().unwrap_or("normal");
        let color = if let Some(arr) = v["color"].as_array() {
            [
                arr.get(0).and_then(|v| v.as_f64()).unwrap_or(0.0) as f32,
                arr.get(1).and_then(|v| v.as_f64()).unwrap_or(0.0) as f32,
                arr.get(2).and_then(|v| v.as_f64()).unwrap_or(0.0) as f32,
                arr.get(3).and_then(|v| v.as_f64()).unwrap_or(1.0) as f32,
            ]
        } else {
            [0.0, 0.0, 0.0, 1.0]
        };
        let line_height = v["lineHeight"].as_f64().unwrap_or(1.4) as f32;
        let area_width = v["areaWidth"].as_f64().map(|w| w as f32);

        let line_height_px = font_size * line_height;
        let metrics = Metrics::new(font_size, line_height_px);

        let mut buffer = Buffer::new(&mut self.font_system, metrics);

        let wrap = if area_width.is_some() {
            Wrap::Word
        } else {
            Wrap::None
        };
        buffer.set_wrap(&mut self.font_system, wrap);

        if let Some(w) = area_width {
            buffer.set_size(&mut self.font_system, Some(w), None);
        }

        let style = if font_style == "italic" {
            Style::Italic
        } else {
            Style::Normal
        };
        let attrs = Attrs::new()
            .family(Family::Name(font_family))
            .weight(Weight(font_weight))
            .style(style);

        buffer.set_text(&mut self.font_system, text, attrs, Shaping::Advanced);
        buffer.shape_until_scroll(&mut self.font_system, false);

        self.text_layers.insert(
            layer_id.to_string(),
            TextLayerState {
                buffer,
                color,
                props_hash: new_hash,
            },
        );

        Ok(())
    }

    /// Returns [x, y, width, height] bounding box from the Buffer's layout runs.
    /// x and y are the top-left offset from the text origin (0,0).
    /// Returns [0, 0, 0, 0] if the layer doesn't exist or has no visible glyphs.
    pub fn measure_text_bounds(&mut self, layer_id: &str) -> [f64; 4] {
        let state = match self.text_layers.get_mut(layer_id) {
            Some(s) => s,
            None => return [0.0, 0.0, 0.0, 0.0],
        };

        let mut min_x = f32::INFINITY;
        let mut min_y = f32::INFINITY;
        let mut max_x = f32::NEG_INFINITY;
        let mut max_y = f32::NEG_INFINITY;

        for run in state.buffer.layout_runs() {
            for glyph in run.glyphs.iter() {
                let gx = glyph.x;
                let gy = run.line_y - state.buffer.metrics().font_size;
                let gw = glyph.w;
                let gh = state.buffer.metrics().line_height;
                if gx < min_x { min_x = gx; }
                if gy < min_y { min_y = gy; }
                if gx + gw > max_x { max_x = gx + gw; }
                if gy + gh > max_y { max_y = gy + gh; }
            }
        }

        if !min_x.is_finite() {
            return [0.0, 0.0, 0.0, 0.0];
        }

        [
            min_x as f64,
            min_y as f64,
            (max_x - min_x) as f64,
            (max_y - min_y) as f64,
        ]
    }

    /// Returns per-glyph positions as a flat array of [x, y, w, h, cluster_index] tuples.
    /// Empty if the layer doesn't exist.
    pub fn get_glyph_positions(&mut self, layer_id: &str) -> Vec<f64> {
        let state = match self.text_layers.get_mut(layer_id) {
            Some(s) => s,
            None => return Vec::new(),
        };

        let mut result = Vec::new();
        for run in state.buffer.layout_runs() {
            for glyph in run.glyphs.iter() {
                result.push(glyph.x as f64);
                result.push((run.line_y - state.buffer.metrics().font_size) as f64);
                result.push(glyph.w as f64);
                result.push(state.buffer.metrics().line_height as f64);
                result.push(glyph.start as f64);
            }
        }
        result
    }

    /// Phase 1 stub — no-op. Phase 3 implements the full GPU rendering pipeline.
    /// The `engine` parameter is present for Phase 3 compatibility; unused here.
    pub fn render_text_layer(&mut self, _layer_id: &str) -> Result<(), String> {
        Ok(())
    }

    /// Remove all state for a deleted text layer.
    pub fn remove_text_layer(&mut self, layer_id: &str) {
        self.text_layers.remove(layer_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_renderer() -> TextRendererState {
        TextRendererState::new()
    }

    fn basic_props(text: &str) -> String {
        format!(
            r#"{{"text":"{text}","fontFamily":"sans-serif","fontSize":16,"fontWeight":400,"fontStyle":"normal","color":[0,0,0,1],"lineHeight":1.4,"letterSpacing":0,"textAlign":"left","areaWidth":null}}"#
        )
    }

    #[test]
    fn test_empty_font_system_has_no_inter() {
        let renderer = make_renderer();
        assert!(!renderer.is_font_loaded("Inter"));
    }

    #[test]
    fn test_set_text_content_creates_layer() {
        let mut renderer = make_renderer();
        renderer
            .set_text_content("layer1", &basic_props("Hello"))
            .expect("should not fail");
        assert!(renderer.text_layers.contains_key("layer1"));
    }

    #[test]
    fn test_measure_bounds_nonzero_for_text() {
        let mut renderer = make_renderer();
        renderer
            .set_text_content("layer1", &basic_props("Hello"))
            .expect("ok");
        let bounds = renderer.measure_text_bounds("layer1");
        assert!(bounds[2] > 0.0, "expected width > 0, got {:?}", bounds);
        assert!(bounds[3] > 0.0, "expected height > 0, got {:?}", bounds);
    }

    #[test]
    fn test_measure_bounds_empty_layer() {
        let mut renderer = make_renderer();
        let bounds = renderer.measure_text_bounds("nonexistent");
        assert_eq!(bounds, [0.0, 0.0, 0.0, 0.0]);
    }

    #[test]
    fn test_remove_text_layer() {
        let mut renderer = make_renderer();
        renderer
            .set_text_content("layer1", &basic_props("X"))
            .expect("ok");
        renderer.remove_text_layer("layer1");
        assert!(!renderer.text_layers.contains_key("layer1"));
    }

    #[test]
    fn test_props_hash_dedup() {
        let mut renderer = make_renderer();
        let props = basic_props("Hello");
        renderer.set_text_content("layer1", &props).expect("ok");
        let hash_before = renderer.text_layers["layer1"].props_hash;
        renderer.set_text_content("layer1", &props).expect("ok");
        let hash_after = renderer.text_layers["layer1"].props_hash;
        assert_eq!(hash_before, hash_after);
    }

    #[test]
    fn test_glyph_positions_count() {
        let mut renderer = make_renderer();
        renderer
            .set_text_content("layer1", &basic_props("ABC"))
            .expect("ok");
        let positions = renderer.get_glyph_positions("layer1");
        // Each glyph is 5 values. "ABC" = at least 3 glyphs.
        assert!(positions.len() >= 15, "expected ≥15 values for 3 glyphs, got {}", positions.len());
    }
}
