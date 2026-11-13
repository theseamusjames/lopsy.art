//! WASM API surface for native text rendering.

use crate::engine::EngineInner;
use crate::layer_manager;
use crate::text_gpu::{raster_key, TextRendererState};
use crate::text_transform_gpu::{render_text_raster_transformed, TextRaster};
use lopsy_core::text_transform::{TextMatrix, MAX_TEXT_RASTER_EDGE};

fn ensure_text_renderer(engine: &mut EngineInner) -> &mut TextRendererState {
    let max_side = engine.texture_pool.max_size();
    let tr = engine.text_renderer.get_or_insert_with(TextRendererState::new);
    tr.max_canvas_side = max_side;
    tr
}

/// Load raw font bytes into the engine's fontdb.
/// Accepts TTF, OTF, or WOFF2 — WOFF2 is decoded to SFNT before loading.
/// Errors when the bytes hold no parseable font face.
pub fn load_font_data(engine: &mut EngineInner, font_data: &[u8]) -> Result<(), String> {
    load_font_bytes(engine, font_data, None)
}

/// Like `loadFontData`, but also registers every loaded face under `family`
/// — the catalog name text layers request — whatever its name table says.
pub fn load_font_data_for_family(engine: &mut EngineInner, font_data: &[u8], family: &str) -> Result<(), String> {
    load_font_bytes(engine, font_data, Some(family))
}

fn load_font_bytes(engine: &mut EngineInner, font_data: &[u8], family: Option<&str>) -> Result<(), String> {
    let tr = ensure_text_renderer(engine);
    let decoded;
    let sfnt = if crate::woff2::is_woff2(font_data) {
        decoded = crate::woff2::decode_woff2(font_data).ok_or_else(|| "WOFF2 decode failed".to_string())?;
        decoded.as_slice()
    } else {
        font_data
    };
    tr.load_font_as(sfnt, family)
}

/// Set or update the text content and properties for a text layer.
pub fn set_text_layer_content(
    engine: &mut EngineInner,
    layer_id: &str,
    props_json: &str,
) -> Result<(), String> {
    let tr = ensure_text_renderer(engine);
    tr.set_text_content(layer_id, props_json)
        
}

/// Rasterize the text layer via swash and cache the RGBA bytes.
/// Returns [width, height, offset_x, offset_y] if content was rendered,
/// or an empty array if the layer has no visible glyphs.
/// Callers should follow up with getRenderedTextPixels() and uploadLayerPixels().
pub fn render_text_layer(engine: &mut EngineInner, layer_id: &str) -> Vec<f64> {
    let tr = match engine.text_renderer.as_mut() {
        Some(t) => t,
        None => return vec![],
    };
    match tr.render_text_layer_software(layer_id) {
        Some((pixels, w, h, ox, oy)) => {
            if let Some(state) = tr.text_layers.get_mut(layer_id) {
                state.rendered_pixels = Some(pixels);
            }
            vec![w as f64, h as f64, ox as f64, oy as f64]
        }
        None => vec![],
    }
}

/// The `[width, height, offset_x, offset_y]` that `renderTextLayer` would
/// return, measured without compositing the raster or replacing the cached
/// pixels. Empty when the layer has no visible glyphs.
pub fn text_raster_bounds(engine: &mut EngineInner, layer_id: &str) -> Vec<f64> {
    let tr = match engine.text_renderer.as_mut() {
        Some(t) => t,
        None => return vec![],
    };
    match tr.measure_text_raster(layer_id) {
        Some((w, h, ox, oy)) => vec![w as f64, h as f64, ox as f64, oy as f64],
        None => vec![],
    }
}

/// Return the cached RGBA pixel bytes from the last renderTextLayer call.
/// Returns an empty array if no pixels are cached.
pub fn get_rendered_text_pixels(engine: &mut EngineInner, layer_id: &str) -> Vec<u8> {
    match engine.text_renderer.as_ref() {
        Some(tr) => tr.get_rendered_pixels(layer_id),
        None => vec![],
    }
}

/// Rasterize the text layer and upload the RGBA bytes to the layer's GPU
/// texture in a single WASM call, avoiding the JS-side round trip that
/// `renderTextLayer` + `getRenderedTextPixels` + `uploadLayerPixels` used
/// to move the pixels through (#757). The texture is placed at document
/// space (`anchor_x + offset_x`, `anchor_y + offset_y`) where `offset_x`
/// / `offset_y` come from the layer's rendered geometry.
///
/// Returns `[width, height, offset_x, offset_y]` on success (bounds in
/// texture pixels; `offset_x` / `offset_y` from the anchor to the texture
/// top-left), or an empty array if the layer has no visible glyphs or is
/// unknown.
pub fn render_text_layer_to_texture(
    engine: &mut EngineInner,
    layer_id: &str,
    anchor_x: f64,
    anchor_y: f64,
) -> Vec<f64> {
    let tr = match engine.text_renderer.as_mut() {
        Some(t) => t,
        None => return vec![],
    };
    let (pixels, width, height, offset_x, offset_y) = match tr.render_text_layer_software(layer_id) {
        Some(v) => v,
        None => return vec![],
    };
    let x = (anchor_x + offset_x as f64).round() as i32;
    let y = (anchor_y + offset_y as f64).round() as i32;
    let uploaded = layer_manager::upload_pixels(&mut *engine, layer_id, &pixels, width, height, x, y).is_ok();
    // Keep the cache in sync with the render path so callers that still
    // reach for `getRenderedTextPixels` (or a future re-anchor without a
    // re-render) see the same bytes. Moved after the upload rather than
    // cloned: at large font sizes the raster runs to hundreds of MB.
    if let Some(state) = engine.text_renderer.as_mut().and_then(|t| t.text_layers.get_mut(layer_id)) {
        state.rendered_pixels = Some(pixels);
    }
    if !uploaded {
        return vec![];
    }
    vec![width as f64, height as f64, offset_x as f64, offset_y as f64]
}

/// Rasterize a transformed text layer and place it in the layer's texture.
///
/// `raster_props_json` holds the layer's props with every length multiplied
/// by `scale`, so the upright raster is at least as dense as the output and
/// the resample only ever shrinks it. The raster is then mapped into the
/// document by `doc = [a c; b d] · p + anchor` (`p` in unscaled layout space).
///
/// Returns `[width, height, x, y]` — the texture size and its document
/// top-left — or an empty array when there is nothing to draw or the
/// transform is degenerate.
#[allow(clippy::too_many_arguments)]
pub fn render_text_layer_transformed(
    engine: &mut EngineInner,
    layer_id: &str,
    raster_props_json: &str,
    scale: f64,
    a: f64,
    b: f64,
    c: f64,
    d: f64,
    anchor_x: f64,
    anchor_y: f64,
) -> Vec<f64> {
    let key = raster_key(layer_id);
    let tr = ensure_text_renderer(engine);
    if tr.set_text_content(&key, raster_props_json).is_err() {
        return vec![];
    }
    let (pixels, width, height, offset_x, offset_y) = match tr.render_text_layer_software(&key) {
        Some(v) => v,
        None => return vec![],
    };
    if width > MAX_TEXT_RASTER_EDGE || height > MAX_TEXT_RASTER_EDGE {
        return vec![];
    }
    let raster = TextRaster { pixels: &pixels, width, height, offset_x, offset_y, scale };
    let m = TextMatrix { a, b, c, d };
    match render_text_raster_transformed(&mut *engine, layer_id, &raster, &m, (anchor_x, anchor_y)) {
        Ok(rect) => vec![rect.width as f64, rect.height as f64, rect.x as f64, rect.y as f64],
        Err(_) => vec![],
    }
}

/// Layout box of a text layer's current content, `[x, y, width, height]`
/// relative to its anchor: the union of every line box that holds a glyph.
/// All zeros when the layer is unknown or empty.
pub fn text_layout_bounds(engine: &mut EngineInner, layer_id: &str) -> Vec<f64> {
    match engine.text_renderer.as_mut() {
        Some(tr) => tr.measure_text_bounds(layer_id).to_vec(),
        None => vec![0.0, 0.0, 0.0, 0.0],
    }
}

/// Returns per-glyph positions as a flat f64 array of [x, y, w, h, global_offset]
/// tuples, where `global_offset` is the UTF-8 byte offset of the glyph's cluster
/// in the whole text string.
pub fn get_glyph_positions(engine: &mut EngineInner, layer_id: &str) -> Vec<f64> {
    let tr = ensure_text_renderer(engine);
    tr.get_glyph_positions(layer_id)
}

/// Map a layout-space point to the nearest global UTF-8 byte offset in the text.
/// Returns -1 if the layer has no text state.
pub fn text_hit_position(engine: &mut EngineInner, layer_id: &str, x: f64, y: f64) -> i32 {
    match &engine.text_renderer {
        Some(tr) => tr
            .text_hit_position(layer_id, x as f32, y as f32)
            .map(|p| p as i32)
            .unwrap_or(-1),
        None => -1,
    }
}

/// Layout-space caret rectangle `[x, top, height]` for a global UTF-8 byte
/// offset. Returns an empty array if the layer has no text state.
pub fn text_cursor_rect(engine: &mut EngineInner, layer_id: &str, offset: u32) -> Vec<f64> {
    match &engine.text_renderer {
        Some(tr) => match tr.text_cursor_rect(layer_id, offset as usize) {
            Some(r) => vec![r[0] as f64, r[1] as f64, r[2] as f64],
            None => vec![],
        },
        None => vec![],
    }
}

/// Selection highlight rectangles as a flat array of `[x, top, w, height, ...]`,
/// one rect per visual line the `[start, end)` byte range covers. Offsets are
/// global UTF-8 byte offsets.
pub fn text_selection_rects(
    engine: &mut EngineInner,
    layer_id: &str,
    start: u32,
    end: u32,
) -> Vec<f64> {
    match &engine.text_renderer {
        Some(tr) => tr
            .text_selection_rects(layer_id, start as usize, end as usize)
            .into_iter()
            .map(|v| v as f64)
            .collect(),
        None => vec![],
    }
}

/// Remove all engine state for a deleted text layer.
pub fn remove_text_layer_state(engine: &mut EngineInner, layer_id: &str) {
    if let Some(tr) = engine.text_renderer.as_mut() {
        tr.remove_text_layer(layer_id);
    }
}

/// Returns true if a font with the given family name is loaded in the engine.
pub fn is_font_loaded(engine: &EngineInner, family: &str) -> bool {
    match &engine.text_renderer {
        Some(tr) => tr.is_font_loaded(family),
        None => false,
    }
}
