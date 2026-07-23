//! WASM API surface for native text rendering.

use wasm_bindgen::prelude::*;
use crate::Engine;
use crate::text_gpu::TextRendererState;

fn ensure_text_renderer(engine: &mut Engine) -> &mut TextRendererState {
    engine.inner.text_renderer.get_or_insert_with(TextRendererState::new)
}

/// Load raw font bytes into the engine's fontdb.
/// Accepts TTF, OTF, or WOFF2 — WOFF2 is decoded to SFNT before loading.
#[wasm_bindgen(js_name = "loadFontData")]
pub fn load_font_data(engine: &mut Engine, font_data: &[u8]) -> Result<(), JsError> {
    let tr = ensure_text_renderer(engine);
    if crate::woff2::is_woff2(font_data) {
        match crate::woff2::decode_woff2(font_data) {
            Some(sfnt) => tr.load_font(&sfnt).map_err(|e| JsError::new(&e)),
            None => Err(JsError::new("WOFF2 decode failed")),
        }
    } else {
        tr.load_font(font_data).map_err(|e| JsError::new(&e))
    }
}

/// Set or update the text content and properties for a text layer.
#[wasm_bindgen(js_name = "setTextLayerContent")]
pub fn set_text_layer_content(
    engine: &mut Engine,
    layer_id: &str,
    props_json: &str,
) -> Result<(), JsError> {
    let tr = ensure_text_renderer(engine);
    tr.set_text_content(layer_id, props_json)
        .map_err(|e| JsError::new(&e))
}

/// Rasterize the text layer via swash and cache the RGBA bytes.
/// Returns [width, height, offset_x, offset_y] if content was rendered,
/// or an empty array if the layer has no visible glyphs.
/// Callers should follow up with getRenderedTextPixels() and uploadLayerPixels().
#[wasm_bindgen(js_name = "renderTextLayer")]
pub fn render_text_layer(engine: &mut Engine, layer_id: &str) -> Vec<f64> {
    let tr = match engine.inner.text_renderer.as_mut() {
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

/// Return the cached RGBA pixel bytes from the last renderTextLayer call.
/// Returns an empty array if no pixels are cached.
#[wasm_bindgen(js_name = "getRenderedTextPixels")]
pub fn get_rendered_text_pixels(engine: &mut Engine, layer_id: &str) -> Vec<u8> {
    match engine.inner.text_renderer.as_ref() {
        Some(tr) => tr.get_rendered_pixels(layer_id),
        None => vec![],
    }
}

/// Returns per-glyph positions as a flat f64 array of [x, y, w, h, global_offset]
/// tuples, where `global_offset` is the UTF-8 byte offset of the glyph's cluster
/// in the whole text string.
#[wasm_bindgen(js_name = "getGlyphPositions")]
pub fn get_glyph_positions(engine: &mut Engine, layer_id: &str) -> Vec<f64> {
    let tr = ensure_text_renderer(engine);
    tr.get_glyph_positions(layer_id)
}

/// Map a layout-space point to the nearest global UTF-8 byte offset in the text.
/// Returns -1 if the layer has no text state.
#[wasm_bindgen(js_name = "textHitPosition")]
pub fn text_hit_position(engine: &mut Engine, layer_id: &str, x: f64, y: f64) -> i32 {
    match &engine.inner.text_renderer {
        Some(tr) => tr
            .text_hit_position(layer_id, x as f32, y as f32)
            .map(|p| p as i32)
            .unwrap_or(-1),
        None => -1,
    }
}

/// Layout-space caret rectangle `[x, top, height]` for a global UTF-8 byte
/// offset. Returns an empty array if the layer has no text state.
#[wasm_bindgen(js_name = "textCursorRect")]
pub fn text_cursor_rect(engine: &mut Engine, layer_id: &str, offset: u32) -> Vec<f64> {
    match &engine.inner.text_renderer {
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
#[wasm_bindgen(js_name = "textSelectionRects")]
pub fn text_selection_rects(
    engine: &mut Engine,
    layer_id: &str,
    start: u32,
    end: u32,
) -> Vec<f64> {
    match &engine.inner.text_renderer {
        Some(tr) => tr
            .text_selection_rects(layer_id, start as usize, end as usize)
            .into_iter()
            .map(|v| v as f64)
            .collect(),
        None => vec![],
    }
}

/// Remove all engine state for a deleted text layer.
#[wasm_bindgen(js_name = "removeTextLayerState")]
pub fn remove_text_layer_state(engine: &mut Engine, layer_id: &str) {
    if let Some(tr) = engine.inner.text_renderer.as_mut() {
        tr.remove_text_layer(layer_id);
    }
}

/// Returns true if a font with the given family name is loaded in the engine.
#[wasm_bindgen(js_name = "isFontLoaded")]
pub fn is_font_loaded(engine: &Engine, family: &str) -> bool {
    match &engine.inner.text_renderer {
        Some(tr) => tr.is_font_loaded(family),
        None => false,
    }
}
