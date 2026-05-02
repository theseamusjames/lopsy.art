//! WASM API surface for native text rendering.

use wasm_bindgen::prelude::*;
use crate::Engine;
use crate::text_gpu::TextRendererState;

fn ensure_text_renderer(engine: &mut Engine) -> &mut TextRendererState {
    if engine.inner.text_renderer.is_none() {
        engine.inner.text_renderer = Some(TextRendererState::new());
    }
    engine.inner.text_renderer.as_mut().unwrap()
}

/// Load raw font bytes into the engine's fontdb.
#[wasm_bindgen(js_name = "loadFontData")]
pub fn load_font_data(engine: &mut Engine, font_data: &[u8]) -> Result<(), JsError> {
    let tr = ensure_text_renderer(engine);
    tr.load_font(font_data).map_err(|e| JsError::new(&e))
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

/// Render the text layer to its GPU texture.
/// Phase 1 stub — currently a no-op. Phase 3 implements the full pipeline.
#[wasm_bindgen(js_name = "renderTextLayer")]
pub fn render_text_layer(engine: &mut Engine, layer_id: &str) -> Result<(), JsError> {
    if engine.inner.text_renderer.is_none() {
        return Err(JsError::new(
            "text renderer not initialized — call loadFontData first",
        ));
    }
    let _ = layer_id;
    Ok(())
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
