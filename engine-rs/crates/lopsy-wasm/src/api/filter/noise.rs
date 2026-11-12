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
        |pass| {
            pass
                .f32("u_amount", amount / 255.0)
                .i32("u_monochrome", if monochrome { 1 } else { 0 })
                .i32("u_gaussian", if gaussian { 1 } else { 0 })
                .f32("u_seed", seed)
        },
    );
}

#[wasm_bindgen(js_name = "filterClouds")]
pub fn filter_clouds(engine: &mut Engine, layer_id: &str, scale: f32, seed: f32) {
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.clouds,
        |pass| {
            pass
                .f32("u_scale", scale)
                .f32("u_seed", seed)
        },
    );
}

#[wasm_bindgen(js_name = "filterSmoke")]
pub fn filter_smoke(engine: &mut Engine, layer_id: &str, scale: f32, seed: f32, turbulence: f32) {
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.smoke,
        |pass| {
            pass
                .f32("u_scale", scale)
                .f32("u_seed", seed)
                .f32("u_turbulence", turbulence)
        },
    );
}

#[wasm_bindgen(js_name = "filterFibers")]
pub fn filter_fibers(engine: &mut Engine, layer_id: &str, variance: f32, strength: f32, seed: f32) {
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.fibers,
        |pass| {
            pass
                .f32("u_variance", variance)
                .f32("u_strength", strength)
                .f32("u_seed", seed)
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
        |pass| {
            pass
                .f32("u_amount", p.amount)
                .f32("u_size", p.size)
                .f32("u_stretch", p.stretch)
                .f32("u_angle", p.angle_rad)
                .f32("u_octaves", p.octaves)
                .f32("u_contrast", p.contrast)
                .i32("u_kind", p.kind as i32)
                .i32("u_blend", p.blend as i32)
                .i32("u_colored", i32::from(p.is_colored))
                .u32("u_seed", p.seed)
        },
    );
}
