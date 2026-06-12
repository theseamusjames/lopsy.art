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

/// Measure the bounding box. Returns [x, y, width, height] as a flat f64 array.
#[wasm_bindgen(js_name = "measureTextBounds")]
pub fn measure_text_bounds(engine: &mut Engine, layer_id: &str) -> Vec<f64> {
    let tr = ensure_text_renderer(engine);
    tr.measure_text_bounds(layer_id).to_vec()
}

/// Returns per-glyph positions as a flat f64 array of [x, y, w, h, cluster]... tuples.
#[wasm_bindgen(js_name = "getGlyphPositions")]
pub fn get_glyph_positions(engine: &mut Engine, layer_id: &str) -> Vec<f64> {
    let tr = ensure_text_renderer(engine);
    tr.get_glyph_positions(layer_id)
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
