//! Noise-based filters: add noise, texture, clouds, smoke, fibers.


use crate::engine::EngineInner;
use crate::{filter_gpu, imaging};
use lopsy_core::filters::texture::TextureParams;

pub fn filter_add_noise(
    engine: &mut EngineInner, layer_id: &str,
    amount: f32, monochrome: bool, gaussian: bool, seed: f32,
) {
    filter_gpu::apply_op(engine, layer_id, |im, src| imaging::filters::noise::add_noise(im, src, amount, monochrome, gaussian, seed));
}

pub fn filter_clouds(engine: &mut EngineInner, layer_id: &str, scale: f32, seed: f32) {
    filter_gpu::apply_op(engine, layer_id, |im, src| imaging::filters::noise::clouds(im, src, scale, seed));
}

pub fn filter_smoke(engine: &mut EngineInner, layer_id: &str, scale: f32, seed: f32, turbulence: f32) {
    filter_gpu::apply_op(engine, layer_id, |im, src| imaging::filters::noise::smoke(im, src, scale, seed, turbulence));
}

pub fn filter_fibers(engine: &mut EngineInner, layer_id: &str, variance: f32, strength: f32, seed: f32) {
    filter_gpu::apply_op(engine, layer_id, |im, src| imaging::filters::noise::fibers(im, src, variance, strength, seed));
}

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
    filter_gpu::apply_op(engine, layer_id, |im, src| imaging::filters::noise::texture(im, src, &p));
}
