//! wasm-bindgen exports for `commands::text`. Each converts its arguments
//! and calls the one function of the same name there.

use wasm_bindgen::prelude::*;

use crate::Engine;

#[wasm_bindgen(js_name = "loadFontData")]
pub fn load_font_data(engine: &mut Engine, font_data: &[u8]) -> Result<(), JsError> {
    lopsy_engine::commands::text::load_font_data(&mut engine.inner, font_data).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "loadFontDataForFamily")]
pub fn load_font_data_for_family(engine: &mut Engine, font_data: &[u8], family: &str) -> Result<(), JsError> {
    lopsy_engine::commands::text::load_font_data_for_family(&mut engine.inner, font_data, family).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "setTextLayerContent")]
pub fn set_text_layer_content(engine: &mut Engine, layer_id: &str, props_json: &str) -> Result<(), JsError> {
    lopsy_engine::commands::text::set_text_layer_content(&mut engine.inner, layer_id, props_json).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "renderTextLayer")]
pub fn render_text_layer(engine: &mut Engine, layer_id: &str) -> Vec<f64> {
    lopsy_engine::commands::text::render_text_layer(&mut engine.inner, layer_id)
}

#[wasm_bindgen(js_name = "textRasterBounds")]
pub fn text_raster_bounds(engine: &mut Engine, layer_id: &str) -> Vec<f64> {
    lopsy_engine::commands::text::text_raster_bounds(&mut engine.inner, layer_id)
}

#[wasm_bindgen(js_name = "getRenderedTextPixels")]
pub fn get_rendered_text_pixels(engine: &mut Engine, layer_id: &str) -> Vec<u8> {
    lopsy_engine::commands::text::get_rendered_text_pixels(&mut engine.inner, layer_id)
}

#[wasm_bindgen(js_name = "renderTextLayerToTexture")]
pub fn render_text_layer_to_texture(
    engine: &mut Engine,
    layer_id: &str,
    anchor_x: f64,
    anchor_y: f64,
) -> Vec<f64> {
    lopsy_engine::commands::text::render_text_layer_to_texture(&mut engine.inner, layer_id, anchor_x, anchor_y)
}

#[wasm_bindgen(js_name = "renderTextLayerTransformed")]
#[allow(clippy::too_many_arguments)]
pub fn render_text_layer_transformed(
    engine: &mut Engine,
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
    lopsy_engine::commands::text::render_text_layer_transformed(&mut engine.inner, layer_id, raster_props_json, scale, a, b, c, d, anchor_x, anchor_y)
}

#[wasm_bindgen(js_name = "textLayoutBounds")]
pub fn text_layout_bounds(engine: &mut Engine, layer_id: &str) -> Vec<f64> {
    lopsy_engine::commands::text::text_layout_bounds(&mut engine.inner, layer_id)
}

#[wasm_bindgen(js_name = "getGlyphPositions")]
pub fn get_glyph_positions(engine: &mut Engine, layer_id: &str) -> Vec<f64> {
    lopsy_engine::commands::text::get_glyph_positions(&mut engine.inner, layer_id)
}

#[wasm_bindgen(js_name = "textHitPosition")]
pub fn text_hit_position(engine: &mut Engine, layer_id: &str, x: f64, y: f64) -> i32 {
    lopsy_engine::commands::text::text_hit_position(&mut engine.inner, layer_id, x, y)
}

#[wasm_bindgen(js_name = "textCursorRect")]
pub fn text_cursor_rect(engine: &mut Engine, layer_id: &str, offset: u32) -> Vec<f64> {
    lopsy_engine::commands::text::text_cursor_rect(&mut engine.inner, layer_id, offset)
}

#[wasm_bindgen(js_name = "textSelectionRects")]
pub fn text_selection_rects(engine: &mut Engine, layer_id: &str, start: u32, end: u32) -> Vec<f64> {
    lopsy_engine::commands::text::text_selection_rects(&mut engine.inner, layer_id, start, end)
}

#[wasm_bindgen(js_name = "removeTextLayerState")]
pub fn remove_text_layer_state(engine: &mut Engine, layer_id: &str) {
    lopsy_engine::commands::text::remove_text_layer_state(&mut engine.inner, layer_id)
}

#[wasm_bindgen(js_name = "isFontLoaded")]
pub fn is_font_loaded(engine: &Engine, family: &str) -> bool {
    lopsy_engine::commands::text::is_font_loaded(&engine.inner, family)
}
