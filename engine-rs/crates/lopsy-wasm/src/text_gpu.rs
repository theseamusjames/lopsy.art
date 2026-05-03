//! Text rendering state: font loading, shaping, layout, and measurement.
//!
//! Phase 1: font loading, text layout, and measurement via cosmic-text.
//! Phase 3: software rasterization via swash → RGBA bytes for GPU upload.

use std::collections::HashMap;
use cosmic_text::{Align, Attrs, Buffer, CacheKey, Family, FontSystem, Metrics, Shaping, Style, SwashCache, SwashImage, Weight, Wrap};
use swash::scale::{ScaleContext, Render, Source, StrikeWith};
use swash::zeno::{Format, Vector};

use crate::glyph_atlas::GlyphAtlas;

pub struct TextLayerState {
    pub buffer: Buffer,
    pub color: [f32; 4],
    /// Baseline shift in pixels: positive offsets text upward, negative downward.
    pub baseline_shift: f32,
    /// Hash of the last serialized props JSON — skip re-layout when unchanged.
    pub props_hash: u64,
    /// RGBA pixel bytes from the most recent software render. Cleared on re-layout.
    pub rendered_pixels: Option<Vec<u8>>,
    pub underline: bool,
    pub strikethrough: bool,
}

pub struct TextRendererState {
    pub font_system: FontSystem,
    pub swash_cache: SwashCache,
    pub glyph_atlas: GlyphAtlas,
    pub text_layers: HashMap<String, TextLayerState>,
    scale_context: ScaleContext,
    unhinted_cache: HashMap<CacheKey, Option<SwashImage>>,
}

fn render_glyph_unhinted<'a>(
    font_system: &mut FontSystem,
    scale_ctx: &mut ScaleContext,
    cache: &'a mut HashMap<CacheKey, Option<SwashImage>>,
    cache_key: CacheKey,
) -> Option<&'a SwashImage> {
    cache.entry(cache_key).or_insert_with(|| {
        let font = font_system.get_font(cache_key.font_id)?;
        let mut scaler = scale_ctx
            .builder(font.as_swash())
            .size(f32::from_bits(cache_key.font_size_bits))
            .hint(false)
            .build();
        let offset = Vector::new(cache_key.x_bin.as_float(), cache_key.y_bin.as_float());
        Render::new(&[
            Source::ColorOutline(0),
            Source::ColorBitmap(StrikeWith::BestFit),
            Source::Outline,
        ])
        .format(Format::Alpha)
        .offset(offset)
        .render(&mut scaler, cache_key.glyph_id)
    }).as_ref()
}

fn hash_str(s: &str) -> u64 {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    s.hash(&mut h);
    h.finish()
}

impl TextRendererState {
    /// Create with a FontSystem pre-loaded with the bundled Inter Regular font.
    pub fn new() -> Self {
        let mut db = cosmic_text::fontdb::Database::new();
        db.load_font_data(
            include_bytes!("fonts/Inter-Regular.ttf").to_vec(),
        );
        let font_system = FontSystem::new_with_locale_and_db("en-US".to_string(), db);
        Self {
            font_system,
            swash_cache: SwashCache::new(),
            glyph_atlas: GlyphAtlas::new(),
            text_layers: HashMap::new(),
            scale_context: ScaleContext::new(),
            unhinted_cache: HashMap::new(),
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
    ///   "areaWidth": f32 | null,
    ///   "baselineShift": f32 }
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
        // CSS font family lists like "'Rubik Moonrocks', sans-serif" — extract
        // just the first name so it matches what fontdb stores.
        let font_family_raw = v["fontFamily"].as_str().unwrap_or("sans-serif");
        let font_family_owned: String = font_family_raw
            .split(',')
            .next()
            .unwrap_or(font_family_raw)
            .trim()
            .trim_matches(|c| c == '\'' || c == '"')
            .to_string();
        let font_family = font_family_owned.as_str();
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
<<<<<<< HEAD
        let underline = v["underline"].as_bool().unwrap_or(false);
        let strikethrough = v["strikethrough"].as_bool().unwrap_or(false);
=======
        // Positive baseline shift moves text up (negative y offset in canvas space).
        let baseline_shift = v["baselineShift"].as_f64().unwrap_or(0.0) as f32;
>>>>>>> b1f13d2 (feat(text): add baseline shift property for vertical text offset)

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

        let text_align_val = v["textAlign"].as_str().unwrap_or("left");
        let align = match text_align_val {
            "right" => Some(Align::Right),
            "center" => Some(Align::Center),
            "justify" => Some(Align::Justified),
            _ => Some(Align::Left),
        };
        for line in buffer.lines.iter_mut() {
            line.set_align(align);
        }

        buffer.shape_until_scroll(&mut self.font_system, false);

        self.text_layers.insert(
            layer_id.to_string(),
            TextLayerState {
                buffer,
                color,
                baseline_shift,
                props_hash: new_hash,
                rendered_pixels: None,
                underline,
                strikethrough,
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

    /// Draw a filled horizontal rectangle into the RGBA pixel buffer.
    fn fill_rect(
        pixels: &mut [u8],
        canvas_w: u32,
        canvas_h: u32,
        x: i32,
        y: i32,
        w: i32,
        h: i32,
        color: [f32; 4],
    ) {
        let x_start = x.max(0);
        let y_start = y.max(0);
        let x_end = (x + w).min(canvas_w as i32);
        let y_end = (y + h).min(canvas_h as i32);
        for py in y_start..y_end {
            for px in x_start..x_end {
                let base = ((py as u32 * canvas_w + px as u32) * 4) as usize;
                let src_a = color[3];
                let dst_a = pixels[base + 3] as f32 / 255.0;
                let out_a = src_a + dst_a * (1.0 - src_a);
                if out_a > 0.0 {
                    pixels[base]     = ((color[0] * src_a + pixels[base]     as f32 / 255.0 * dst_a * (1.0 - src_a)) / out_a * 255.0).round() as u8;
                    pixels[base + 1] = ((color[1] * src_a + pixels[base + 1] as f32 / 255.0 * dst_a * (1.0 - src_a)) / out_a * 255.0).round() as u8;
                    pixels[base + 2] = ((color[2] * src_a + pixels[base + 2] as f32 / 255.0 * dst_a * (1.0 - src_a)) / out_a * 255.0).round() as u8;
                    pixels[base + 3] = (out_a * 255.0).round() as u8;
                }
            }
        }
    }

    /// Rasterize the text layer via swash (software) and return RGBA bytes plus
    /// layout geometry. Returns `None` if the layer doesn't exist or has no glyphs.
    ///
    /// Return value: `(pixels, width, height, offset_x, offset_y)` where
    /// `offset_x`/`offset_y` are the offsets from the text anchor to the top-left
    /// of the rendered canvas — callers should set `layer.x = anchor_x + offset_x`.
    pub fn render_text_layer_software(
        &mut self,
        layer_id: &str,
    ) -> Option<(Vec<u8>, u32, u32, i32, i32)> {
        let state = self.text_layers.get_mut(layer_id)?;

        // Padding prevents antialiased edges and descenders from clipping.
        let pad: i32 = 4;

        // Pass 1: measure pixel-space bounding box across all glyphs.
        let mut min_x = i32::MAX;
        let mut min_y = i32::MAX;
        let mut max_x = i32::MIN;
        let mut max_y = i32::MIN;

        // Collect glyph layout data before rendering (avoids borrow conflicts).
        struct GlyphLayout {
            cache_key: CacheKey,
            x: i32,
            y: i32,
        }
<<<<<<< HEAD
        // Per-run info for underline/strikethrough decoration.
        struct RunInfo {
            /// X of leftmost glyph in this run (integer pixels).
            x_start: i32,
            /// X past rightmost glyph in this run.
            x_end: i32,
            /// Baseline y (integer pixels, before canvas_y offset).
            baseline_y: i32,
            /// Font size in pixels.
            font_size: f32,
        }
=======
        // Positive baseline_shift moves text up — subtract from y (screen y increases downward).
        let baseline_shift_px = state.baseline_shift.round() as i32;
>>>>>>> b1f13d2 (feat(text): add baseline shift property for vertical text offset)
        let mut glyph_layouts: Vec<GlyphLayout> = Vec::new();
        let mut run_infos: Vec<RunInfo> = Vec::new();
        for run in state.buffer.layout_runs() {
            let mut run_x_start = i32::MAX;
            let mut run_x_end = i32::MIN;
            for glyph in run.glyphs.iter() {
                let phys = glyph.physical((0.0, run.line_y), 1.0);
                let gx_start = phys.x;
                let gx_end = phys.x + glyph.w.ceil() as i32;
                if gx_start < run_x_start { run_x_start = gx_start; }
                if gx_end > run_x_end { run_x_end = gx_end; }
                glyph_layouts.push(GlyphLayout {
                    cache_key: phys.cache_key,
                    x: phys.x,
                    y: phys.y - baseline_shift_px,
                });
            }
            if run_x_start <= run_x_end {
                run_infos.push(RunInfo {
                    x_start: run_x_start,
                    x_end: run_x_end,
                    baseline_y: run.line_y.round() as i32,
                    font_size: state.buffer.metrics().font_size,
                });
            }
        }
        let color = state.color;
        let do_underline = state.underline;
        let do_strikethrough = state.strikethrough;

        // Render all glyphs without hinting for smooth curves.
        let mut glyph_images: Vec<Option<SwashImage>> = Vec::with_capacity(glyph_layouts.len());
        for gl in &glyph_layouts {
            let img = render_glyph_unhinted(
                &mut self.font_system,
                &mut self.scale_context,
                &mut self.unhinted_cache,
                gl.cache_key,
            ).cloned();
            glyph_images.push(img);
        }

        // Pass 1: measure pixel-space bounding box.
        for (gl, img_opt) in glyph_layouts.iter().zip(glyph_images.iter()) {
            if let Some(img) = img_opt {
                if img.placement.width == 0 || img.placement.height == 0 {
                    continue;
                }
                let gx = gl.x + img.placement.left;
                let gy = gl.y - img.placement.top;
                let gw = img.placement.width as i32;
                let gh = img.placement.height as i32;
                if gx < min_x { min_x = gx; }
                if gy < min_y { min_y = gy; }
                if gx + gw > max_x { max_x = gx + gw; }
                if gy + gh > max_y { max_y = gy + gh; }
            }
        }

        if min_x == i32::MAX {
            return None;
        }

        // Expand bounding box to include decoration lines so they aren't clipped.
        if do_underline || do_strikethrough {
            for ri in &run_infos {
                let thickness = (ri.font_size * 0.08).ceil() as i32;
                if do_underline {
                    let ul_y = ri.baseline_y + (ri.font_size * 0.1).ceil() as i32;
                    if ri.x_start < min_x { min_x = ri.x_start; }
                    if ri.x_end > max_x { max_x = ri.x_end; }
                    if ul_y < min_y { min_y = ul_y; }
                    if ul_y + thickness > max_y { max_y = ul_y + thickness; }
                }
                if do_strikethrough {
                    let st_y = ri.baseline_y - (ri.font_size * 0.32).ceil() as i32;
                    if ri.x_start < min_x { min_x = ri.x_start; }
                    if ri.x_end > max_x { max_x = ri.x_end; }
                    if st_y < min_y { min_y = st_y; }
                    if st_y + thickness > max_y { max_y = st_y + thickness; }
                }
            }
        }

        let canvas_x = min_x - pad;
        let canvas_y = min_y - pad;
        let canvas_w = (max_x - min_x + pad * 2).max(1) as u32;
        let canvas_h = (max_y - min_y + pad * 2).max(1) as u32;

        let mut pixels = vec![0u8; (canvas_w * canvas_h * 4) as usize];

        // Pass 2: composite each glyph into the RGBA buffer.
        for (gl, img_opt) in glyph_layouts.iter().zip(glyph_images.iter()) {
            let img = match img_opt {
                Some(i) if i.placement.width > 0 && i.placement.height > 0 => i,
                _ => continue,
            };

            let gx = gl.x + img.placement.left;
            let gy = gl.y - img.placement.top;

            match img.content {
                cosmic_text::SwashContent::Mask => {
                    for (idx, &alpha_byte) in img.data.iter().enumerate() {
                        if alpha_byte == 0 { continue; }
                        let bx = idx as i32 % img.placement.width as i32;
                        let by = idx as i32 / img.placement.width as i32;
                        let px = gx + bx - canvas_x;
                        let py = gy + by - canvas_y;
                        if px < 0 || py < 0 || px >= canvas_w as i32 || py >= canvas_h as i32 {
                            continue;
                        }
                        let base = ((py as u32 * canvas_w + px as u32) * 4) as usize;
                        let src_a = (alpha_byte as f32 / 255.0) * color[3];
                        let dst_a = pixels[base + 3] as f32 / 255.0;
                        let out_a = src_a + dst_a * (1.0 - src_a);
                        if out_a > 0.0 {
                            pixels[base]     = ((color[0] * src_a + pixels[base]     as f32 / 255.0 * dst_a * (1.0 - src_a)) / out_a * 255.0).round() as u8;
                            pixels[base + 1] = ((color[1] * src_a + pixels[base + 1] as f32 / 255.0 * dst_a * (1.0 - src_a)) / out_a * 255.0).round() as u8;
                            pixels[base + 2] = ((color[2] * src_a + pixels[base + 2] as f32 / 255.0 * dst_a * (1.0 - src_a)) / out_a * 255.0).round() as u8;
                            pixels[base + 3] = (out_a * 255.0).round() as u8;
                        }
                    }
                }
                cosmic_text::SwashContent::Color => {
                    let mut i = 0;
                    for by in 0..img.placement.height as i32 {
                        for bx in 0..img.placement.width as i32 {
                            let r = img.data[i];
                            let g = img.data[i + 1];
                            let b = img.data[i + 2];
                            let a = img.data[i + 3];
                            i += 4;
                            if a == 0 { continue; }
                            let px = gx + bx - canvas_x;
                            let py = gy + by - canvas_y;
                            if px < 0 || py < 0 || px >= canvas_w as i32 || py >= canvas_h as i32 {
                                continue;
                            }
                            let base = ((py as u32 * canvas_w + px as u32) * 4) as usize;
                            let src_a = a as f32 / 255.0;
                            let dst_a = pixels[base + 3] as f32 / 255.0;
                            let out_a = src_a + dst_a * (1.0 - src_a);
                            if out_a > 0.0 {
                                pixels[base]     = ((r as f32 / 255.0 * src_a + pixels[base]     as f32 / 255.0 * dst_a * (1.0 - src_a)) / out_a * 255.0).round() as u8;
                                pixels[base + 1] = ((g as f32 / 255.0 * src_a + pixels[base + 1] as f32 / 255.0 * dst_a * (1.0 - src_a)) / out_a * 255.0).round() as u8;
                                pixels[base + 2] = ((b as f32 / 255.0 * src_a + pixels[base + 2] as f32 / 255.0 * dst_a * (1.0 - src_a)) / out_a * 255.0).round() as u8;
                                pixels[base + 3] = (out_a * 255.0).round() as u8;
                            }
                        }
                    }
                }
                _ => {}
            }
        }

        // Pass 3: draw underline and/or strikethrough lines.
        if do_underline || do_strikethrough {
            for ri in &run_infos {
                let thickness = ((ri.font_size * 0.08).ceil() as i32).max(1);
                let x_rel = ri.x_start - canvas_x;
                let line_w = (ri.x_end - ri.x_start).max(1);
                if do_underline {
                    // Underline sits just below the baseline (CSS spec: ~10% of font-size below).
                    let ul_y = ri.baseline_y + (ri.font_size * 0.1).ceil() as i32 - canvas_y;
                    Self::fill_rect(&mut pixels, canvas_w, canvas_h, x_rel, ul_y, line_w, thickness, color);
                }
                if do_strikethrough {
                    // Strikethrough sits ~32% of font-size above baseline (mid x-height).
                    let st_y = ri.baseline_y - (ri.font_size * 0.32).ceil() as i32 - canvas_y;
                    Self::fill_rect(&mut pixels, canvas_w, canvas_h, x_rel, st_y, line_w, thickness, color);
                }
            }
        }

        Some((pixels, canvas_w, canvas_h, canvas_x, canvas_y))
    }

    /// Return the cached RGBA pixel bytes from the last render, or empty if none.
    pub fn get_rendered_pixels(&self, layer_id: &str) -> Vec<u8> {
        self.text_layers
            .get(layer_id)
            .and_then(|s| s.rendered_pixels.as_ref())
            .cloned()
            .unwrap_or_default()
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
    fn test_bundled_inter_is_loaded() {
        let renderer = make_renderer();
        assert!(renderer.is_font_loaded("Inter"), "Inter should be bundled in new()");
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

<<<<<<< HEAD
    fn props_with_decorations(text: &str, underline: bool, strikethrough: bool) -> String {
        format!(
            r#"{{"text":"{text}","fontFamily":"sans-serif","fontSize":24,"fontWeight":400,"fontStyle":"normal","color":[0,0,0,1],"lineHeight":1.4,"letterSpacing":0,"textAlign":"left","areaWidth":null,"underline":{underline},"strikethrough":{strikethrough}}}"#
        )
    }

    #[test]
    fn test_underline_produces_more_opaque_pixels_than_plain() {
        let mut renderer = make_renderer();
        // Plain text
        renderer.set_text_content("plain", &basic_props("Hello")).expect("ok");
        let (plain_px, _, _, _, _) = renderer.render_text_layer_software("plain")
            .expect("plain render should succeed");
        let plain_opaque: usize = plain_px.chunks(4).filter(|p| p[3] > 0).count();

        // Underlined text
        renderer.set_text_content("under", &props_with_decorations("Hello", true, false)).expect("ok");
        let (under_px, _, _, _, _) = renderer.render_text_layer_software("under")
            .expect("underline render should succeed");
        let under_opaque: usize = under_px.chunks(4).filter(|p| p[3] > 0).count();

        // Underline adds pixels below the text baseline, so the total opaque count
        // must be strictly greater than plain text alone.
        assert!(under_opaque > plain_opaque,
            "underline should add opaque pixels; plain={plain_opaque} under={under_opaque}");
    }

    #[test]
    fn test_strikethrough_produces_more_opaque_pixels_than_plain() {
        let mut renderer = make_renderer();
        // Plain text
        renderer.set_text_content("plain", &basic_props("Hello")).expect("ok");
        let (plain_px, _, _, _, _) = renderer.render_text_layer_software("plain")
            .expect("plain render should succeed");
        let plain_opaque: usize = plain_px.chunks(4).filter(|p| p[3] > 0).count();

        // Strikethrough text
        renderer.set_text_content("strike", &props_with_decorations("Hello", false, true)).expect("ok");
        let (strike_px, _, _, _, _) = renderer.render_text_layer_software("strike")
            .expect("strikethrough render should succeed");
        let strike_opaque: usize = strike_px.chunks(4).filter(|p| p[3] > 0).count();

        // Strikethrough adds a horizontal bar through the text, so the total
        // opaque count must be strictly greater than plain text alone.
        assert!(strike_opaque > plain_opaque,
            "strikethrough should add opaque pixels; plain={plain_opaque} strike={strike_opaque}");
=======
    #[test]
    fn test_baseline_shift_zero_is_default() {
        let mut renderer = make_renderer();
        renderer
            .set_text_content("layer1", &basic_props("Hello"))
            .expect("ok");
        let state = &renderer.text_layers["layer1"];
        assert_eq!(state.baseline_shift, 0.0, "default baseline_shift should be 0");
    }

    #[test]
    fn test_baseline_shift_stored_from_props() {
        let mut renderer = make_renderer();
        let props = r#"{"text":"Hi","fontFamily":"sans-serif","fontSize":16,"fontWeight":400,"fontStyle":"normal","color":[0,0,0,1],"lineHeight":1.4,"letterSpacing":0,"textAlign":"left","areaWidth":null,"baselineShift":20}"#;
        renderer.set_text_content("layer1", props).expect("ok");
        let state = &renderer.text_layers["layer1"];
        assert_eq!(state.baseline_shift, 20.0, "baseline_shift should be stored from props JSON");
    }

    #[test]
    fn test_baseline_shift_offsets_render_y() {
        // Render the same text with and without baseline shift.
        // The version with positive shift should have a smaller (higher) canvas_y offset
        // because glyphs are shifted upward (lower y value in screen space).
        let mut renderer = make_renderer();

        let props_zero = r#"{"text":"A","fontFamily":"sans-serif","fontSize":32,"fontWeight":400,"fontStyle":"normal","color":[0,0,0,1],"lineHeight":1.4,"letterSpacing":0,"textAlign":"left","areaWidth":null,"baselineShift":0}"#;
        let props_shifted = r#"{"text":"A","fontFamily":"sans-serif","fontSize":32,"fontWeight":400,"fontStyle":"normal","color":[0,0,0,1],"lineHeight":1.4,"letterSpacing":0,"textAlign":"left","areaWidth":null,"baselineShift":20}"#;

        renderer.set_text_content("layer_zero", props_zero).expect("ok");
        let result_zero = renderer.render_text_layer_software("layer_zero");
        assert!(result_zero.is_some(), "zero-shift render should succeed");
        let (_, _, _, _, offset_y_zero) = result_zero.unwrap();

        renderer.set_text_content("layer_shifted", props_shifted).expect("ok");
        let result_shifted = renderer.render_text_layer_software("layer_shifted");
        assert!(result_shifted.is_some(), "shifted render should succeed");
        let (_, _, _, _, offset_y_shifted) = result_shifted.unwrap();

        // Positive baseline shift moves text up: canvas_y should be smaller (more negative).
        assert!(
            offset_y_shifted < offset_y_zero,
            "positive baseline shift should move canvas_y up: shifted={offset_y_shifted} zero={offset_y_zero}",
        );
        // The difference should be close to 20px.
        let diff = offset_y_zero - offset_y_shifted;
        assert!(
            diff >= 18 && diff <= 22,
            "y offset difference should be ~20px, got {diff}",
        );
>>>>>>> b1f13d2 (feat(text): add baseline shift property for vertical text offset)
    }
}
