//! wasm-bindgen exports for `commands::drawing`. Each converts its arguments
//! and calls the one function of the same name there.

use wasm_bindgen::prelude::*;

use crate::Engine;

#[wasm_bindgen(js_name = "renderLinearGradient")]
pub fn render_linear_gradient(
    engine: &mut Engine,
    layer_id: &str,
    start_x: f64,
    start_y: f64,
    end_x: f64,
    end_y: f64,
    stops_json: &str,
) {
    crate::commands::drawing::render_linear_gradient(&mut engine.inner, layer_id, start_x, start_y, end_x, end_y, stops_json)
}

#[wasm_bindgen(js_name = "renderRadialGradient")]
pub fn render_radial_gradient(
    engine: &mut Engine,
    layer_id: &str,
    cx: f64,
    cy: f64,
    radius: f64,
    stops_json: &str,
) {
    crate::commands::drawing::render_radial_gradient(&mut engine.inner, layer_id, cx, cy, radius, stops_json)
}

#[wasm_bindgen(js_name = "saveGradientPreview")]
pub fn save_gradient_preview(engine: &mut Engine, layer_id: &str) {
    crate::commands::drawing::save_gradient_preview(&mut engine.inner, layer_id)
}

#[wasm_bindgen(js_name = "endGradientPreview")]
pub fn end_gradient_preview(engine: &mut Engine) {
    crate::commands::drawing::end_gradient_preview(&mut engine.inner)
}

#[wasm_bindgen(js_name = "interpolateGradient")]
pub fn interpolate_gradient(stops_json: &str, t: f64) -> Vec<u8> {
    crate::commands::drawing::interpolate_gradient(stops_json, t)
}

#[wasm_bindgen(js_name = "computeLinearGradientT")]
pub fn compute_linear_gradient_t(px: f64, py: f64, sx: f64, sy: f64, ex: f64, ey: f64) -> f64 {
    crate::commands::drawing::compute_linear_gradient_t(px, py, sx, sy, ex, ey)
}

#[wasm_bindgen(js_name = "computeRadialGradientT")]
pub fn compute_radial_gradient_t(px: f64, py: f64, cx: f64, cy: f64, radius: f64) -> f64 {
    crate::commands::drawing::compute_radial_gradient_t(px, py, cx, cy, radius)
}

#[wasm_bindgen(js_name = "sampleColor")]
pub fn sample_color(engine: &Engine, x: f64, y: f64, sample_size: u32) -> Vec<u8> {
    crate::commands::drawing::sample_color(&engine.inner, x, y, sample_size)
}

#[wasm_bindgen(js_name = "saveShapePreview")]
pub fn save_shape_preview(engine: &mut Engine, layer_id: &str) {
    crate::commands::drawing::save_shape_preview(&mut engine.inner, layer_id)
}

#[wasm_bindgen(js_name = "endShapePreview")]
pub fn end_shape_preview(engine: &mut Engine) {
    crate::commands::drawing::end_shape_preview(&mut engine.inner)
}

#[wasm_bindgen(js_name = "renderShape")]
pub fn render_shape(
    engine: &mut Engine,
    layer_id: &str,
    shape_type: u32,
    cx: f64,
    cy: f64,
    width: f64,
    height: f64,
    fill_r: f32,
    fill_g: f32,
    fill_b: f32,
    fill_a: f32,
    stroke_r: f32,
    stroke_g: f32,
    stroke_b: f32,
    stroke_a: f32,
    stroke_width: f32,
    sides: u32,
    corner_radius: f32,
) {
    crate::commands::drawing::render_shape(&mut engine.inner, layer_id, shape_type, cx, cy, width, height, fill_r, fill_g, fill_b, fill_a, stroke_r, stroke_g, stroke_b, stroke_a, stroke_width, sides, corner_radius)
}

#[wasm_bindgen(js_name = "renderShapeExpanded")]
pub fn render_shape_expanded(
    engine: &mut Engine,
    layer_id: &str,
    shape_type: u32,
    cx: f64,
    cy: f64,
    width: f64,
    height: f64,
    fill_r: f32,
    fill_g: f32,
    fill_b: f32,
    fill_a: f32,
    stroke_r: f32,
    stroke_g: f32,
    stroke_b: f32,
    stroke_a: f32,
    stroke_width: f32,
    sides: u32,
    corner_radius: f32,
) {
    crate::commands::drawing::render_shape_expanded(&mut engine.inner, layer_id, shape_type, cx, cy, width, height, fill_r, fill_g, fill_b, fill_a, stroke_r, stroke_g, stroke_b, stroke_a, stroke_width, sides, corner_radius)
}

#[wasm_bindgen(js_name = "uploadPathTexture")]
pub fn upload_path_texture(engine: &mut Engine, layer_id: &str, data: &[u8], width: u32, height: u32) {
    crate::commands::drawing::upload_path_texture(&mut engine.inner, layer_id, data, width, height)
}
