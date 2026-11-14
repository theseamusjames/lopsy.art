//! wasm-bindgen exports for `commands::overlay`. Each converts its arguments
//! and calls the one function of the same name there.

use wasm_bindgen::prelude::*;

use crate::Engine;

#[wasm_bindgen(js_name = "setGridVisible")]
pub fn set_grid_visible(engine: &mut Engine, visible: bool) {
    crate::commands::overlay::set_grid_visible(&mut engine.inner, visible)
}

#[wasm_bindgen(js_name = "setGridSize")]
pub fn set_grid_size(engine: &mut Engine, size: f32) {
    crate::commands::overlay::set_grid_size(&mut engine.inner, size)
}

#[wasm_bindgen(js_name = "setTransformOverlay")]
pub fn set_transform_overlay(engine: &mut Engine, bounds_json: Option<String>) {
    crate::commands::overlay::set_transform_overlay(&mut engine.inner, bounds_json)
}

#[wasm_bindgen(js_name = "setGradientGuide")]
pub fn set_gradient_guide(engine: &mut Engine, start_x: f64, start_y: f64, end_x: f64, end_y: f64) {
    crate::commands::overlay::set_gradient_guide(&mut engine.inner, start_x, start_y, end_x, end_y)
}

#[wasm_bindgen(js_name = "clearGradientGuide")]
pub fn clear_gradient_guide(engine: &mut Engine) {
    crate::commands::overlay::clear_gradient_guide(&mut engine.inner)
}

#[wasm_bindgen(js_name = "setPathOverlay")]
pub fn set_path_overlay(engine: &mut Engine, anchors_json: Option<String>) {
    crate::commands::overlay::set_path_overlay(&mut engine.inner, anchors_json)
}

#[wasm_bindgen(js_name = "setLassoPreview")]
pub fn set_lasso_preview(engine: &mut Engine, points_flat: Option<Vec<f64>>) {
    crate::commands::overlay::set_lasso_preview(&mut engine.inner, points_flat)
}

#[wasm_bindgen(js_name = "setCropPreview")]
pub fn set_crop_preview(engine: &mut Engine, x: f64, y: f64, w: f64, h: f64) {
    crate::commands::overlay::set_crop_preview(&mut engine.inner, x, y, w, h)
}

#[wasm_bindgen(js_name = "clearCropPreview")]
pub fn clear_crop_preview(engine: &mut Engine) {
    crate::commands::overlay::clear_crop_preview(&mut engine.inner)
}

#[wasm_bindgen(js_name = "setBrushCursor")]
pub fn set_brush_cursor(engine: &mut Engine, x: f64, y: f64, radius: f64) {
    crate::commands::overlay::set_brush_cursor(&mut engine.inner, x, y, radius)
}

#[wasm_bindgen(js_name = "clearBrushCursor")]
pub fn clear_brush_cursor(engine: &mut Engine) {
    crate::commands::overlay::clear_brush_cursor(&mut engine.inner)
}

#[wasm_bindgen(js_name = "setStampSourcePreview")]
pub fn set_stamp_source_preview(
    engine: &mut Engine,
    layer_id: &str,
    cursor_x: f64,
    cursor_y: f64,
    source_x: f64,
    source_y: f64,
    radius: f64,
) {
    crate::commands::overlay::set_stamp_source_preview(&mut engine.inner, layer_id, cursor_x, cursor_y, source_x, source_y, radius)
}

#[wasm_bindgen(js_name = "clearStampSourcePreview")]
pub fn clear_stamp_source_preview(engine: &mut Engine) {
    crate::commands::overlay::clear_stamp_source_preview(&mut engine.inner)
}

#[wasm_bindgen(js_name = "setRulersVisible")]
pub fn set_rulers_visible(engine: &mut Engine, visible: bool) {
    crate::commands::overlay::set_rulers_visible(&mut engine.inner, visible)
}

#[wasm_bindgen(js_name = "setSeamlessPattern")]
pub fn set_seamless_pattern(engine: &mut Engine, enabled: bool, dim: bool, wrap: bool) {
    crate::commands::overlay::set_seamless_pattern(&mut engine.inner, enabled, dim, wrap)
}

#[wasm_bindgen(js_name = "setChannelMask")]
pub fn set_channel_mask(engine: &mut Engine, r: f32, g: f32, b: f32, a: f32) {
    crate::commands::overlay::set_channel_mask(&mut engine.inner, r, g, b, a)
}
