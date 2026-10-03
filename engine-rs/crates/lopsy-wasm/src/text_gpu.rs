//! Text rendering state: font loading, shaping, layout, and measurement.
//!
//! Phase 1: font loading, text layout, and measurement via cosmic-text.
//! Phase 3: software rasterization via swash → RGBA bytes for GPU upload.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use cosmic_text::fontdb;
use cosmic_text::{Align, Attrs, Buffer, CacheKey, Family, FontSystem, Metrics, Shaping, Stretch, Style, SwashCache, SwashImage, Weight, Wrap};
use lopsy_core::text_color_spans::ColorSpans;
use lopsy_core::vertical_orientation::{vertical_form_transform, VerticalGlyphForm};
use swash::scale::{ScaleContext, Render, Source, StrikeWith};
use swash::zeno::{Format, Transform, Vector};

use crate::glyph_atlas::GlyphAtlas;
use crate::vertical_forms::{vertical_glyph, VerticalAlternateCache};

pub struct TextLayerState {
    pub buffer: Buffer,
    pub color: [f32; 4],
    /// Per-range colours over `color` (UTF-8 byte ranges into `text`).
    pub color_spans: ColorSpans,
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
    /// When true, glyphs stack top-to-bottom in a column centered on the anchor
    /// and each `\n` starts a new column to the right. `letter_spacing` becomes
    /// the extra vertical gap between glyphs and `line_height` (× font_size) the
    /// horizontal advance from one column center to the next.
    pub vertical: bool,
    /// Line-height multiplier (kept so vertical layout can compute the column
    /// advance from font_size × line_height without re-parsing props).
    pub line_height: f32,
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
///
/// In vertical mode `line_i` on each glyph is the *column* index (one column
/// per buffer line), `line_top` is the row's top-y, `line_height` is
/// `font_size` (one row's advance minus letter_spacing), and `x`/`w` are the
/// glyph's centered horizontal extent within its column. `col_advance` is the
/// horizontal step from one column's left edge to the next (including
/// paragraph_spacing) so hit-test can pick a column from an x coordinate.
struct AdjLayout {
    /// All glyphs in visual order across every line (or column in vertical).
    glyphs: Vec<AdjGlyph>,
    /// One entry per visual line (or column in vertical mode), in order.
    lines: Vec<AdjLine>,
    /// Global byte offset of the first char of each buffer line.
    line_byte_base: Vec<usize>,
    /// Vertical text mode — glyphs are stacked in columns.
    vertical: bool,
    /// In vertical mode: horizontal step from one column's left edge to the
    /// next (font_size × line_height + paragraph_spacing). Zero otherwise.
    col_advance: f32,
    /// In vertical mode: font_size × line_height — the column's inner width
    /// used to place the caret at the column's left edge.
    col_width: f32,
    /// In vertical mode: font_size — a single row's visual height (used as the
    /// caret height and to size vertical rects). Zero otherwise.
    row_height: f32,
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

/// Horizontal shift that aligns one visual line of point text about its
/// anchor: the anchor is the left edge for left / justify, the centre for
/// center and the right edge for right. `left` / `right` are the line's
/// extent with letter spacing applied.
fn point_line_shift(align: &str, left: f32, right: f32) -> f32 {
    match align {
        "center" => -(left + right) / 2.0,
        "right" => -right,
        _ => 0.0,
    }
}

/// Alignment shift for one layout run (`xs` are its glyphs' x with letter
/// spacing applied). Point text has no box, so cosmic-text aligns each
/// paragraph within its own width — a no-op — and the lines are aligned
/// about the anchor here instead. Area and vertical text return 0.
fn run_align_shift(state: &TextLayerState, xs: &[f32], ws: &[f32]) -> f32 {
    if state.area_width.is_some() || state.vertical || xs.is_empty() {
        return 0.0;
    }
    let left = xs.iter().copied().fold(f32::INFINITY, f32::min);
    let right = xs
        .iter()
        .zip(ws)
        .map(|(x, w)| x + w)
        .fold(f32::NEG_INFINITY, f32::max);
    point_line_shift(&state.text_align, left, right)
}

/// Letter-spacing offset for each glyph of a layout run, in run order.
/// Spacing accumulates in *visual* (left-to-right) order: cosmic-text hands
/// an RTL run's glyphs in logical order, so glyph 0 is the rightmost on
/// screen and indexing by position in the run would push each later (further
/// left) glyph rightwards into its neighbours (#972).
fn letter_spacing_offsets(glyph_xs: &[f32], letter_spacing: f32) -> Vec<f32> {
    let mut offsets = vec![0.0; glyph_xs.len()];
    if letter_spacing == 0.0 {
        return offsets;
    }
    let mut order: Vec<usize> = (0..glyph_xs.len()).collect();
    order.sort_by(|&a, &b| glyph_xs[a].total_cmp(&glyph_xs[b]).then(a.cmp(&b)));
    for (rank, &i) in order.iter().enumerate() {
        offsets[i] = letter_spacing * rank as f32;
    }
    offsets
}

pub struct TextRendererState {
    pub font_system: FontSystem,
    pub swash_cache: SwashCache,
    pub glyph_atlas: GlyphAtlas,
    pub text_layers: HashMap<String, TextLayerState>,
    scale_context: ScaleContext,
    unhinted_cache: HashMap<(CacheKey, VerticalGlyphForm), Option<SwashImage>>,
    vertical_alternates: VerticalAlternateCache,
    /// (lowercased family, style, weight) combinations already tried for
    /// variable-font instancing, so a failure is not retried every layout.
    instanced_weights: HashSet<(String, Style, u16)>,
    /// Largest side a rendered layer may have — the GPU's `MAX_TEXTURE_SIZE`,
    /// set by the API layer. Text larger than this is cropped to it rather
    /// than producing a raster no texture can hold.
    pub max_canvas_side: u32,
}

/// Glyph rasters for em sizes above this are not kept in `unhinted_cache`,
/// which never evicts: a 900 px glyph's mask is ~0.8 MB, a 3000 px one ~9 MB,
/// and each glyph can be cached at four subpixel offsets.
const MAX_CACHED_GLYPH_PX: f32 = 500.0;

/// Rasterize a glyph without hinting, drawn in `form` (see
/// [`VerticalGlyphForm`]; horizontal text always passes `Upright`).
fn render_glyph_unhinted<'a>(
    font_system: &mut FontSystem,
    scale_ctx: &mut ScaleContext,
    cache: &'a mut HashMap<(CacheKey, VerticalGlyphForm), Option<SwashImage>>,
    cache_key: CacheKey,
    form: VerticalGlyphForm,
) -> Option<&'a SwashImage> {
    cache.entry((cache_key, form)).or_insert_with(|| {
        let font = font_system.get_font(cache_key.font_id)?;
        let font_size = f32::from_bits(cache_key.font_size_bits);
        let advance = font
            .as_swash()
            .glyph_metrics(&[])
            .scale(font_size)
            .advance_width(cache_key.glyph_id);
        let transform = vertical_form_transform(form, advance, font_size)
            .map(|[xx, xy, yx, yy, x, y]| Transform::new(xx, xy, yx, yy, x, y));
        let mut scaler = scale_ctx
            .builder(font.as_swash())
            .size(font_size)
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
        .transform(transform)
        .render(&mut scaler, cache_key.glyph_id)
    }).as_ref()
}

/// Key of the scaled layout a transformed text layer rasterizes from. It is
/// kept apart from the layer's own key so caret and hit-test geometry stay in
/// unscaled layout space.
pub fn raster_key(layer_id: &str) -> String {
    format!("{layer_id}\u{1}raster")
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
        register_fallback_for_every_style(&mut db);
        let font_system = FontSystem::new_with_locale_and_db("en-US".to_string(), db);
        Self {
            font_system,
            swash_cache: SwashCache::new(),
            glyph_atlas: GlyphAtlas::new(),
            text_layers: HashMap::new(),
            scale_context: ScaleContext::new(),
            unhinted_cache: HashMap::new(),
            vertical_alternates: HashMap::new(),
            instanced_weights: HashSet::new(),
            max_canvas_side: u32::MAX,
        }
    }

    /// Load raw font bytes into fontdb. fontdb silently skips data it cannot
    /// parse, so report that as an error instead of pretending it loaded.
    pub fn load_font(&mut self, font_data: &[u8]) -> Result<(), String> {
        self.load_font_as(font_data, None)
    }

    /// Load font bytes and, when `family_alias` is given, make every loaded
    /// face answer to that family name too. Web font binaries often carry a
    /// name table that differs from the catalog family they were fetched
    /// for — css2 variable subsets are named after their default instance
    /// ("Montserrat Thin") and some static fonts use different casing
    /// ("IM FELL DW Pica SC") — and text layers request the catalog name.
    pub fn load_font_as(&mut self, font_data: &[u8], family_alias: Option<&str>) -> Result<(), String> {
        let source = fontdb::Source::Binary(Arc::new(font_data.to_vec()));
        let ids = self.font_system.db_mut().load_font_source(source);
        if ids.is_empty() {
            return Err("font data contains no parseable font face".to_string());
        }
        let Some(alias) = family_alias.map(str::trim).filter(|a| !a.is_empty()) else {
            return Ok(());
        };
        let db = self.font_system.db_mut();
        for id in ids {
            let Some(face) = db.face(id) else { continue };
            if face.families.iter().any(|(name, _)| name == alias) {
                continue;
            }
            let mut info = face.clone();
            info.families.insert(0, (alias.to_string(), fontdb::Language::English_UnitedStates));
            db.remove_face(id);
            db.push_face_info(info);
        }
        Ok(())
    }

    /// The family name fontdb stores for `requested`, matched exactly first
    /// and then ASCII-case-insensitively. fontdb and cosmic-text compare
    /// family names case-sensitively, so a request must use the stored
    /// spelling to match at all.
    fn resolve_family_name(&self, requested: &str) -> Option<String> {
        let db = self.font_system.db();
        let exact = db
            .faces()
            .any(|face| face.families.iter().any(|(name, _)| name == requested));
        if exact {
            return Some(requested.to_string());
        }
        db.faces().find_map(|face| {
            face.families
                .iter()
                .find(|(name, _)| name.eq_ignore_ascii_case(requested))
                .map(|(name, _)| name.clone())
        })
    }

    fn family_faces<'a>(&'a self, family: &'a str) -> impl Iterator<Item = &'a fontdb::FaceInfo> + 'a {
        self.font_system
            .db()
            .faces()
            .filter(move |face| face.families.iter().any(|(name, _)| name.eq_ignore_ascii_case(family)))
    }

    /// The style/stretch to request for `family`: see [`snap_face_attrs`].
    fn available_face_attrs(&self, family: &str, requested: Style) -> (Style, Stretch) {
        let faces: Vec<(Style, Stretch)> = self
            .family_faces(family)
            .map(|face| (face.style, face.stretch))
            .collect();
        snap_face_attrs(requested, &faces)
    }

    /// The weight to request for `family` in `style`/`stretch`.
    ///
    /// cosmic-text only uses a family's face when its weight equals the
    /// request exactly; anything else falls through to other families. So:
    /// an exact face wins; otherwise a variable face whose `wght` axis covers
    /// the request is instanced at that weight (see [`crate::variable_instance`]);
    /// otherwise the request snaps to the nearest weight the family ships.
    fn resolve_weight(&mut self, family: &str, style: Style, stretch: Stretch, requested: u16) -> u16 {
        let weights: Vec<u16> = self
            .family_faces(family)
            .filter(|face| face.style == style && face.stretch == stretch)
            .map(|face| face.weight.0)
            .collect();
        if weights.is_empty() || weights.contains(&requested) {
            return requested;
        }
        if self.instance_variable_weight(family, style, stretch, requested) {
            return requested;
        }
        snap_weight(requested, &weights)
    }

    /// Register a static instance of `family`'s variable face at `weight`.
    /// Returns true when a face at exactly that weight now exists.
    fn instance_variable_weight(&mut self, family: &str, style: Style, stretch: Stretch, weight: u16) -> bool {
        let key = (family.to_ascii_lowercase(), style, weight);
        if !self.instanced_weights.insert(key) {
            return false;
        }
        let db = self.font_system.db();
        let source = self
            .family_faces(family)
            .filter(|face| face.style == style && face.stretch == stretch)
            .find_map(|face| {
                let instance = db.with_face_data(face.id, |data, index| {
                    let (min, _, max) = crate::variable_instance::wght_axis_range(data, index)?;
                    if (weight as f32) < min || (weight as f32) > max {
                        return None;
                    }
                    crate::variable_instance::instantiate_wght(data, index, weight)
                })??;
                Some((instance, face.families.clone()))
            });
        let Some((instance, families)) = source else { return false };

        let db = self.font_system.db_mut();
        let ids = db.load_font_source(fontdb::Source::Binary(Arc::new(instance)));
        let mut is_loaded = false;
        for id in ids {
            let Some(face) = db.face(id) else { continue };
            let mut info = face.clone();
            info.families = families.clone();
            info.weight = fontdb::Weight(weight);
            is_loaded |= info.style == style && info.stretch == stretch;
            db.remove_face(id);
            db.push_face_info(info);
        }
        is_loaded
    }

    /// Returns true if any font face with the given family name is loaded.
    pub fn is_font_loaded(&self, family: &str) -> bool {
        self.family_faces(family).next().is_some()
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
    ///   "colorSpans": [[start, end, r, g, b, a], ...] }
    /// ```
    /// `colorSpans` ranges are UTF-16 offsets into `text` (JS string indices).
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
        let color_spans = parse_color_spans(text, &v["colorSpans"]);
        let line_height = v["lineHeight"].as_f64().unwrap_or(1.4) as f32;
        let letter_spacing = v["letterSpacing"].as_f64().unwrap_or(0.0) as f32;
        let paragraph_spacing = v["paragraphSpacing"].as_f64().unwrap_or(0.0) as f32;
        let area_width = v["areaWidth"].as_f64().map(|w| w as f32);
        let underline = v["underline"].as_bool().unwrap_or(false);
        let strikethrough = v["strikethrough"].as_bool().unwrap_or(false);
        let vertical = v["vertical"].as_bool().unwrap_or(false);

        let line_height_px = font_size * line_height;
        let metrics = Metrics::new(font_size, line_height_px);

        let mut buffer = Buffer::new(&mut self.font_system, metrics);

        // Vertical text repositions glyphs post-shape, so it always shapes as one
        // unwrapped run per buffer line (each buffer line becomes a column).
        let wrap = if area_width.is_some() && !vertical {
            Wrap::Word
        } else {
            Wrap::None
        };
        buffer.set_wrap(&mut self.font_system, wrap);

        if let Some(w) = area_width {
            if !vertical {
                buffer.set_size(&mut self.font_system, Some(w), None);
            }
        }

        let requested_style = if font_style == "italic" {
            Style::Italic
        } else {
            Style::Normal
        };
        let family = self
            .resolve_family_name(font_family)
            .unwrap_or_else(|| font_family.to_string());
        let (style, stretch) = self.available_face_attrs(&family, requested_style);
        let weight = self.resolve_weight(&family, style, stretch, font_weight);
        let attrs = Attrs::new()
            .family(Family::Name(&family))
            .weight(Weight(weight))
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
                color_spans,
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
                vertical,
                line_height,
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
        if state.vertical {
            return Self::build_adj_layout_vertical(state);
        }
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

            let xs: Vec<f32> = run.glyphs.iter().map(|g| g.x).collect();
            let spacing = letter_spacing_offsets(&xs, ls);
            let spaced: Vec<f32> = xs.iter().zip(&spacing).map(|(x, s)| x + comp + s).collect();
            let ws: Vec<f32> = run.glyphs.iter().map(|g| g.w).collect();
            let shift = run_align_shift(state, &spaced, &ws);

            let start_x = if n > 0 {
                xs.iter().copied().fold(f32::INFINITY, f32::min) + comp + shift
            } else {
                empty_start_x(line_i)
            };
            lines.push(AdjLine { line_i, line_top, line_height, start_x });

            for (i, glyph) in run.glyphs.iter().enumerate() {
                let x = spaced[i] + shift;
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

        AdjLayout {
            glyphs,
            lines,
            line_byte_base,
            vertical: false,
            col_advance: 0.0,
            col_width: 0.0,
            row_height: 0.0,
        }
    }

    /// Vertical layout: each buffer line is a column. Glyphs stack top-to-bottom
    /// in their column, each row `font_size + letter_spacing` tall, and every
    /// column is `font_size × line_height` wide (`+ paragraph_spacing` between
    /// columns). Glyphs are centered horizontally within their column.
    fn build_adj_layout_vertical(state: &TextLayerState) -> AdjLayout {
        let buffer = &state.buffer;
        let line_byte_base = Self::line_byte_base(buffer);

        let font_size = state.font_size;
        let col_width = font_size * state.line_height.max(0.0001);
        let col_advance = col_width + state.paragraph_spacing;
        let row_advance = font_size + state.letter_spacing;

        let mut glyphs: Vec<AdjGlyph> = Vec::new();
        let mut lines: Vec<AdjLine> = Vec::new();

        for run in buffer.layout_runs() {
            let col_i = run.line_i;
            let base = line_byte_base.get(col_i).copied().unwrap_or(0);
            let col_left = col_i as f32 * col_advance;
            let col_center = col_left + col_width / 2.0;

            // Empty-column caret: at column's left edge, row 0.
            lines.push(AdjLine {
                line_i: col_i,
                line_top: 0.0,
                line_height: font_size,
                start_x: col_left,
            });

            for (j, glyph) in run.glyphs.iter().enumerate() {
                let row_top = j as f32 * row_advance;
                let gx = col_center - glyph.w / 2.0;
                glyphs.push(AdjGlyph {
                    global_start: base + glyph.start,
                    global_end: base + glyph.end,
                    x: gx,
                    w: glyph.w,
                    line_i: col_i,
                    line_top: row_top,
                    line_height: font_size,
                });
            }
        }

        AdjLayout {
            glyphs,
            lines,
            line_byte_base,
            vertical: true,
            col_advance,
            col_width,
            row_height: font_size,
        }
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

        if layout.vertical {
            // Column left edge — a thin vertical bar next to the current row.
            let col_left = line_i as f32 * layout.col_advance;
            let n_in_col = layout.glyphs.iter().filter(|g| g.line_i == line_i).count();

            // Find the row index (glyph index in column) for this offset.
            let mut row_top = 0.0;
            let mut placed = false;
            for (row_i, g) in layout.glyphs.iter().filter(|g| g.line_i == line_i).enumerate() {
                if offset < g.global_end {
                    row_top = g.line_top;
                    // Anchor caret slightly above the row so it reads "before this glyph".
                    let _ = row_i;
                    placed = true;
                    break;
                }
            }
            if !placed {
                // Past every glyph → caret one row past the last one.
                row_top = n_in_col as f32 * (layout.row_height + state.letter_spacing);
            }
            return Some([col_left, row_top, layout.row_height]);
        }

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

        if layout.vertical {
            // Pick the column whose horizontal band contains x (nearest by x).
            let col_advance = layout.col_advance.max(1.0);
            let n_cols = layout.line_byte_base.len().max(1);
            let raw_col = (x / col_advance).floor() as isize;
            let target_col = raw_col.clamp(0, n_cols as isize - 1) as usize;

            let col_glyphs: Vec<&AdjGlyph> =
                layout.glyphs.iter().filter(|g| g.line_i == target_col).collect();
            if col_glyphs.is_empty() {
                return Some(layout.line_byte_base.get(target_col).copied().unwrap_or(0));
            }

            for g in &col_glyphs {
                // Above the glyph's midpoint → before it; below → after it.
                if y < g.line_top + g.line_height / 2.0 {
                    return Some(g.global_start);
                }
            }
            return Some(col_glyphs.last().unwrap().global_end);
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

        if layout.vertical {
            for line in &layout.lines {
                let col_glyphs: Vec<&AdjGlyph> =
                    layout.glyphs.iter().filter(|g| g.line_i == line.line_i).collect();

                let col_left = line.line_i as f32 * layout.col_advance;
                let mut lo_y = f32::INFINITY;
                let mut hi_y = f32::NEG_INFINITY;
                for g in &col_glyphs {
                    if start < g.global_end && end > g.global_start {
                        lo_y = lo_y.min(g.line_top);
                        hi_y = hi_y.max(g.line_top + g.line_height);
                    }
                }

                if hi_y > lo_y {
                    out.extend_from_slice(&[col_left, lo_y, layout.col_width, hi_y - lo_y]);
                    continue;
                }

                // Empty column inside the selected range → thin caret marker.
                let base = layout.line_byte_base.get(line.line_i).copied().unwrap_or(0);
                let line_len = state
                    .buffer
                    .lines
                    .get(line.line_i)
                    .map(|l| l.text().len())
                    .unwrap_or(0);
                let line_start = base;
                let line_end = base + line_len;
                if col_glyphs.is_empty() && start <= line_start && end > line_end {
                    out.extend_from_slice(&[col_left, 0.0, layout.col_width, layout.row_height]);
                }
            }
            return out;
        }

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
            form: VerticalGlyphForm,
            x: i32,
            y: i32,
            color: [f32; 4],
        }
        // Per-run info for underline/strikethrough decoration: one entry per
        // stretch of same-coloured glyphs, so decorations take the glyph colour.
        struct RunInfo {
            /// X of leftmost glyph in this stretch (integer pixels).
            x_start: i32,
            /// X past rightmost glyph in this stretch.
            x_end: i32,
            /// Baseline y (integer pixels, before canvas_y offset).
            baseline_y: i32,
            /// Font size in pixels.
            font_size: f32,
            color: [f32; 4],
        }
        let ls = state.letter_spacing;
        let para = state.paragraph_spacing;
        let align = state.text_align.clone();
        let font_size = state.buffer.metrics().font_size;
        let line_height_mul = state.line_height;
        let vertical = state.vertical;
        let base_color = state.color;
        let line_bases = Self::line_byte_base(&state.buffer);
        let glyph_color = |line_i: usize, start: usize| -> [f32; 4] {
            let base = line_bases.get(line_i).copied().unwrap_or(0);
            state.color_spans.color_at(base + start, base_color)
        };
        let mut glyph_layouts: Vec<GlyphLayout> = Vec::new();
        let mut run_infos: Vec<RunInfo> = Vec::new();
        if vertical {
            // Vertical layout: each buffer line = one column. Glyphs stack
            // top-to-bottom, centered horizontally within a column of width
            // font_size × line_height. paragraph_spacing widens the gap between
            // columns; letter_spacing widens the gap between glyphs.
            let col_width = font_size * line_height_mul.max(0.0001);
            let col_advance = col_width + para;
            let row_advance = font_size + ls;
            for run in state.buffer.layout_runs() {
                let col_i = run.line_i;
                let col_left = col_i as f32 * col_advance;
                let col_center = col_left + col_width / 2.0;
                for (j, glyph) in run.glyphs.iter().enumerate() {
                    let row_top = j as f32 * row_advance;
                    // Baseline near the bottom of the row so descenders sit in
                    // the row's box; font_size is a close-enough baseline offset.
                    let target_baseline = row_top + font_size;
                    let target_x = col_center - glyph.w / 2.0;
                    let phys = glyph.physical(
                        (target_x - glyph.x, target_baseline),
                        1.0,
                    );
                    let c = run.text[glyph.start..].chars().next().unwrap_or(' ');
                    let (glyph_id, form) = vertical_glyph(
                        &mut self.font_system,
                        &mut self.vertical_alternates,
                        glyph.font_id,
                        glyph.glyph_id,
                        c,
                    );
                    glyph_layouts.push(GlyphLayout {
                        cache_key: CacheKey { glyph_id, ..phys.cache_key },
                        form,
                        x: phys.x,
                        y: phys.y,
                        color: glyph_color(run.line_i, glyph.start),
                    });
                }
            }
        } else {
            for run in state.buffer.layout_runs() {
                let mut run_x_start = i32::MAX;
                let mut run_x_end = i32::MIN;
                let mut run_color: Option<[f32; 4]> = None;
                // Letter/paragraph spacing applied post-layout (cosmic-text lacks both):
                // shift each glyph right by comp + letter_spacing × its visual rank
                // and every run down by paragraph_spacing per hard line break.
                let comp = line_x_comp(ls, run.glyphs.len(), &align);
                let para_y = para * run.line_i as f32;
                let baseline_y = run.line_y + para_y;
                let xs: Vec<f32> = run.glyphs.iter().map(|g| g.x).collect();
                let spacing = letter_spacing_offsets(&xs, ls);
                let spaced: Vec<f32> = xs.iter().zip(&spacing).map(|(x, s)| x + comp + s).collect();
                let ws: Vec<f32> = run.glyphs.iter().map(|g| g.w).collect();
                let shift = run_align_shift(state, &spaced, &ws);
                for (i, glyph) in run.glyphs.iter().enumerate() {
                    let extra_x = comp + spacing[i] + shift;
                    let phys = glyph.physical((extra_x, baseline_y), 1.0);
                    let gx_start = phys.x;
                    let gx_end = phys.x + glyph.w.ceil() as i32;
                    let color = glyph_color(run.line_i, glyph.start);
                    if let Some(prev) = run_color.filter(|c| *c != color) {
                        // Colour changes: close the previous stretch where
                        // this glyph begins (left-to-right), so the
                        // decoration neither breaks nor overlaps itself.
                        if run_x_start <= run_x_end {
                            let x_end = if gx_start >= run_x_start { gx_start } else { run_x_end };
                            run_infos.push(RunInfo {
                                x_start: run_x_start,
                                x_end,
                                baseline_y: baseline_y.round() as i32,
                                font_size,
                                color: prev,
                            });
                        }
                        run_x_start = gx_start;
                        run_x_end = i32::MIN;
                    }
                    run_color = Some(color);
                    if gx_start < run_x_start { run_x_start = gx_start; }
                    if gx_end > run_x_end { run_x_end = gx_end; }
                    glyph_layouts.push(GlyphLayout {
                        cache_key: phys.cache_key,
                        form: VerticalGlyphForm::Upright,
                        x: phys.x,
                        y: phys.y,
                        color,
                    });
                }
                if run_x_start <= run_x_end {
                    run_infos.push(RunInfo {
                        x_start: run_x_start,
                        x_end: run_x_end,
                        baseline_y: baseline_y.round() as i32,
                        font_size,
                        color: run_color.unwrap_or(base_color),
                    });
                }
            }
        }
        // Underline/strikethrough decorations only apply to horizontal text
        // for now — the underline pass reads `run_infos`, which we leave empty
        // in vertical mode.
        let do_underline = state.underline && !vertical;
        let do_strikethrough = state.strikethrough && !vertical;

        // Render all glyphs without hinting for smooth curves. Large glyphs go
        // in a per-render map so repeats are still rasterized once.
        let is_large = |key: &CacheKey| f32::from_bits(key.font_size_bits) > MAX_CACHED_GLYPH_PX;
        let mut large_glyphs: HashMap<(CacheKey, VerticalGlyphForm), Option<SwashImage>> = HashMap::new();
        for gl in &glyph_layouts {
            let cache = if is_large(&gl.cache_key) { &mut large_glyphs } else { &mut self.unhinted_cache };
            render_glyph_unhinted(&mut self.font_system, &mut self.scale_context, cache, gl.cache_key, gl.form);
        }
        let glyph_images: Vec<Option<&SwashImage>> = glyph_layouts
            .iter()
            .map(|gl| {
                let cache = if is_large(&gl.cache_key) { &large_glyphs } else { &self.unhinted_cache };
                cache.get(&(gl.cache_key, gl.form)).and_then(|img| img.as_ref())
            })
            .collect();

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
        // Cropping keeps the top-left, so the offsets callers anchor by hold.
        let canvas_w = ((max_x - min_x + pad * 2).max(1) as u32).min(self.max_canvas_side);
        let canvas_h = ((max_y - min_y + pad * 2).max(1) as u32).min(self.max_canvas_side);

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
                    let color = gl.color;
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
                    Self::fill_rect(&mut pixels, canvas_w, canvas_h, x_rel, ul_y, line_w, thickness, ri.color);
                }
                if do_strikethrough {
                    // Strikethrough sits ~32% of font-size above baseline (mid x-height).
                    let st_y = ri.baseline_y - (ri.font_size * 0.32).ceil() as i32 - canvas_y;
                    Self::fill_rect(&mut pixels, canvas_w, canvas_h, x_rel, st_y, line_w, thickness, ri.color);
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

    /// Remove all state for a deleted text layer, including the scaled
    /// layout a transformed layer rasterizes from.
    pub fn remove_text_layer(&mut self, layer_id: &str) {
        self.text_layers.remove(layer_id);
        self.text_layers.remove(&raster_key(layer_id));
    }
}

/// Parse the props' `colorSpans` (`[[start, end, r, g, b, a], ...]`, UTF-16
/// offsets into `text`). Missing or malformed entries are skipped.
fn parse_color_spans(text: &str, value: &serde_json::Value) -> ColorSpans {
    let Some(arr) = value.as_array() else { return ColorSpans::default() };
    let triples: Vec<(usize, usize, [f32; 4])> = arr
        .iter()
        .filter_map(|entry| {
            let e = entry.as_array()?;
            let n = |i: usize| e.get(i).and_then(|v| v.as_f64());
            Some((
                n(0)? as usize,
                n(1)? as usize,
                [n(2)? as f32, n(3)? as f32, n(4)? as f32, n(5).unwrap_or(1.0) as f32],
            ))
        })
        .collect();
    ColorSpans::from_utf16(text, &triples)
}

/// The weight nearest to `requested` among `available` (heavier wins a tie),
/// or `requested` itself when nothing is available.
pub fn snap_weight(requested: u16, available: &[u16]) -> u16 {
    available
        .iter()
        .copied()
        .min_by_key(|&w| (w.abs_diff(requested), std::cmp::Reverse(w)))
        .unwrap_or(requested)
}

/// Family name of the bundled fallback face's style/stretch aliases. Distinct
/// from "Inter" so a request for Inter itself (whose real italic may be
/// loaded later) never matches an alias.
const STYLE_FALLBACK_FAMILY: &str = "Lopsy Fallback";

const ALL_STRETCHES: [Stretch; 9] = [
    Stretch::UltraCondensed,
    Stretch::ExtraCondensed,
    Stretch::Condensed,
    Stretch::SemiCondensed,
    Stretch::Normal,
    Stretch::SemiExpanded,
    Stretch::Expanded,
    Stretch::ExtraExpanded,
    Stretch::UltraExpanded,
];

/// Per-glyph fallback only walks faces whose style and stretch equal the
/// request (see [`snap_face_attrs`]), so a glyph missing from an italic or
/// condensed face found nothing but the bundled upright, normal-width Inter
/// and drew `.notdef` (#1157, #1164). Register the bundled face once more for
/// every other style/stretch so each request has a fallback; the glyphs it
/// supplies are drawn upright. The aliases share the face's bytes.
fn register_fallback_for_every_style(db: &mut fontdb::Database) {
    let Some(base) = db.faces().next().cloned() else { return };
    for style in [Style::Normal, Style::Italic, Style::Oblique] {
        for stretch in ALL_STRETCHES {
            if style == base.style && stretch == base.stretch {
                continue;
            }
            let mut info = base.clone();
            info.families = vec![(STYLE_FALLBACK_FAMILY.to_string(), fontdb::Language::English_UnitedStates)];
            info.style = style;
            info.stretch = stretch;
            db.push_face_info(info);
        }
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
    fn letter_spacing_offsets_follow_visual_order() {
        // LTR: logical order == visual order.
        assert_eq!(letter_spacing_offsets(&[0.0, 10.0, 20.0], 5.0), vec![0.0, 5.0, 10.0]);
        // RTL: glyph 0 is rightmost, so it gets the largest offset.
        assert_eq!(letter_spacing_offsets(&[20.0, 10.0, 0.0], 5.0), vec![10.0, 5.0, 0.0]);
        assert_eq!(letter_spacing_offsets(&[20.0, 10.0], 0.0), vec![0.0, 0.0]);
    }

    fn sorted_glyph_xs(renderer: &mut TextRendererState, id: &str) -> Vec<f64> {
        let mut xs: Vec<f64> = renderer.get_glyph_positions(id).chunks(5).map(|c| c[0]).collect();
        xs.sort_by(f64::total_cmp);
        xs
    }

    #[test]
    fn rtl_letter_spacing_spreads_glyphs_without_overlap() {
        // #972: Hebrew with letter spacing piled the glyphs on top of each
        // other and shifted the line right by ls × (n − 1).
        let mut renderer = make_renderer();
        let text = "\u{05e9}\u{05dc}\u{05d5}\u{05dd}";
        renderer.set_text_content("plain", &spacing_props(text, 0.0, 0.0, "left")).expect("ok");
        renderer.set_text_content("wide", &spacing_props(text, 10.0, 0.0, "left")).expect("ok");
        let plain = renderer.measure_text_bounds("plain");
        let wide = renderer.measure_text_bounds("wide");
        // Same left edge, 3 gaps × 10 px wider.
        assert!((wide[0] - plain[0]).abs() < 1.0, "left edge moved: plain={plain:?} wide={wide:?}");
        assert!((wide[2] - plain[2] - 30.0).abs() < 2.0, "width: plain={plain:?} wide={wide:?}");

        let plain_xs = sorted_glyph_xs(&mut renderer, "plain");
        let wide_xs = sorted_glyph_xs(&mut renderer, "wide");
        assert_eq!(plain_xs.len(), 4);
        assert_eq!(wide_xs.len(), 4);
        for i in 1..wide_xs.len() {
            let plain_gap = plain_xs[i] - plain_xs[i - 1];
            let wide_gap = wide_xs[i] - wide_xs[i - 1];
            assert!((wide_gap - plain_gap - 10.0).abs() < 0.5, "gap {i}: plain={plain_xs:?} wide={wide_xs:?}");
        }
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

    fn vertical_props(text: &str) -> String {
        format!(
            r#"{{"text":"{text}","fontFamily":"sans-serif","fontSize":20,"fontWeight":400,"fontStyle":"normal","color":[0,0,0,1],"lineHeight":1.4,"letterSpacing":0,"paragraphSpacing":0,"textAlign":"left","areaWidth":null,"underline":false,"strikethrough":false,"vertical":true}}"#
        )
    }

    #[test]
    fn vertical_stacks_glyphs_below_each_other() {
        // Three glyphs in one column: each next glyph must sit strictly BELOW
        // the previous and at the same x (columns are centered on x=col_center).
        let mut renderer = make_renderer();
        renderer.set_text_content("v", &vertical_props("ABC")).expect("ok");
        let positions = renderer.get_glyph_positions("v");
        // Each glyph tuple = [x, y, w, h, global_offset].
        let ys: Vec<f64> = positions.chunks(5).map(|c| c[1]).collect();
        assert!(ys.len() >= 3, "expected 3+ glyph rows, got {:?}", ys);
        assert!(ys[1] > ys[0], "row 1 y ({}) must be below row 0 y ({})", ys[1], ys[0]);
        assert!(ys[2] > ys[1], "row 2 y ({}) must be below row 1 y ({})", ys[2], ys[1]);
        // Glyph heights (row_height) should equal font_size = 20 in vertical.
        for c in positions.chunks(5) {
            assert!((c[3] - 20.0).abs() < 0.5, "row height should ≈ font_size, got {}", c[3]);
        }
    }

    #[test]
    fn vertical_newline_starts_new_column_to_the_right() {
        // "AB\nCD": columns should be side by side horizontally, first at x≈0.
        // The 3rd glyph ("C") must sit to the right of the first glyph ("A")
        // AND at the same y as the first glyph (top of its column).
        let mut renderer = make_renderer();
        renderer.set_text_content("v", &vertical_props("AB\\nCD")).expect("ok");
        let positions = renderer.get_glyph_positions("v");
        let rows: Vec<[f64; 5]> = positions
            .chunks(5)
            .map(|c| [c[0], c[1], c[2], c[3], c[4]])
            .collect();
        assert_eq!(rows.len(), 4, "expected 4 glyphs (A, B, C, D), got {:?}", rows);
        // Row 0 = A (col 0, top). Row 2 = C (col 1, top).
        let a = rows[0];
        let c = rows[2];
        assert!(c[0] > a[0] + 5.0, "C column x ({}) should be right of A column x ({})", c[0], a[0]);
        assert!((c[1] - a[1]).abs() < 0.5, "C y ({}) should equal A y ({})", c[1], a[1]);
    }

    #[test]
    fn vertical_letter_spacing_widens_row_gap() {
        // With letterSpacing = 12, the gap between rows must grow by ≥ 12.
        let mut renderer = make_renderer();
        renderer.set_text_content("tight", &vertical_props("AB")).expect("ok");
        let tight_ys: Vec<f64> = renderer.get_glyph_positions("tight")
            .chunks(5).map(|c| c[1]).collect();
        let tight_gap = tight_ys[1] - tight_ys[0];

        let loose = vertical_props("AB").replace("\"letterSpacing\":0", "\"letterSpacing\":12");
        renderer.set_text_content("loose", &loose).expect("ok");
        let loose_ys: Vec<f64> = renderer.get_glyph_positions("loose")
            .chunks(5).map(|c| c[1]).collect();
        let loose_gap = loose_ys[1] - loose_ys[0];

        assert!(loose_gap >= tight_gap + 11.0,
            "letter spacing should widen row gap: tight={tight_gap} loose={loose_gap}");
    }

    #[test]
    fn vertical_hit_position_second_column() {
        // Click well to the right of the first column should land in column 2.
        // "A\nB" → column 0 has "A" (offset 0), column 1 has "B" (offset 2).
        let mut renderer = make_renderer();
        renderer.set_text_content("v", &vertical_props("A\\nB")).expect("ok");
        // Column width = font_size × lineHeight = 20 × 1.4 = 28. Click at
        // x=40 (in column 1 band), y=5 (row 0).
        let pos = renderer.text_hit_position("v", 40.0, 5.0).unwrap();
        assert_eq!(pos, 2, "expected start of column 2 (offset 2), got {pos}");
    }

    #[test]
    fn vertical_cursor_rect_advances_row_between_glyphs() {
        // Cursor at offsets 0, 1, 2 in "ABC" (all one column) should move
        // downward one row_advance each time.
        let mut renderer = make_renderer();
        renderer.set_text_content("v", &vertical_props("ABC")).expect("ok");
        let r0 = renderer.text_cursor_rect("v", 0).unwrap();
        let r1 = renderer.text_cursor_rect("v", 1).unwrap();
        let r2 = renderer.text_cursor_rect("v", 2).unwrap();
        assert!(r1[1] > r0[1], "cursor at offset 1 y ({}) should be below offset 0 y ({})", r1[1], r0[1]);
        assert!(r2[1] > r1[1], "cursor at offset 2 y ({}) should be below offset 1 y ({})", r2[1], r1[1]);
        // Height per row should equal font_size = 20.
        assert!((r0[2] - 20.0).abs() < 0.5, "caret height should ≈ font_size, got {}", r0[2]);
    }

    #[test]
    fn vertical_render_produces_taller_than_wide_output() {
        // "ABC" rendered vertically should have height > width.
        let mut renderer = make_renderer();
        renderer.set_text_content("v", &vertical_props("ABC")).expect("ok");
        let (_, w, h, _, _) = renderer.render_text_layer_software("v")
            .expect("render should succeed");
        assert!(h > w, "vertical render should be taller than wide: w={w} h={h}");
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

    fn family_props(text: &str, family: &str, weight: u16) -> String {
        format!(
            r#"{{"text":"{text}","fontFamily":"'{family}', serif","fontSize":48,"fontWeight":{weight},"fontStyle":"normal","color":[0,0,0,1],"lineHeight":1.2,"letterSpacing":0,"textAlign":"left","areaWidth":null}}"#
        )
    }

    /// (first family name, weight) of every face the layer's glyphs use.
    fn faces_used(renderer: &TextRendererState, layer_id: &str) -> Vec<(String, u16)> {
        let state = renderer.text_layers.get(layer_id).expect("layer");
        let db = renderer.font_system.db();
        let mut faces: Vec<(String, u16)> = state
            .buffer
            .layout_runs()
            .flat_map(|run| run.glyphs.iter().map(|g| g.font_id))
            .filter_map(|id| db.face(id))
            .map(|face| (face.families[0].0.clone(), face.weight.0))
            .collect();
        faces.dedup();
        faces
    }

    fn opaque_pixels(renderer: &mut TextRendererState, layer_id: &str) -> usize {
        let (px, _, _, _, _) = renderer.render_text_layer_software(layer_id).expect("renders");
        px.chunks(4).filter(|p| p[3] > 127).count()
    }

    fn im_fell_sc() -> Vec<u8> {
        crate::woff2::decode_woff2(include_bytes!("../tests/fixtures/IMFellDWPicaSC-latin.woff2")).expect("decodes")
    }

    fn montserrat_css2() -> Vec<u8> {
        crate::woff2::decode_woff2(include_bytes!("../tests/fixtures/Montserrat-wght-latin.woff2")).expect("decodes")
    }

    #[test]
    fn load_font_rejects_bytes_without_a_font_face() {
        let mut renderer = make_renderer();
        assert!(renderer.load_font(b"definitely not a font").is_err());
        assert!(renderer.load_font(&im_fell_sc()).is_ok());
    }

    #[test]
    fn family_request_matches_a_face_whose_name_differs_only_in_case() {
        let mut renderer = make_renderer();
        renderer.load_font(&im_fell_sc()).expect("loads");
        let stored = renderer.font_system.db().faces().last().unwrap().families[0].0.clone();
        assert_ne!(stored, "IM Fell DW Pica SC", "fixture must exercise a case mismatch");
        assert!(stored.eq_ignore_ascii_case("IM Fell DW Pica SC"));

        renderer
            .set_text_content("t", &family_props("Hello", "IM Fell DW Pica SC", 400))
            .expect("ok");
        assert_eq!(faces_used(&renderer, "t"), vec![(stored, 400)]);
    }

    #[test]
    fn a_missing_weight_snaps_to_the_nearest_face_instead_of_falling_back() {
        let mut renderer = make_renderer();
        renderer.load_font(&im_fell_sc()).expect("loads");
        renderer
            .set_text_content("t", &family_props("Hello", "IM Fell DW Pica SC", 700))
            .expect("ok");
        let used = faces_used(&renderer, "t");
        assert_eq!(used.len(), 1);
        assert!(used[0].0.eq_ignore_ascii_case("IM Fell DW Pica SC"), "{used:?}");
    }

    #[test]
    fn loading_under_a_family_alias_makes_the_catalog_name_match() {
        // css2 variable subsets are named after their default instance.
        let mut renderer = make_renderer();
        renderer.load_font_as(&montserrat_css2(), Some("Montserrat")).expect("loads");
        assert!(renderer.is_font_loaded("Montserrat"));
        renderer
            .set_text_content("t", &family_props("Hello", "Montserrat", 100))
            .expect("ok");
        assert_eq!(faces_used(&renderer, "t"), vec![("Montserrat".to_string(), 100)]);
    }

    #[test]
    fn variable_font_renders_the_requested_weight() {
        let mut renderer = make_renderer();
        renderer.load_font_as(&montserrat_css2(), Some("Montserrat")).expect("loads");

        let mut ink = Vec::new();
        for weight in [100u16, 400, 700, 900] {
            let id = format!("w{weight}");
            renderer
                .set_text_content(&id, &family_props("HAMBURGEFONTS", "Montserrat", weight))
                .expect("ok");
            assert_eq!(faces_used(&renderer, &id), vec![("Montserrat".to_string(), weight)]);
            ink.push(opaque_pixels(&mut renderer, &id));
        }
        assert!(ink.windows(2).all(|w| w[1] > w[0]), "coverage must grow with weight: {ink:?}");
    }

    /// Synthetic 1000-unit test font: ー (U+30FC) is a horizontal bar on the
    /// ideographic centre line with a `vert` alternate that is a full-height
    /// vertical stroke; 「 (U+300C) is a corner in the upper right of the em
    /// box and 。 (U+3002) a block in its lower-left quadrant, neither with a
    /// vertical alternate.
    fn vertical_forms_font() -> &'static [u8] {
        include_bytes!("../tests/fixtures/LopsyVerticalTest.ttf")
    }

    /// Ink bounding box `[left, top, right, bottom]` in layout space (the
    /// render's offset applied) of the pixels with alpha > 127.
    fn ink_box(renderer: &mut TextRendererState, layer_id: &str) -> [i32; 4] {
        let (px, w, _, ox, oy) = renderer.render_text_layer_software(layer_id).expect("renders");
        let mut b = [i32::MAX, i32::MAX, i32::MIN, i32::MIN];
        for (i, p) in px.chunks(4).enumerate() {
            if p[3] <= 127 {
                continue;
            }
            let (x, y) = ((i as u32 % w) as i32 + ox, (i as u32 / w) as i32 + oy);
            b = [b[0].min(x), b[1].min(y), b[2].max(x + 1), b[3].max(y + 1)];
        }
        assert!(b[0] < b[2], "no ink rendered");
        b
    }

    /// 100 px type in the test font, one 140 px-wide column centred on x = 70
    /// whose first row runs y = 0..100 with its baseline at y = 100.
    fn render_vertical_forms(text: &str, vertical: bool) -> [i32; 4] {
        let mut renderer = make_renderer();
        renderer
            .load_font_as(vertical_forms_font(), Some("Lopsy Vertical Test"))
            .expect("loads");
        let props = format!(
            r#"{{"text":"{text}","fontFamily":"'Lopsy Vertical Test', serif","fontSize":100,"fontWeight":400,"fontStyle":"normal","color":[0,0,0,1],"lineHeight":1.4,"letterSpacing":0,"paragraphSpacing":0,"textAlign":"left","areaWidth":null,"vertical":{vertical}}}"#
        );
        renderer.set_text_content("t", &props).expect("ok");
        ink_box(&mut renderer, "t")
    }

    #[test]
    fn vertical_long_vowel_mark_uses_the_fonts_vertical_alternate() {
        let [l, t, r, b] = render_vertical_forms("ー", false);
        assert!(r - l > 4 * (b - t), "horizontal ー is a wide bar: {:?}", [l, t, r, b]);

        let [l, t, r, b] = render_vertical_forms("ー", true);
        assert!(b - t > 4 * (r - l), "vertical ー must be a tall stroke (#1080): {:?}", [l, t, r, b]);
        assert!(((l + r) / 2 - 70).abs() <= 2, "stroke centred on the column: {l}..{r}");
    }

    #[test]
    fn vertical_bracket_without_an_alternate_turns_a_quarter_clockwise() {
        // Upright, 「 is taller than wide and starts 84 px above the baseline.
        let [l, t, r, b] = render_vertical_forms("「", false);
        assert!(b - t > r - l, "{:?}", [l, t, r, b]);
        assert!(t < 30, "{t}");

        // Turned clockwise about the em box's centre it becomes ﹁: wider than
        // tall and in the lower part of its row.
        let [l, t, r, b] = render_vertical_forms("「", true);
        assert!(r - l > b - t, "vertical 「 must lie on its side: {:?}", [l, t, r, b]);
        assert!(t > 50, "vertical 「 sits in the lower half of its row: top {t}");
    }

    #[test]
    fn vertical_full_stop_without_an_alternate_moves_to_the_upper_right() {
        let [l, t, r, b] = render_vertical_forms("。", false);
        assert!(r <= 70 && b > 90, "upright 。 sits low-left: {:?}", [l, t, r, b]);

        let [l, t, r, b] = render_vertical_forms("。", true);
        assert!(l >= 70, "vertical 。 sits right of the column centre: {:?}", [l, t, r, b]);
        assert!(b <= 60, "vertical 。 sits in the upper part of its row: {:?}", [l, t, r, b]);
    }

    #[test]
    fn vertical_latin_letters_stay_upright() {
        let mut renderer = make_renderer();
        renderer.set_text_content("h", &vertical_props("I")).expect("ok");
        let [l, t, r, b] = ink_box(&mut renderer, "h");
        assert!(b - t > 2 * (r - l), "an upright I is a tall stroke: {:?}", [l, t, r, b]);
    }

    #[test]
    fn snap_weight_picks_the_nearest_and_prefers_heavier_on_ties() {
        assert_eq!(snap_weight(700, &[400]), 400);
        assert_eq!(snap_weight(500, &[400, 600]), 600);
        assert_eq!(snap_weight(650, &[100, 900, 700]), 700);
        assert_eq!(snap_weight(300, &[]), 300);
    }

    fn aligned_props(text: &str, align: &str, letter_spacing: f64, area_width: &str) -> String {
        format!(
            r#"{{"text":"{text}","fontFamily":"sans-serif","fontSize":20,"fontWeight":400,"fontStyle":"normal","color":[0,0,0,1],"lineHeight":1.4,"letterSpacing":{letter_spacing},"paragraphSpacing":0,"textAlign":"{align}","areaWidth":{area_width}}}"#
        )
    }

    /// `(left, right)` advance extent of each visual line, top to bottom.
    fn line_extents(renderer: &mut TextRendererState, id: &str) -> Vec<(f64, f64)> {
        let mut lines: Vec<(f64, f64, f64)> = Vec::new();
        for g in renderer.get_glyph_positions(id).chunks(5) {
            let (x, top, w) = (g[0], g[1], g[2]);
            match lines.iter_mut().find(|l| l.0 == top) {
                Some(l) => {
                    l.1 = l.1.min(x);
                    l.2 = l.2.max(x + w);
                }
                None => lines.push((top, x, x + w)),
            }
        }
        lines.sort_by(|a, b| a.0.total_cmp(&b.0));
        lines.into_iter().map(|(_, l, r)| (l, r)).collect()
    }

    #[test]
    fn point_text_center_centres_every_line_on_the_anchor() {
        let mut renderer = make_renderer();
        renderer.set_text_content("c", &aligned_props("Wide first line\\nHi", "center", 0.0, "null")).expect("ok");
        let lines = line_extents(&mut renderer, "c");
        assert_eq!(lines.len(), 2);
        for (l, r) in &lines {
            assert!(((l + r) / 2.0).abs() < 0.01, "line {l}..{r} is not centred on the anchor");
        }
        assert!(lines[0].1 - lines[0].0 > (lines[1].1 - lines[1].0) * 3.0, "first line should be the wide one");
    }

    #[test]
    fn point_text_right_ends_every_line_at_the_anchor() {
        let mut renderer = make_renderer();
        renderer.set_text_content("r", &aligned_props("Wide first line\\nHi", "right", 0.0, "null")).expect("ok");
        for (l, r) in line_extents(&mut renderer, "r") {
            assert!(r.abs() < 0.01, "line {l}..{r} should end at the anchor");
            assert!(l < 0.0);
        }
    }

    #[test]
    fn point_text_left_and_justify_start_every_line_at_the_anchor() {
        let mut renderer = make_renderer();
        for align in ["left", "justify"] {
            renderer.set_text_content(align, &aligned_props("Wide first line\\nHi", align, 0.0, "null")).expect("ok");
            for (l, _) in line_extents(&mut renderer, align) {
                assert!(l.abs() < 0.01, "{align}: line should start at the anchor, starts at {l}");
            }
        }
    }

    #[test]
    fn point_text_center_stays_centred_with_letter_spacing() {
        let mut renderer = make_renderer();
        renderer.set_text_content("s", &aligned_props("Wide first line\\nHi", "center", 12.0, "null")).expect("ok");
        for (l, r) in line_extents(&mut renderer, "s") {
            assert!(((l + r) / 2.0).abs() < 0.01, "spaced line {l}..{r} is not centred");
        }
    }

    #[test]
    fn area_text_alignment_is_unchanged() {
        let mut renderer = make_renderer();
        renderer.set_text_content("a", &aligned_props("Hi", "center", 0.0, "400")).expect("ok");
        let (l, r) = line_extents(&mut renderer, "a")[0];
        assert!(((l + r) / 2.0 - 200.0).abs() < 0.5, "area text centres in its 400px box, got {l}..{r}");
    }

    #[test]
    fn point_text_caret_and_hit_test_follow_the_aligned_lines() {
        let mut renderer = make_renderer();
        renderer.set_text_content("c", &aligned_props("Wide first line\\nHi", "center", 0.0, "null")).expect("ok");
        let lines = line_extents(&mut renderer, "c");
        // Offset 16 = start of "Hi" (15 bytes + the newline).
        let caret = renderer.text_cursor_rect("c", 16).unwrap();
        assert!((caret[0] as f64 - lines[1].0).abs() < 0.01, "caret {} should sit at line 2's left edge {}", caret[0], lines[1].0);
        let end = renderer.text_cursor_rect("c", 18).unwrap();
        assert!((end[0] as f64 - lines[1].1).abs() < 0.01, "end caret should sit at line 2's right edge");
        // A click just left of the anchor on line 2 lands between "H" and "i"
        // or before "H" — never at the far end of the line as it did when the
        // line still started at the anchor.
        let hit = renderer.text_hit_position("c", (lines[1].0 + 1.0) as f32, caret[1] + 5.0).unwrap();
        assert_eq!(hit, 16);
        let rects = renderer.text_selection_rects("c", 16, 18);
        assert!((rects[0] as f64 - lines[1].0).abs() < 0.01, "selection starts at the aligned line");
    }

    #[test]
    fn point_text_empty_line_caret_sits_on_the_anchor() {
        let mut renderer = make_renderer();
        renderer.set_text_content("e", &aligned_props("Hello\\n", "right", 0.0, "null")).expect("ok");
        let caret = renderer.text_cursor_rect("e", 6).unwrap();
        assert!(caret[0].abs() < 0.01, "empty line caret should be on the anchor, got {}", caret[0]);
    }

    /// Ink centre (x) of the opaque pixels in rows `[y0, y1)`.
    fn ink_centre(pixels: &[u8], w: u32, y0: u32, y1: u32) -> f64 {
        let (mut lo, mut hi) = (u32::MAX, 0u32);
        for y in y0..y1 {
            for x in 0..w {
                if pixels[((y * w + x) * 4 + 3) as usize] > 128 {
                    lo = lo.min(x);
                    hi = hi.max(x);
                }
            }
        }
        (lo + hi) as f64 / 2.0
    }

    #[test]
    fn point_text_center_renders_lines_with_shared_ink_centre() {
        let mut renderer = make_renderer();
        renderer.set_text_content("c", &aligned_props("MMMMMMMM\\nII", "center", 0.0, "null")).expect("ok");
        let (pixels, w, h, ox, _) = renderer.render_text_layer_software("c").expect("rendered");
        let top = ink_centre(&pixels, w, 0, h / 2);
        let bottom = ink_centre(&pixels, w, h / 2, h);
        assert!((top - bottom).abs() <= 2.0, "line ink centres differ: {top} vs {bottom}");
        // The shared centre is the anchor: texture x of the anchor is -ox.
        assert!((top + ox as f64).abs() <= 2.0, "ink centre {top} is not on the anchor ({})", -ox);
    }

    fn sized_props(text: &str, font_size: f64) -> String {
        format!(
            r#"{{"text":"{text}","fontFamily":"sans-serif","fontSize":{font_size},"fontWeight":400,"fontStyle":"normal","color":[0,0,0,1],"lineHeight":1.4,"letterSpacing":0,"textAlign":"left","areaWidth":null}}"#
        )
    }

    #[test]
    fn a_900px_glyph_renders_at_that_size() {
        let mut renderer = make_renderer();
        renderer.set_text_content("big", &sized_props("H", 900.0)).expect("ok");
        let (pixels, w, h, _, _) = renderer.render_text_layer_software("big").expect("rendered");
        let (mut top, mut bottom) = (u32::MAX, 0u32);
        for y in 0..h {
            for x in 0..w {
                if pixels[((y * w + x) * 4 + 3) as usize] > 128 {
                    top = top.min(y);
                    bottom = bottom.max(y);
                }
            }
        }
        // Inter's cap height is 0.727 em: an "H" at 900 px stands ~654 px tall.
        let cap = (bottom - top + 1) as f64;
        assert!((cap - 654.0).abs() < 8.0, "900 px H should be ~654 px tall, got {cap}");
    }

    #[test]
    fn large_glyphs_are_not_kept_in_the_glyph_cache() {
        let mut renderer = make_renderer();
        renderer.set_text_content("big", &sized_props("HH", 900.0)).expect("ok");
        renderer.render_text_layer_software("big").expect("rendered");
        assert!(renderer.unhinted_cache.is_empty(), "900 px glyphs must not be cached");
        renderer.set_text_content("small", &sized_props("HH", 40.0)).expect("ok");
        renderer.render_text_layer_software("small").expect("rendered");
        assert!(!renderer.unhinted_cache.is_empty(), "small glyphs are still cached");
    }

    #[test]
    fn a_raster_wider_than_the_texture_limit_is_cropped_keeping_its_origin() {
        let mut renderer = make_renderer();
        renderer.set_text_content("t", &sized_props("Wide text", 200.0)).expect("ok");
        let (_, full_w, full_h, ox, oy) = renderer.render_text_layer_software("t").expect("rendered");
        assert!(full_w > 256);
        renderer.max_canvas_side = 256;
        renderer.set_text_content("t2", &sized_props("Wide text", 200.0)).expect("ok");
        let (pixels, w, h, ox2, oy2) = renderer.render_text_layer_software("t2").expect("rendered");
        assert_eq!((w, h), (256, full_h.min(256)));
        assert_eq!((ox2, oy2), (ox, oy), "cropping must keep the offsets callers anchor by");
        assert_eq!(pixels.len(), (w * h * 4) as usize);
    }

    /// Re-register every loaded IM Fell DW Pica SC face as `style`/`stretch`,
    /// standing in for a family whose static files declare an italic or a
    /// condensed face (Old Standard TT italic, Barlow Condensed).
    fn load_im_fell_as(renderer: &mut TextRendererState, style: Style, stretch: Stretch) {
        renderer.load_font_as(&im_fell_sc(), Some("IM Fell DW Pica SC")).expect("loads");
        let db = renderer.font_system.db_mut();
        let ids: Vec<fontdb::ID> = db
            .faces()
            .filter(|f| f.families.iter().any(|(n, _)| n == "IM Fell DW Pica SC"))
            .map(|f| f.id)
            .collect();
        for id in ids {
            let mut info = db.face(id).expect("face").clone();
            info.style = style;
            info.stretch = stretch;
            db.remove_face(id);
            db.push_face_info(info);
        }
    }

    fn styled_props(text: &str, family: &str, style: &str, weight: u16) -> String {
        family_props(text, family, weight).replace("\"fontStyle\":\"normal\"", &format!("\"fontStyle\":\"{style}\""))
    }

    /// Glyphs shaped as `.notdef` (glyph 0) — what draws a NO GLYPH box.
    fn notdef_glyphs(renderer: &TextRendererState, layer_id: &str) -> usize {
        let state = renderer.text_layers.get(layer_id).expect("layer");
        state
            .buffer
            .layout_runs()
            .flat_map(|run| run.glyphs.iter())
            .filter(|g| g.glyph_id == 0)
            .count()
    }

    #[test]
    fn glyphs_missing_from_an_upright_face_fall_back() {
        let mut renderer = make_renderer();
        load_im_fell_as(&mut renderer, Style::Normal, Stretch::Normal);
        renderer
            .set_text_content("t", &styled_props("A\u{2605}\u{2192}", "IM Fell DW Pica SC", "normal", 400))
            .expect("ok");
        assert_eq!(notdef_glyphs(&renderer, "t"), 0);
    }

    #[test]
    fn glyphs_missing_from_an_italic_face_fall_back_upright() {
        let mut renderer = make_renderer();
        load_im_fell_as(&mut renderer, Style::Italic, Stretch::Normal);
        for weight in [400u16, 700] {
            let id = format!("i{weight}");
            renderer
                .set_text_content(&id, &styled_props("A\u{2605}\u{2192}", "IM Fell DW Pica SC", "italic", weight))
                .expect("ok");
            assert_eq!(notdef_glyphs(&renderer, &id), 0, "weight {weight}");
            let used = faces_used(&renderer, &id);
            assert!(used[0].0.eq_ignore_ascii_case("IM Fell DW Pica SC"), "A keeps the family: {used:?}");
            assert!(used.len() > 1, "the star and arrow come from the fallback face: {used:?}");
        }
    }

    #[test]
    fn glyphs_missing_from_a_condensed_face_fall_back() {
        let mut renderer = make_renderer();
        load_im_fell_as(&mut renderer, Style::Normal, Stretch::Condensed);
        renderer
            .set_text_content("c", &styled_props("A\u{2153}\u{2605}\u{2192}", "IM Fell DW Pica SC", "normal", 400))
            .expect("ok");
        assert_eq!(notdef_glyphs(&renderer, "c"), 0);
    }

    /// Load a css2 latin subset and return the (style, stretch) it declares.
    fn load_css2_fixture(renderer: &mut TextRendererState, woff2: &[u8], family: &str) -> (Style, Stretch) {
        let ttf = crate::woff2::decode_woff2(woff2).expect("decodes");
        renderer.load_font_as(&ttf, Some(family)).expect("loads");
        let face = renderer.family_faces(family).next().expect("face");
        (face.style, face.stretch)
    }

    #[test]
    fn im_fell_english_italic_falls_back_for_symbols() {
        let mut renderer = make_renderer();
        let attrs = load_css2_fixture(
            &mut renderer,
            include_bytes!("../tests/fixtures/IMFellEnglish-Italic-latin.woff2"),
            "IM Fell English",
        );
        assert_eq!(attrs, (Style::Italic, Stretch::Normal), "fixture must be an italic face");
        renderer
            .set_text_content("t", &styled_props("Fell \u{2605}\u{2192}", "IM Fell English", "italic", 400))
            .expect("ok");
        assert_eq!(notdef_glyphs(&renderer, "t"), 0);
    }

    #[test]
    fn barlow_condensed_falls_back_for_symbols() {
        let mut renderer = make_renderer();
        let attrs = load_css2_fixture(
            &mut renderer,
            include_bytes!("../tests/fixtures/BarlowCondensed-latin.woff2"),
            "Barlow Condensed",
        );
        assert_eq!(attrs, (Style::Normal, Stretch::Condensed), "fixture must be a condensed face");
        renderer
            .set_text_content("t", &styled_props("Barlow \u{2153}\u{2605}\u{2192}", "Barlow Condensed", "normal", 400))
            .expect("ok");
        assert_eq!(notdef_glyphs(&renderer, "t"), 0);
    }

    #[test]
    fn italic_text_in_a_family_that_is_not_loaded_yet_still_shapes() {
        let mut renderer = make_renderer();
        renderer
            .set_text_content("u", &styled_props("Hi \u{2605}", "Not Loaded Yet", "italic", 400))
            .expect("ok");
        assert_eq!(notdef_glyphs(&renderer, "u"), 0);
    }

    fn span_props(text: &str, spans: &str, underline: bool) -> String {
        format!(
            r#"{{"text":"{text}","fontFamily":"sans-serif","fontSize":40,"fontWeight":400,"fontStyle":"normal","color":[0,0,0,1],"lineHeight":1.4,"letterSpacing":0,"textAlign":"left","areaWidth":null,"underline":{underline},"colorSpans":{spans}}}"#
        )
    }

    /// Column ranges `(red, blue)` of strongly red / strongly blue opaque pixels.
    fn red_and_blue_columns(pixels: &[u8], w: u32) -> (Vec<u32>, Vec<u32>) {
        let mut red = Vec::new();
        let mut blue = Vec::new();
        for (i, px) in pixels.chunks_exact(4).enumerate() {
            if px[3] < 200 { continue; }
            let x = i as u32 % w;
            if px[0] > 200 && px[2] < 60 { red.push(x); }
            if px[2] > 200 && px[0] < 60 { blue.push(x); }
        }
        (red, blue)
    }

    #[test]
    fn color_spans_paint_their_range_and_leave_the_rest_in_the_base_color() {
        let mut renderer = make_renderer();
        renderer
            .set_text_content("c", &span_props("HHHH", "[[2,4,1,0,0,1]]", false))
            .expect("ok");
        let (pixels, w, _, _, _) = renderer.render_text_layer_software("c").expect("rendered");
        let (red, _) = red_and_blue_columns(&pixels, w);
        assert!(!red.is_empty(), "the spanned glyphs render red");
        let black_cols: Vec<u32> = pixels
            .chunks_exact(4)
            .enumerate()
            .filter(|(_, p)| p[3] > 200 && p[0] < 40 && p[1] < 40 && p[2] < 40)
            .map(|(i, _)| i as u32 % w)
            .collect();
        assert!(!black_cols.is_empty(), "the unspanned glyphs keep the base colour");
        let max_black = *black_cols.iter().max().unwrap();
        let min_red = *red.iter().min().unwrap();
        assert!(max_black < min_red, "black glyphs (HH) sit left of the red ones");
    }

    #[test]
    fn underline_takes_each_stretch_colour() {
        let mut renderer = make_renderer();
        renderer
            .set_text_content("u", &span_props("HHHH", "[[0,2,1,0,0,1],[2,4,0,0,1,1]]", true))
            .expect("ok");
        let (pixels, w, h, _, _) = renderer.render_text_layer_software("u").expect("rendered");
        // The underline is the lowest opaque row band; scan the bottom rows.
        let mut found_red = false;
        let mut found_blue = false;
        for y in (0..h).rev().take(12) {
            for x in 0..w {
                let i = ((y * w + x) * 4) as usize;
                let p = &pixels[i..i + 4];
                if p[3] < 200 { continue; }
                if p[0] > 200 && p[2] < 60 { found_red = true; }
                if p[2] > 200 && p[0] < 60 { found_blue = true; }
            }
        }
        assert!(found_red && found_blue, "underline has a red and a blue stretch");
    }
}
