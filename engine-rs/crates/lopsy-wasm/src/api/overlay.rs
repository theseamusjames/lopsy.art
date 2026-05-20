//! Viewport- and overlay-side UI state: grid, rulers, the path/lasso/crop
//! previews, gradient guide, brush cursor, and transform overlay.

use wasm_bindgen::prelude::*;

use crate::{Engine, overlay_renderer};

// ============================================================
// Tool UI Overlays
// ============================================================

#[wasm_bindgen(js_name = "setGridVisible")]
pub fn set_grid_visible(engine: &mut Engine, visible: bool) {
    engine.inner.grid_visible = visible;
    engine.inner.needs_recomposite = true;
}

#[wasm_bindgen(js_name = "setGridSize")]
pub fn set_grid_size(engine: &mut Engine, size: f32) {
    engine.inner.grid_size = size;
    engine.inner.needs_recomposite = true;
}

#[wasm_bindgen(js_name = "setTransformOverlay")]
pub fn set_transform_overlay(engine: &mut Engine, bounds_json: Option<String>) {
    overlay_renderer::set_transform_overlay(&mut engine.inner, bounds_json);
}

#[wasm_bindgen(js_name = "setGradientGuide")]
pub fn set_gradient_guide(
    engine: &mut Engine,
    start_x: f64, start_y: f64, end_x: f64, end_y: f64,
) {
    overlay_renderer::set_gradient_guide(&mut engine.inner, start_x, start_y, end_x, end_y);
}

#[wasm_bindgen(js_name = "clearGradientGuide")]
pub fn clear_gradient_guide(engine: &mut Engine) {
    overlay_renderer::clear_gradient_guide(&mut engine.inner);
}

#[wasm_bindgen(js_name = "setPathOverlay")]
pub fn set_path_overlay(engine: &mut Engine, anchors_json: Option<String>) {
    overlay_renderer::set_path_overlay(&mut engine.inner, anchors_json);
}

#[wasm_bindgen(js_name = "setLassoPreview")]
pub fn set_lasso_preview(engine: &mut Engine, points_flat: Option<Vec<f64>>) {
    overlay_renderer::set_lasso_preview(&mut engine.inner, points_flat);
}

#[wasm_bindgen(js_name = "setCropPreview")]
pub fn set_crop_preview(engine: &mut Engine, x: f64, y: f64, w: f64, h: f64) {
    overlay_renderer::set_crop_preview(&mut engine.inner, x, y, w, h);
}

#[wasm_bindgen(js_name = "clearCropPreview")]
pub fn clear_crop_preview(engine: &mut Engine) {
    overlay_renderer::clear_crop_preview(&mut engine.inner);
}

#[wasm_bindgen(js_name = "setBrushCursor")]
pub fn set_brush_cursor(engine: &mut Engine, x: f64, y: f64, radius: f64) {
    overlay_renderer::set_brush_cursor(&mut engine.inner, x, y, radius);
}

#[wasm_bindgen(js_name = "clearBrushCursor")]
pub fn clear_brush_cursor(engine: &mut Engine) {
    overlay_renderer::clear_brush_cursor(&mut engine.inner);
}

#[wasm_bindgen(js_name = "setRulersVisible")]
pub fn set_rulers_visible(engine: &mut Engine, visible: bool) {
    engine.inner.rulers_visible = visible;
    engine.inner.needs_recomposite = true;
}

#[wasm_bindgen(js_name = "setSeamlessPattern")]
pub fn set_seamless_pattern(engine: &mut Engine, enabled: bool, dim: bool) {
    engine.inner.seamless_pattern = enabled;
    engine.inner.seamless_dim = dim;
    engine.inner.needs_recomposite = true;
}

#[wasm_bindgen(js_name = "setChannelMask")]
pub fn set_channel_mask(engine: &mut Engine, r: f32, g: f32, b: f32, a: f32) {
    engine.inner.channel_mask = [r, g, b, a];
    engine.inner.needs_recomposite = true;
}

