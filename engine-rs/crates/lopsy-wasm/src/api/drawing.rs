//! Single-layer drawing operations that live in-between the paint loop
//! and the compositor: gradient rendering, shape rasterization, eyedropper
//! sampling, and the path-texture upload helper.
//!
//! Each function is a thin `#[wasm_bindgen]` wrapper over its `*_gpu` or
//! `layer_manager` implementation.

use wasm_bindgen::prelude::*;
use web_sys::WebGl2RenderingContext;

use crate::{Engine, gradient_gpu, layer_manager, shape_gpu};

// ============================================================
// Gradient
// ============================================================

#[wasm_bindgen(js_name = "renderLinearGradient")]
pub fn render_linear_gradient(
    engine: &mut Engine, layer_id: &str,
    start_x: f64, start_y: f64, end_x: f64, end_y: f64, stops_json: &str,
) {
    gradient_gpu::render_linear_gradient(&mut engine.inner, layer_id, start_x, start_y, end_x, end_y, stops_json);
}

#[wasm_bindgen(js_name = "renderRadialGradient")]
pub fn render_radial_gradient(
    engine: &mut Engine, layer_id: &str,
    cx: f64, cy: f64, radius: f64, stops_json: &str,
) {
    gradient_gpu::render_radial_gradient(&mut engine.inner, layer_id, cx, cy, radius, stops_json);
}

#[wasm_bindgen(js_name = "interpolateGradient")]
pub fn interpolate_gradient(stops_json: &str, t: f64) -> Vec<u8> {
    gradient_gpu::interpolate_gradient(stops_json, t)
}

#[wasm_bindgen(js_name = "computeLinearGradientT")]
pub fn compute_linear_gradient_t(px: f64, py: f64, sx: f64, sy: f64, ex: f64, ey: f64) -> f64 {
    let dx = ex - sx;
    let dy = ey - sy;
    let len_sq = dx * dx + dy * dy;
    if len_sq < 1e-10 { return 0.0; }
    ((px - sx) * dx + (py - sy) * dy) / len_sq
}

#[wasm_bindgen(js_name = "computeRadialGradientT")]
pub fn compute_radial_gradient_t(px: f64, py: f64, cx: f64, cy: f64, radius: f64) -> f64 {
    let dx = px - cx;
    let dy = py - cy;
    (dx * dx + dy * dy).sqrt() / radius
}

// ============================================================
// Eyedropper
// ============================================================

#[wasm_bindgen(js_name = "sampleColor")]
pub fn sample_color(engine: &Engine, x: f64, y: f64, sample_size: u32) -> Vec<u8> {
    let gl = &engine.inner.gl;
    let ix = x as i32;
    let iy = y as i32;
    let half = (sample_size / 2) as i32;

    // Read from composite FBO
    engine.inner.fbo_pool.bind(gl, engine.inner.composite_fbo);

    let pixels = engine.inner.texture_pool.read_rgba(
        gl, ix - half, iy - half, sample_size, sample_size,
    ).unwrap_or_else(|_| vec![0u8; (sample_size * sample_size * 4) as usize]);

    engine.inner.fbo_pool.unbind(gl);

    // Average the sampled pixels
    let count = (sample_size * sample_size) as usize;
    if count == 0 {
        return vec![0, 0, 0, 255];
    }
    let mut r_sum = 0u64;
    let mut g_sum = 0u64;
    let mut b_sum = 0u64;
    let mut a_sum = 0u64;
    for i in 0..count {
        r_sum += pixels[i * 4] as u64;
        g_sum += pixels[i * 4 + 1] as u64;
        b_sum += pixels[i * 4 + 2] as u64;
        a_sum += pixels[i * 4 + 3] as u64;
    }
    vec![
        (r_sum / count as u64) as u8,
        (g_sum / count as u64) as u8,
        (b_sum / count as u64) as u8,
        (a_sum / count as u64) as u8,
    ]
}

// ============================================================
// Shape Rendering
// ============================================================

#[wasm_bindgen(js_name = "saveShapePreview")]
pub fn save_shape_preview(engine: &mut Engine, layer_id: &str) {
    shape_gpu::save_shape_preview(&mut engine.inner, layer_id);
}

#[wasm_bindgen(js_name = "endShapePreview")]
pub fn end_shape_preview(engine: &mut Engine) {
    shape_gpu::end_shape_preview(&mut engine.inner);
}

#[wasm_bindgen(js_name = "renderShape")]
pub fn render_shape(
    engine: &mut Engine, layer_id: &str,
    shape_type: u32, cx: f64, cy: f64, width: f64, height: f64,
    fill_r: f32, fill_g: f32, fill_b: f32, fill_a: f32,
    stroke_r: f32, stroke_g: f32, stroke_b: f32, stroke_a: f32,
    stroke_width: f32, sides: u32, corner_radius: f32,
) {
    shape_gpu::render_shape(
        &mut engine.inner, layer_id, shape_type, cx, cy, width, height,
        fill_r, fill_g, fill_b, fill_a,
        stroke_r, stroke_g, stroke_b, stroke_a,
        stroke_width, sides, corner_radius,
    );
}

// ============================================================
// Path Rendering
// ============================================================

#[wasm_bindgen(js_name = "uploadPathTexture")]
pub fn upload_path_texture(
    engine: &mut Engine, layer_id: &str,
    data: &[u8], width: u32, height: u32,
) {
    // Upload path rasterization as the layer's texture data
    let _ = layer_manager::upload_pixels(&mut engine.inner, layer_id, data, width, height, 0, 0);
}

