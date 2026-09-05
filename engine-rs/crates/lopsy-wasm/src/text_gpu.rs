//! Text rendering state: font loading, shaping, layout, and measurement.
//!
//! Phase 1: font loading, text layout, and measurement via cosmic-text.
//! Phase 3: software rasterization via swash → RGBA bytes for GPU upload.

use std::collections::HashMap;
use cosmic_text::{Align, Attrs, Buffer, CacheKey, Family, FontSystem, Metrics, Shaping, Stretch, Style, SwashCache, SwashImage, Weight, Wrap};
use swash::scale::{ScaleContext, Render, Source, StrikeWith};
use swash::zeno::{Format, Vector};

use crate::glyph_atlas::GlyphAtlas;

pub struct TextLayerState {
    pub buffer: Buffer,
    pub color: [f32; 4],
    /// Hash of the last serialized props JSON — skip re-layout when unchanged.
    pub props_hash: u64,
    /// RGBA pixel bytes from the most recent software render. Cleared on re-layout.
    pub rendered_pixels: Option<Vec<u8>>,
    pub underline: bool,
    pub strikethrough: bool,
    /// Raw text string, kept to map global byte offsets ↔ buffer lines.
    pub text: String,
    /// Extra px inserted between adjacent glyphs on a visual line (tracking).
    /// cosmic-text has no native letter spacing, so it is applied post-layout.
    pub letter_spacing: f32,
    /// Extra px inserted below each hard paragraph break (`\n`).
    pub paragraph_spacing: f32,
    /// Font size in px (cached for empty-line caret height and alignment math).
    pub font_size: f32,
    /// Area width for wrapped text, or None for point text.
    pub area_width: Option<f32>,
    /// Text alignment, needed for letter-spacing compensation on empty lines.
    pub text_align: String,
}

/// A single laid-out glyph with letter/paragraph spacing applied, in logical
/// layout space. `global_start`/`global_end` are UTF-8 byte offsets into the
/// whole text string (not the per-buffer-line offsets cosmic-text reports).
struct AdjGlyph {
    global_start: usize,
    global_end: usize,
    x: f32,
    w: f32,
    line_i: usize,
    line_top: f32,
    line_height: f32,
}

/// A visual line (one cosmic-text LayoutRun) with spacing applied. Kept even
/// when it has no glyphs so an empty line still has a caret position.
struct AdjLine {
    line_i: usize,
    line_top: f32,
    line_height: f32,
    /// x where a caret before the first glyph / on an empty line sits.
    start_x: f32,
}

/// Fully adjusted layout used by every geometry consumer (caret, hit-test,
/// selection, measurement) so rendering and interaction always agree.
struct AdjLayout {
    /// All glyphs in visual order across every line.
    glyphs: Vec<AdjGlyph>,
    /// One entry per visual line, in order.
    lines: Vec<AdjLine>,
    /// Global byte offset of the first char of each buffer line.
    line_byte_base: Vec<usize>,
}

/// Horizontal compensation applied to a whole visual line so letter spacing
/// does not break center/right alignment. Spacing is added between glyphs
/// (n-1 gaps), growing the line rightward, so centered/right lines shift left.
fn line_x_comp(letter_spacing: f32, n_glyphs: usize, align: &str) -> f32 {
    if letter_spacing == 0.0 || n_glyphs < 2 {
        return 0.0;
    }
    let added = letter_spacing * (n_glyphs - 1) as f32;
    match align {
        "center" => -added / 2.0,
        "right" => -added,
        _ => 0.0,
    }
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

    /// The style/stretch to request for `family`: see [`snap_face_attrs`].
    fn available_face_attrs(&self, family: &str, requested: Style) -> (Style, Stretch) {
        let faces: Vec<(Style, Stretch)> = self
            .font_system
            .db()
            .faces()
            .filter(|face| face.families.iter().any(|(name, _)| name == family))
            .map(|face| (face.style, face.stretch))
            .collect();
        snap_face_attrs(requested, &faces)
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
        let letter_spacing = v["letterSpacing"].as_f64().unwrap_or(0.0) as f32;
        let paragraph_spacing = v["paragraphSpacing"].as_f64().unwrap_or(0.0) as f32;
        let area_width = v["areaWidth"].as_f64().map(|w| w as f32);
        let underline = v["underline"].as_bool().unwrap_or(false);
        let strikethrough = v["strikethrough"].as_bool().unwrap_or(false);

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

        let requested_style = if font_style == "italic" {
            Style::Italic
        } else {
            Style::Normal
        };
        let (style, stretch) = self.available_face_attrs(font_family, requested_style);
        let attrs = Attrs::new()
            .family(Family::Name(font_family))
            .weight(Weight(font_weight))
            .style(style)
            .stretch(stretch);

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
                props_hash: new_hash,
                rendered_pixels: None,
                underline,
                strikethrough,
                text: text.to_string(),
                letter_spacing,
                paragraph_spacing,
                font_size,
                area_width,
                text_align: text_align_val.to_string(),
            },
        );

        Ok(())
    }

    /// Global UTF-8 byte offset of the start of each buffer line, i.e. the
    /// cumulative sum of each line's content length + 1 for its `\n` separator.
    /// Matches the JS string layout where lines are joined by single `\n`.
    fn line_byte_base(buffer: &Buffer) -> Vec<usize> {
        let mut base = Vec::with_capacity(buffer.lines.len());
        let mut acc = 0usize;
        for line in buffer.lines.iter() {
            base.push(acc);
            acc += line.text().len() + 1;
        }
        base
    }

    /// Build the fully adjusted layout (letter + paragraph spacing applied) that
    /// all geometry consumers share. Returns None if the layer is missing.
    fn build_adj_layout(state: &TextLayerState) -> AdjLayout {
        let buffer = &state.buffer;
        let ls = state.letter_spacing;
        let para = state.paragraph_spacing;
        let align = state.text_align.as_str();
        let line_byte_base = Self::line_byte_base(buffer);

        // Empty-line caret x by alignment (area text only; point text sits at 0).
        let empty_start_x = |_line_i: usize| -> f32 {
            match (align, state.area_width) {
                ("center", Some(w)) => w / 2.0,
                ("right", Some(w)) => w,
                _ => 0.0,
            }
        };

        let mut glyphs: Vec<AdjGlyph> = Vec::new();
        let mut lines: Vec<AdjLine> = Vec::new();

        for run in buffer.layout_runs() {
            let line_i = run.line_i;
            let base = line_byte_base.get(line_i).copied().unwrap_or(0);
            let para_y = para * line_i as f32;
            let line_top = run.line_top + para_y;
            let line_height = run.line_height;
            let n = run.glyphs.len();
            let comp = line_x_comp(ls, n, align);

            let start_x = if n > 0 {
                run.glyphs[0].x + comp
            } else {
                empty_start_x(line_i)
            };
            lines.push(AdjLine { line_i, line_top, line_height, start_x });

            for (i, glyph) in run.glyphs.iter().enumerate() {
                let x = glyph.x + comp + ls * i as f32;
                glyphs.push(AdjGlyph {
                    global_start: base + glyph.start,
                    global_end: base + glyph.end,
                    x,
                    w: glyph.w,
                    line_i,
                    line_top,
                    line_height,
                });
            }
        }

        AdjLayout { glyphs, lines, line_byte_base }
    }

    /// Map a global byte offset to its buffer-line index (largest line whose
    /// base is <= offset). Returns 0 for an empty buffer.
    fn line_for_offset(line_byte_base: &[usize], offset: usize) -> usize {
        let mut line_i = 0;
        for (i, &base) in line_byte_base.iter().enumerate() {
            if base <= offset {
                line_i = i;
            } else {
                break;
            }
        }
        line_i
    }

    /// Layout-space caret rectangle for a global byte offset: `[x, top, height]`.
    /// Returns None only if the layer is missing.
    pub fn text_cursor_rect(&self, layer_id: &str, offset: usize) -> Option<[f32; 3]> {
        let state = self.text_layers.get(layer_id)?;
        let layout = Self::build_adj_layout(state);

        // Empty text: caret at the origin, one line tall.
        if layout.lines.is_empty() {
            return Some([0.0, 0.0, state.buffer.metrics().line_height]);
        }

        let line_i = Self::line_for_offset(&layout.line_byte_base, offset);

        // First glyph on this line whose cluster ends past the cursor → caret at
        // its left edge. Restricting to `line_i` keeps a caret sitting in a `\n`
        // gap on the end of the earlier line rather than the start of the next.
        for g in layout.glyphs.iter().filter(|g| g.line_i == line_i) {
            if offset < g.global_end {
                return Some([g.x, g.line_top, g.line_height]);
            }
        }
        // Past every glyph on the line → caret after the last one.
        if let Some(g) = layout.glyphs.iter().filter(|g| g.line_i == line_i).last() {
            return Some([g.x + g.w, g.line_top, g.line_height]);
        }
        // Empty line: use its recorded start.
        if let Some(l) = layout.lines.iter().find(|l| l.line_i == line_i) {
            return Some([l.start_x, l.line_top, l.line_height]);
        }
        // Fallback: last line's geometry.
        let last = layout.lines.last().unwrap();
        Some([last.start_x, last.line_top, last.line_height])
    }

    /// Map a layout-space point to the nearest global byte offset, or None if the
    /// layer is missing. Clamps to the closest line by y and the closest glyph
    /// boundary by x within that line.
    pub fn text_hit_position(&self, layer_id: &str, x: f32, y: f32) -> Option<usize> {
        let state = self.text_layers.get(layer_id)?;
        let layout = Self::build_adj_layout(state);
        if layout.lines.is_empty() {
            return Some(0);
        }

        // Pick the visual line whose vertical band contains y, else the nearest.
        let mut best_line = 0usize;
        let mut best_dist = f32::INFINITY;
        for (idx, l) in layout.lines.iter().enumerate() {
            let dist = if y < l.line_top {
                l.line_top - y
            } else if y > l.line_top + l.line_height {
                y - (l.line_top + l.line_height)
            } else {
                0.0
            };
            if dist < best_dist {
                best_dist = dist;
                best_line = idx;
            }
        }
        let target_line_i = layout.lines[best_line].line_i;

        // Nearest glyph boundary on that line by x.
        let line_glyphs: Vec<&AdjGlyph> =
            layout.glyphs.iter().filter(|g| g.line_i == target_line_i).collect();
        if line_glyphs.is_empty() {
            // Empty line — caret goes to the line start offset.
            return Some(layout.line_byte_base.get(target_line_i).copied().unwrap_or(0));
        }

        for g in &line_glyphs {
            // Left half of the glyph → before it; right half → after it.
            if x < g.x + g.w / 2.0 {
                return Some(g.global_start);
            }
        }
        // Past the last glyph → end of the last cluster on the line.
        Some(line_glyphs.last().unwrap().global_end)
    }

    /// Highlight rectangles for a selection `[start, end)` as a flat array of
    /// `[x, top, w, height, ...]`, one rect per visual line the range covers.
    pub fn text_selection_rects(&self, layer_id: &str, start: usize, end: usize) -> Vec<f32> {
        let (start, end) = (start.min(end), start.max(end));
        let mut out: Vec<f32> = Vec::new();
        let state = match self.text_layers.get(layer_id) {
            Some(s) => s,
            None => return out,
        };
        if start == end {
            return out;
        }
        let layout = Self::build_adj_layout(state);

        for line in &layout.lines {
            let line_glyphs: Vec<&AdjGlyph> =
                layout.glyphs.iter().filter(|g| g.line_i == line.line_i).collect();

            // Collect the adjusted x-extent of glyphs whose cluster overlaps
            // [start, end). A cluster overlaps when start < g.global_end and
            // end > g.global_start.
            let mut lo = f32::INFINITY;
            let mut hi = f32::NEG_INFINITY;
            for g in &line_glyphs {
                if start < g.global_end && end > g.global_start {
                    lo = lo.min(g.x);
                    hi = hi.max(g.x + g.w);
                }
            }

            if hi > lo {
                out.extend_from_slice(&[lo, line.line_top, hi - lo, line.line_height]);
                continue;
            }

            // Empty line inside the selected range → thin caret-width marker.
            let base = layout.line_byte_base.get(line.line_i).copied().unwrap_or(0);
            let line_len = state
                .buffer
                .lines
                .get(line.line_i)
                .map(|l| l.text().len())
                .unwrap_or(0);
            let line_start = base;
            let line_end = base + line_len;
            if line_glyphs.is_empty() && start <= line_start && end > line_end {
                out.extend_from_slice(&[line.start_x, line.line_top, 4.0, line.line_height]);
            }
        }

        out
    }

    /// Returns [x, y, width, height] bounding box from the Buffer's layout runs.
    /// x and y are the top-left offset from the text origin (0,0).
    /// Returns [0, 0, 0, 0] if the layer doesn't exist or has no visible glyphs.
    pub fn measure_text_bounds(&mut self, layer_id: &str) -> [f64; 4] {
        let state = match self.text_layers.get(layer_id) {
            Some(s) => s,
            None => return [0.0, 0.0, 0.0, 0.0],
        };
        let layout = Self::build_adj_layout(state);

        let mut min_x = f32::INFINITY;
        let mut min_y = f32::INFINITY;
        let mut max_x = f32::NEG_INFINITY;
        let mut max_y = f32::NEG_INFINITY;

        for g in &layout.glyphs {
            let gy = g.line_top;
            if g.x < min_x { min_x = g.x; }
            if gy < min_y { min_y = gy; }
            if g.x + g.w > max_x { max_x = g.x + g.w; }
            if gy + g.line_height > max_y { max_y = gy + g.line_height; }
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

    /// Returns per-glyph positions as a flat array of [x, y, w, h, global_offset]
    /// tuples, with letter/paragraph spacing applied. `global_offset` is the
    /// UTF-8 byte offset of the glyph's cluster in the whole text string.
    /// Empty if the layer doesn't exist.
    pub fn get_glyph_positions(&mut self, layer_id: &str) -> Vec<f64> {
        let state = match self.text_layers.get(layer_id) {
            Some(s) => s,
            None => return Vec::new(),
        };
        let layout = Self::build_adj_layout(state);

        let mut result = Vec::new();
        for g in &layout.glyphs {
            result.push(g.x as f64);
            result.push(g.line_top as f64);
            result.push(g.w as f64);
            result.push(g.line_height as f64);
            result.push(g.global_start as f64);
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
        let ls = state.letter_spacing;
        let para = state.paragraph_spacing;
        let align = state.text_align.clone();
        let mut glyph_layouts: Vec<GlyphLayout> = Vec::new();
        let mut run_infos: Vec<RunInfo> = Vec::new();
        for run in state.buffer.layout_runs() {
            let mut run_x_start = i32::MAX;
            let mut run_x_end = i32::MIN;
            // Letter/paragraph spacing applied post-layout (cosmic-text lacks both):
            // shift each glyph right by comp + letter_spacing*index and every run
            // down by paragraph_spacing per hard line break.
            let comp = line_x_comp(ls, run.glyphs.len(), &align);
            let para_y = para * run.line_i as f32;
            let baseline_y = run.line_y + para_y;
            for (i, glyph) in run.glyphs.iter().enumerate() {
                let extra_x = comp + ls * i as f32;
                let phys = glyph.physical((extra_x, baseline_y), 1.0);
                let gx_start = phys.x;
                let gx_end = phys.x + glyph.w.ceil() as i32;
                if gx_start < run_x_start { run_x_start = gx_start; }
                if gx_end > run_x_end { run_x_end = gx_end; }
                glyph_layouts.push(GlyphLayout {
                    cache_key: phys.cache_key,
                    x: phys.x,
                    y: phys.y,
                });
            }
            if run_x_start <= run_x_end {
                run_infos.push(RunInfo {
                    x_start: run_x_start,
                    x_end: run_x_end,
                    baseline_y: baseline_y.round() as i32,
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

/// cosmic-text only considers faces whose style *and* stretch equal the
/// request exactly, and it has no cross-style fallback — so a family that
/// ships only italic faces (Zapfino flags its single face italic) or only
/// condensed ones (Impact declares usWidthClass 3) would be skipped entirely
/// and the text would silently render in the Inter fallback. Snap the request
/// to what the family actually ships: keep it when a face satisfies it,
/// otherwise the nearest available style, then the stretch closest to normal
/// among faces of that style. An unknown family is passed through untouched
/// so the ordinary fallback chain still runs.
pub fn snap_face_attrs(requested: Style, faces: &[(Style, Stretch)]) -> (Style, Stretch) {
    if faces.is_empty() {
        return (requested, Stretch::Normal);
    }
    let has_style = |style: Style| faces.iter().any(|(s, _)| *s == style);
    let preference: [Style; 3] = match requested {
        Style::Normal => [Style::Normal, Style::Oblique, Style::Italic],
        Style::Italic => [Style::Italic, Style::Oblique, Style::Normal],
        Style::Oblique => [Style::Oblique, Style::Italic, Style::Normal],
    };
    let style = preference
        .into_iter()
        .find(|s| has_style(*s))
        .unwrap_or(requested);
    let normal = i32::from(Stretch::Normal.to_number());
    let stretch = faces
        .iter()
        .filter(|(s, _)| *s == style)
        .map(|(_, st)| *st)
        .min_by_key(|st| (i32::from(st.to_number()) - normal).abs())
        .unwrap_or(Stretch::Normal);
    (style, stretch)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snap_keeps_the_request_when_the_family_ships_it() {
        let faces = [(Style::Normal, Stretch::Normal), (Style::Italic, Stretch::Normal)];
        assert_eq!(snap_face_attrs(Style::Normal, &faces), (Style::Normal, Stretch::Normal));
        assert_eq!(snap_face_attrs(Style::Italic, &faces), (Style::Italic, Stretch::Normal));
    }

    #[test]
    fn snap_uses_the_italic_face_of_an_italic_only_family() {
        // Zapfino: one face, fsSelection ITALIC set, style name "Regular".
        let faces = [(Style::Italic, Stretch::Normal)];
        assert_eq!(snap_face_attrs(Style::Normal, &faces), (Style::Italic, Stretch::Normal));
    }

    #[test]
    fn snap_prefers_upright_when_italic_is_requested_but_missing() {
        let faces = [(Style::Normal, Stretch::Normal)];
        assert_eq!(snap_face_attrs(Style::Italic, &faces), (Style::Normal, Stretch::Normal));
        let oblique_only = [(Style::Oblique, Stretch::Normal), (Style::Normal, Stretch::Condensed)];
        assert_eq!(snap_face_attrs(Style::Italic, &oblique_only), (Style::Oblique, Stretch::Normal));
    }

    #[test]
    fn snap_uses_the_stretch_nearest_to_normal_that_the_style_ships() {
        // Impact: a single face declaring usWidthClass 3.
        assert_eq!(
            snap_face_attrs(Style::Normal, &[(Style::Normal, Stretch::Condensed)]),
            (Style::Normal, Stretch::Condensed)
        );
        // Papyrus.ttc: Condensed and Regular faces — the normal one wins.
        let papyrus = [(Style::Normal, Stretch::Condensed), (Style::Normal, Stretch::Normal)];
        assert_eq!(snap_face_attrs(Style::Normal, &papyrus), (Style::Normal, Stretch::Normal));
        let wide = [(Style::Normal, Stretch::UltraExpanded), (Style::Normal, Stretch::SemiExpanded)];
        assert_eq!(snap_face_attrs(Style::Normal, &wide), (Style::Normal, Stretch::SemiExpanded));
    }

    #[test]
    fn snap_only_considers_stretches_of_the_chosen_style() {
        let faces = [(Style::Normal, Stretch::Normal), (Style::Italic, Stretch::Condensed)];
        assert_eq!(snap_face_attrs(Style::Italic, &faces), (Style::Italic, Stretch::Condensed));
    }

    #[test]
    fn snap_passes_unknown_families_through() {
        assert_eq!(snap_face_attrs(Style::Italic, &[]), (Style::Italic, Stretch::Normal));
    }

    #[test]
    fn set_text_content_on_a_missing_family_still_lays_out_via_fallback() {
        let mut renderer = make_renderer();
        let props = basic_props("fallback").replace("\"sans-serif\"", "\"No Such Family\"");
        renderer.set_text_content("layer-missing", &props).unwrap();
        assert!(renderer.text_layers.contains_key("layer-missing"));
    }

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

    fn spacing_props(text: &str, letter_spacing: f64, paragraph_spacing: f64, align: &str) -> String {
        format!(
            r#"{{"text":"{text}","fontFamily":"sans-serif","fontSize":20,"fontWeight":400,"fontStyle":"normal","color":[0,0,0,1],"lineHeight":1.4,"letterSpacing":{letter_spacing},"paragraphSpacing":{paragraph_spacing},"textAlign":"{align}","areaWidth":null}}"#
        )
    }

    #[test]
    fn test_glyph_positions_global_offset_multiline() {
        let mut renderer = make_renderer();
        renderer.set_text_content("l", &basic_props("Hi\\nyo")).expect("ok");
        let positions = renderer.get_glyph_positions("l");
        // Collect the global offsets (5th of each 5-tuple).
        let offsets: Vec<usize> = positions.chunks(5).map(|c| c[4] as usize).collect();
        // "Hi\nyo": H=0,i=1 then y=3,o=4 (newline occupies offset 2). The second
        // line's glyphs must carry global offsets >= 3, not line-local 0/1.
        assert!(offsets.iter().any(|&o| o >= 3), "expected a global offset ≥3 for line 2, got {:?}", offsets);
    }

    #[test]
    fn test_hit_position_single_line() {
        let mut renderer = make_renderer();
        renderer.set_text_content("l", &basic_props("Hello")).expect("ok");
        // Far left → start.
        assert_eq!(renderer.text_hit_position("l", -100.0, 5.0), Some(0));
        // Far right → end.
        assert_eq!(renderer.text_hit_position("l", 10000.0, 5.0), Some(5));
    }

    #[test]
    fn test_hit_position_multiline_second_line() {
        let mut renderer = make_renderer();
        renderer.set_text_content("l", &basic_props("Hello\\nWorld")).expect("ok");
        // A click well below the first line, at far left, lands at the start of
        // the second line → global offset 6 ("Hello" = 5 + newline).
        let pos = renderer.text_hit_position("l", -100.0, 40.0).unwrap();
        assert_eq!(pos, 6, "expected start of line 2 (offset 6), got {pos}");
    }

    #[test]
    fn test_cursor_rect_second_line_below_first() {
        let mut renderer = make_renderer();
        renderer.set_text_content("l", &basic_props("Hello\\nWorld")).expect("ok");
        let top1 = renderer.text_cursor_rect("l", 0).unwrap()[1];
        // Offset 6 = start of "World" on line 2.
        let rect2 = renderer.text_cursor_rect("l", 6).unwrap();
        assert!(rect2[1] > top1, "line 2 caret top ({}) should be below line 1 ({top1})", rect2[1]);
        assert!(rect2[0] < 1.0, "line 2 start caret x should be ~0, got {}", rect2[0]);
    }

    #[test]
    fn test_cursor_rect_end_of_first_line_stays_on_first_line() {
        let mut renderer = make_renderer();
        renderer.set_text_content("l", &basic_props("Hello\\nWorld")).expect("ok");
        // Offset 5 = end of "Hello", before the '\n'. Must render on line 1, not
        // jump to the start of line 2 (regression guard for the cluster bug).
        let top_start = renderer.text_cursor_rect("l", 0).unwrap()[1];
        let rect_end = renderer.text_cursor_rect("l", 5).unwrap();
        assert_eq!(rect_end[1], top_start, "offset 5 should stay on line 1");
        assert!(rect_end[0] > 1.0, "offset 5 caret should be past line start");
    }

    #[test]
    fn test_cursor_rect_empty_leading_line() {
        let mut renderer = make_renderer();
        renderer.set_text_content("l", &basic_props("\\nHi")).expect("ok");
        // Offset 0 sits on the empty first line: x≈0, height = line height.
        let rect = renderer.text_cursor_rect("l", 0).unwrap();
        assert!(rect[0].abs() < 1.0, "empty-line caret x should be ~0, got {}", rect[0]);
        assert!(rect[2] > 0.0, "caret height should be positive, got {}", rect[2]);
    }

    #[test]
    fn test_selection_rects_single_line() {
        let mut renderer = make_renderer();
        renderer.set_text_content("l", &basic_props("Hello")).expect("ok");
        let rects = renderer.text_selection_rects("l", 0, 5);
        assert_eq!(rects.len(), 4, "single-line selection = one rect (4 values)");
        assert!(rects[2] > 0.0, "selection width should be positive");
    }

    #[test]
    fn test_selection_rects_cross_line() {
        let mut renderer = make_renderer();
        renderer.set_text_content("l", &basic_props("Hello\\nWorld")).expect("ok");
        // Select from offset 2 to offset 9 (spans the newline) → two rects.
        let rects = renderer.text_selection_rects("l", 2, 9);
        assert_eq!(rects.len(), 8, "cross-line selection = two rects (8 values), got {:?}", rects);
        // Second rect's top must be below the first.
        assert!(rects[5] > rects[1], "second selection rect should be lower");
    }

    #[test]
    fn test_selection_rects_empty_is_empty() {
        let mut renderer = make_renderer();
        renderer.set_text_content("l", &basic_props("Hello")).expect("ok");
        assert!(renderer.text_selection_rects("l", 3, 3).is_empty());
    }

    #[test]
    fn test_letter_spacing_widens_bounds() {
        let mut renderer = make_renderer();
        renderer.set_text_content("plain", &spacing_props("Hello", 0.0, 0.0, "left")).expect("ok");
        let plain = renderer.measure_text_bounds("plain")[2];
        renderer.set_text_content("wide", &spacing_props("Hello", 8.0, 0.0, "left")).expect("ok");
        let wide = renderer.measure_text_bounds("wide")[2];
        // 5 glyphs, 4 gaps × 8px ≈ 32px wider.
        assert!(wide > plain + 20.0, "letter spacing should widen bounds: plain={plain} wide={wide}");
    }

    #[test]
    fn test_paragraph_spacing_lowers_second_line() {
        let mut renderer = make_renderer();
        renderer.set_text_content("tight", &spacing_props("A\\nB", 0.0, 0.0, "left")).expect("ok");
        let tight_top = renderer.text_cursor_rect("tight", 2).unwrap()[1];
        renderer.set_text_content("loose", &spacing_props("A\\nB", 0.0, 40.0, "left")).expect("ok");
        let loose_top = renderer.text_cursor_rect("loose", 2).unwrap()[1];
        assert!(loose_top >= tight_top + 35.0, "paragraph spacing should lower line 2: tight={tight_top} loose={loose_top}");
    }

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
    }
}
