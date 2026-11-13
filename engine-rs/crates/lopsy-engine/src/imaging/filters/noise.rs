use crate::gpu::params::filters::{CloudsParams, FibersParams, NoiseParams, SmokeParams};
use lopsy_core::filters::texture::TextureParams;

use crate::gpu::params;
use crate::gpu::pass::Pass;
use crate::gpu::texture_pool::TextureHandle;
use crate::imaging::Imaging;

pub fn add_noise<'a>(im: Imaging<'a>, src: TextureHandle, amount: f32, monochrome: bool, gaussian: bool, seed: f32) -> Pass<'a, NoiseParams> {
    im.gpu.pass(&im.shaders.noise, NoiseParams {
        amount: amount / 255.0,
        monochrome,
        gaussian,
        seed,
    }).texture("u_tex", src)
}

pub fn clouds<'a>(im: Imaging<'a>, src: TextureHandle, scale: f32, seed: f32) -> Pass<'a, CloudsParams> {
    im.gpu.pass(&im.shaders.clouds, CloudsParams { scale, seed }).texture("u_tex", src)
}

pub fn smoke<'a>(im: Imaging<'a>, src: TextureHandle, scale: f32, seed: f32, turbulence: f32) -> Pass<'a, SmokeParams> {
    im.gpu.pass(&im.shaders.smoke, SmokeParams { scale, seed, turbulence }).texture("u_tex", src)
}

pub fn fibers<'a>(im: Imaging<'a>, src: TextureHandle, variance: f32, strength: f32, seed: f32) -> Pass<'a, FibersParams> {
    im.gpu.pass(&im.shaders.fibers, FibersParams { variance, strength, seed }).texture("u_tex", src)
}

/// Unified Texture filter: grain, rough, canvas, streaks or cells, added to
/// the layer's existing pixels (alpha is kept). Indices for `kind` and
/// `blend` follow `lopsy_core::filters::texture`.
pub fn texture<'a>(im: Imaging<'a>, src: TextureHandle, p: &TextureParams) -> Pass<'a, params::filters::TextureParams> {
    let uniforms = params::filters::TextureParams {
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
    };
    im.gpu.pass(&im.shaders.texture, uniforms).texture("u_tex", src)
}
