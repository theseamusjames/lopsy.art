//! Noise-based filters: add noise, texture, clouds, smoke, fibers.


use crate::engine::EngineInner;
use crate::filter_gpu;
use lopsy_core::filters::texture::TextureParams;
use crate::gpu::params::filters::{CloudsParams, FibersParams, NoiseParams, SmokeParams};
use crate::gpu::params;

pub fn filter_add_noise(
    engine: &mut EngineInner, layer_id: &str,
    amount: f32, monochrome: bool, gaussian: bool, seed: f32,
) {
    filter_gpu::apply_filter(
        &mut *engine,
        layer_id,
        |s| &s.noise,
        NoiseParams {
            amount: amount / 255.0,
            monochrome,
            gaussian,
            seed,
        },
    );
}

pub fn filter_clouds(engine: &mut EngineInner, layer_id: &str, scale: f32, seed: f32) {
    filter_gpu::apply_filter(
        &mut *engine,
        layer_id,
        |s| &s.clouds,
        CloudsParams { scale, seed },
    );
}

pub fn filter_smoke(engine: &mut EngineInner, layer_id: &str, scale: f32, seed: f32, turbulence: f32) {
    filter_gpu::apply_filter(
        &mut *engine,
        layer_id,
        |s| &s.smoke,
        SmokeParams { scale, seed, turbulence },
    );
}

pub fn filter_fibers(engine: &mut EngineInner, layer_id: &str, variance: f32, strength: f32, seed: f32) {
    filter_gpu::apply_filter(
        &mut *engine,
        layer_id,
        |s| &s.fibers,
        FibersParams { variance, strength, seed },
    );
}

/// Unified Texture filter: grain, rough, canvas, streaks or cells, added to
/// the layer's existing pixels (alpha is kept). Indices for `kind` and
/// `blend` follow `lopsy_core::filters::texture`.
#[allow(clippy::too_many_arguments)]
pub fn filter_texture(
    engine: &mut EngineInner, layer_id: &str,
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
        &mut *engine,
        layer_id,
        |s| &s.texture,
        params::filters::TextureParams {
            kind: p.kind as i32,
            blend: p.blend as i32,
            amount: p.amount,
            size: p.size,
            stretch: p.stretch,
            angle: p.angle_rad,
            octaves: p.octaves,
            contrast: p.contrast,
            colored: p.is_colored,
            seed: p.seed,
        },
    );
}
