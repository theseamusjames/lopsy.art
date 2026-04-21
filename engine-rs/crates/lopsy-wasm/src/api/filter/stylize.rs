//! Stylize filters: pixelate, halftone, kaleidoscope, oil paint, chromatic
//! aberration, pixel stretch, find edges, cel shading.

use wasm_bindgen::prelude::*;

use crate::Engine;
use crate::filter_gpu;

#[wasm_bindgen(js_name = "filterPixelate")]
pub fn filter_pixelate(engine: &mut Engine, layer_id: &str, block_size: u32) {
    if block_size <= 1 {
        return;
    }
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.pixelate,
        |gl, shader| {
            if let Some(loc) = shader.location(gl, "u_blockSize") {
                gl.uniform1f(Some(&loc), block_size as f32);
            }
        },
    );
}

#[wasm_bindgen(js_name = "filterHalftone")]
pub fn filter_halftone(engine: &mut Engine, layer_id: &str, dot_size: f32, density: f32, angle: f32, contrast: f32) {
    if dot_size < 2.0 {
        return;
    }
    let density = density.clamp(0.25, 3.0);
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.halftone,
        |gl, shader| {
            if let Some(loc) = shader.location(gl, "u_dotSize") {
                gl.uniform1f(Some(&loc), dot_size);
            }
            if let Some(loc) = shader.location(gl, "u_density") {
                gl.uniform1f(Some(&loc), density);
            }
            if let Some(loc) = shader.location(gl, "u_angle") {
                gl.uniform1f(Some(&loc), angle);
            }
            if let Some(loc) = shader.location(gl, "u_contrast") {
                gl.uniform1f(Some(&loc), contrast);
            }
        },
    );
}

#[wasm_bindgen(js_name = "filterKaleidoscope")]
pub fn filter_kaleidoscope(engine: &mut Engine, layer_id: &str, segments: u32, rotation_degrees: f32) {
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.kaleidoscope,
        |gl, shader| {
            if let Some(loc) = shader.location(gl, "u_segments") {
                gl.uniform1f(Some(&loc), segments.max(2) as f32);
            }
            if let Some(loc) = shader.location(gl, "u_rotation") {
                gl.uniform1f(Some(&loc), rotation_degrees.to_radians());
            }
        },
    );
}

#[wasm_bindgen(js_name = "filterOilPaint")]
pub fn filter_oil_paint(engine: &mut Engine, layer_id: &str, radius: f32, sharpness: f32) {
    let radius = radius.clamp(1.0, 10.0);
    let sharpness = sharpness.clamp(0.1, 5.0);
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.oil_paint,
        |gl, shader| {
            if let Some(loc) = shader.location(gl, "u_radius") {
                gl.uniform1f(Some(&loc), radius);
            }
            if let Some(loc) = shader.location(gl, "u_sharpness") {
                gl.uniform1f(Some(&loc), sharpness);
            }
        },
    );
}

#[wasm_bindgen(js_name = "filterChromaticAberration")]
pub fn filter_chromatic_aberration(engine: &mut Engine, layer_id: &str, amount: f32, angle_degrees: f32) {
    let amount = amount.clamp(0.0, 100.0);
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.chromatic_aberration,
        |gl, shader| {
            if let Some(loc) = shader.location(gl, "u_amount") {
                gl.uniform1f(Some(&loc), amount);
            }
            if let Some(loc) = shader.location(gl, "u_angle") {
                gl.uniform1f(Some(&loc), angle_degrees.to_radians());
            }
        },
    );
}

#[wasm_bindgen(js_name = "filterPixelStretch")]
pub fn filter_pixel_stretch(
    engine: &mut Engine,
    layer_id: &str,
    amount: f32,
    bands: f32,
    seed: f32,
    rgb_split: f32,
) {
    let amount = amount.clamp(0.0, 200.0);
    let bands = bands.clamp(2.0, 50.0);
    let rgb_split = rgb_split.clamp(0.0, 1.0);
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.pixel_stretch,
        |gl, shader| {
            if let Some(loc) = shader.location(gl, "u_amount") {
                gl.uniform1f(Some(&loc), amount);
            }
            if let Some(loc) = shader.location(gl, "u_bands") {
                gl.uniform1f(Some(&loc), bands);
            }
            if let Some(loc) = shader.location(gl, "u_seed") {
                gl.uniform1f(Some(&loc), seed);
            }
            if let Some(loc) = shader.location(gl, "u_rgbSplit") {
                gl.uniform1f(Some(&loc), rgb_split);
            }
        },
    );
}

#[wasm_bindgen(js_name = "filterFindEdges")]
pub fn filter_find_edges(engine: &mut Engine, layer_id: &str) {
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.find_edges,
        |_gl, _shader| {},
    );
}

#[wasm_bindgen(js_name = "filterCelShading")]
pub fn filter_cel_shading(engine: &mut Engine, layer_id: &str, levels: u32, edge_strength: f32) {
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.cel_shading,
        |gl, shader| {
            if let Some(loc) = shader.location(gl, "u_levels") {
                gl.uniform1i(Some(&loc), levels as i32);
            }
            if let Some(loc) = shader.location(gl, "u_edgeStrength") {
                gl.uniform1f(Some(&loc), edge_strength);
            }
        },
    );
}
