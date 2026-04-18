//! Stylize filters: pixelate, halftone, kaleidoscope, oil paint, chromatic
//! aberration, find edges, cel shading.

use wasm_bindgen::prelude::*;

use crate::Engine;
use crate::filter_gpu;

#[wasm_bindgen(js_name = "filterPixelate")]
pub fn filter_pixelate(engine: &mut Engine, layer_id: &str, block_size: u32) {
    if block_size <= 1 {
        return;
    }
    let prog = engine.inner.shaders.pixelate.program.clone();
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        &prog,
        |gl, prog| {
            if let Some(loc) = gl.get_uniform_location(prog, "u_blockSize") {
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
    let prog = engine.inner.shaders.halftone.program.clone();
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        &prog,
        |gl, prog| {
            if let Some(loc) = gl.get_uniform_location(prog, "u_dotSize") {
                gl.uniform1f(Some(&loc), dot_size);
            }
            if let Some(loc) = gl.get_uniform_location(prog, "u_density") {
                gl.uniform1f(Some(&loc), density);
            }
            if let Some(loc) = gl.get_uniform_location(prog, "u_angle") {
                gl.uniform1f(Some(&loc), angle);
            }
            if let Some(loc) = gl.get_uniform_location(prog, "u_contrast") {
                gl.uniform1f(Some(&loc), contrast);
            }
        },
    );
}

#[wasm_bindgen(js_name = "filterKaleidoscope")]
pub fn filter_kaleidoscope(engine: &mut Engine, layer_id: &str, segments: u32, rotation_degrees: f32) {
    let prog = engine.inner.shaders.kaleidoscope.program.clone();
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        &prog,
        |gl, prog| {
            if let Some(loc) = gl.get_uniform_location(prog, "u_segments") {
                gl.uniform1f(Some(&loc), segments.max(2) as f32);
            }
            if let Some(loc) = gl.get_uniform_location(prog, "u_rotation") {
                gl.uniform1f(Some(&loc), rotation_degrees.to_radians());
            }
        },
    );
}

#[wasm_bindgen(js_name = "filterOilPaint")]
pub fn filter_oil_paint(engine: &mut Engine, layer_id: &str, radius: f32, sharpness: f32) {
    let radius = radius.clamp(1.0, 10.0);
    let sharpness = sharpness.clamp(0.1, 5.0);
    let prog = engine.inner.shaders.oil_paint.program.clone();
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        &prog,
        |gl, prog| {
            if let Some(loc) = gl.get_uniform_location(prog, "u_radius") {
                gl.uniform1f(Some(&loc), radius);
            }
            if let Some(loc) = gl.get_uniform_location(prog, "u_sharpness") {
                gl.uniform1f(Some(&loc), sharpness);
            }
        },
    );
}

#[wasm_bindgen(js_name = "filterChromaticAberration")]
pub fn filter_chromatic_aberration(engine: &mut Engine, layer_id: &str, amount: f32, angle_degrees: f32) {
    let amount = amount.clamp(0.0, 100.0);
    let prog = engine.inner.shaders.chromatic_aberration.program.clone();
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        &prog,
        |gl, prog| {
            if let Some(loc) = gl.get_uniform_location(prog, "u_amount") {
                gl.uniform1f(Some(&loc), amount);
            }
            if let Some(loc) = gl.get_uniform_location(prog, "u_angle") {
                gl.uniform1f(Some(&loc), angle_degrees.to_radians());
            }
        },
    );
}

#[wasm_bindgen(js_name = "filterFindEdges")]
pub fn filter_find_edges(engine: &mut Engine, layer_id: &str) {
    let prog = &engine.inner.shaders.find_edges.program;
    let prog_clone = prog.clone();
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        &prog_clone,
        |_gl, _prog| {},
    );
}

#[wasm_bindgen(js_name = "filterCelShading")]
pub fn filter_cel_shading(engine: &mut Engine, layer_id: &str, levels: u32, edge_strength: f32) {
    let prog = &engine.inner.shaders.cel_shading.program;
    let prog_clone = prog.clone();
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        &prog_clone,
        |gl, prog| {
            if let Some(loc) = gl.get_uniform_location(prog, "u_levels") {
                gl.uniform1i(Some(&loc), levels as i32);
            }
            if let Some(loc) = gl.get_uniform_location(prog, "u_edgeStrength") {
                gl.uniform1f(Some(&loc), edge_strength);
            }
        },
    );
}
