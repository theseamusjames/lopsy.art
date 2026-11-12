//! Noise-based filters: add noise, texture, clouds, smoke, fibers.

use wasm_bindgen::prelude::*;

use crate::Engine;
use crate::filter_gpu;
use lopsy_core::filters::texture::TextureParams;

#[wasm_bindgen(js_name = "filterAddNoise")]
pub fn filter_add_noise(
    engine: &mut Engine, layer_id: &str,
    amount: f32, monochrome: bool, gaussian: bool, seed: f32,
) {
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
            if let Some(loc) = shader.location(gl, "u_gaussian") {
                gl.uniform1i(Some(&loc), if gaussian { 1 } else { 0 });
            }
            if let Some(loc) = shader.location(gl, "u_seed") {
                gl.uniform1f(Some(&loc), seed);
            }
        },
    );
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

#[wasm_bindgen(js_name = "filterFibers")]
pub fn filter_fibers(engine: &mut Engine, layer_id: &str, variance: f32, strength: f32, seed: f32) {
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.fibers,
        |gl, shader| {
            if let Some(loc) = shader.location(gl, "u_variance") {
                gl.uniform1f(Some(&loc), variance);
            }
            if let Some(loc) = shader.location(gl, "u_strength") {
                gl.uniform1f(Some(&loc), strength);
            }
            if let Some(loc) = shader.location(gl, "u_seed") {
                gl.uniform1f(Some(&loc), seed);
            }
        },
    );
}

/// Unified Texture filter: grain, rough, canvas, streaks or cells, added to
/// the layer's existing pixels (alpha is kept). Indices for `kind` and
/// `blend` follow `lopsy_core::filters::texture`.
#[wasm_bindgen(js_name = "filterTexture")]
#[allow(clippy::too_many_arguments)]
pub fn filter_texture(
    engine: &mut Engine, layer_id: &str,
    kind: u32, blend: u32, amount: f32, size: f32, stretch: f32,
    angle_deg: f32, detail: f32, contrast: f32, colored: bool, seed: f32,
) {
    let p = TextureParams::new(
        kind, blend, amount, size, stretch, angle_deg, detail, contrast, colored, seed,
    );
    if p.is_identity() {
        return;
    }
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.texture,
        |gl, shader| {
            let set_f = |name: &str, v: f32| {
                if let Some(loc) = shader.location(gl, name) {
                    gl.uniform1f(Some(&loc), v);
                }
            };
            set_f("u_amount", p.amount);
            set_f("u_size", p.size);
            set_f("u_stretch", p.stretch);
            set_f("u_angle", p.angle_rad);
            set_f("u_octaves", p.octaves);
            set_f("u_contrast", p.contrast);
            if let Some(loc) = shader.location(gl, "u_kind") {
                gl.uniform1i(Some(&loc), p.kind as i32);
            }
            if let Some(loc) = shader.location(gl, "u_blend") {
                gl.uniform1i(Some(&loc), p.blend as i32);
            }
            if let Some(loc) = shader.location(gl, "u_colored") {
                gl.uniform1i(Some(&loc), i32::from(p.is_colored));
            }
            if let Some(loc) = shader.location(gl, "u_seed") {
                gl.uniform1ui(Some(&loc), p.seed);
            }
        },
    );
}
