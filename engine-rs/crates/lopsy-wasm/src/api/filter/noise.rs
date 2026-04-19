//! Noise-based generation filters: add noise, fill with noise, clouds, smoke.

use wasm_bindgen::prelude::*;

use crate::Engine;
use crate::filter_gpu;

#[wasm_bindgen(js_name = "filterAddNoise")]
pub fn filter_add_noise(
    engine: &mut Engine, layer_id: &str,
    amount: f32, monochrome: bool,
) {
    let seed = engine.inner.selection_time as f32; // Use time as seed for randomness
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.noise,
        |gl, shader| {
            if let Some(loc) = shader.location(gl, "u_amount") {
                gl.uniform1f(Some(&loc), amount / 255.0);
            }
            if let Some(loc) = shader.location(gl, "u_monochrome") {
                gl.uniform1i(Some(&loc), if monochrome { 1 } else { 0 });
            }
            if let Some(loc) = shader.location(gl, "u_seed") {
                gl.uniform1f(Some(&loc), seed);
            }
        },
    );
}

#[wasm_bindgen(js_name = "filterFillWithNoise")]
pub fn filter_fill_with_noise(engine: &mut Engine, layer_id: &str, monochrome: bool) {
    // Fill with noise = add noise at maximum amount to a cleared layer
    filter_add_noise(engine, layer_id, 255.0, monochrome);
}

#[wasm_bindgen(js_name = "filterClouds")]
pub fn filter_clouds(engine: &mut Engine, layer_id: &str, scale: f32, seed: f32) {
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.clouds,
        |gl, shader| {
            if let Some(loc) = shader.location(gl, "u_scale") {
                gl.uniform1f(Some(&loc), scale);
            }
            if let Some(loc) = shader.location(gl, "u_seed") {
                gl.uniform1f(Some(&loc), seed);
            }
        },
    );
}

#[wasm_bindgen(js_name = "filterSmoke")]
pub fn filter_smoke(engine: &mut Engine, layer_id: &str, scale: f32, seed: f32, turbulence: f32) {
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.smoke,
        |gl, shader| {
            if let Some(loc) = shader.location(gl, "u_scale") {
                gl.uniform1f(Some(&loc), scale);
            }
            if let Some(loc) = shader.location(gl, "u_seed") {
                gl.uniform1f(Some(&loc), seed);
            }
            if let Some(loc) = shader.location(gl, "u_turbulence") {
                gl.uniform1f(Some(&loc), turbulence);
            }
        },
    );
}
