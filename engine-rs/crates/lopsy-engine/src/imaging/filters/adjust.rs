use crate::gpu::params::color::ColorConvertParams;
use crate::gpu::params::filters::{HueSatParams, PosterizeParams, SolarizeParams, ThresholdParams};
use crate::gpu::pass::Pass;
use crate::gpu::texture_pool::TextureHandle;
use crate::gpu::uniforms::Mat3;
use crate::imaging::Imaging;

pub fn hue_saturation<'a>(im: Imaging<'a>, src: TextureHandle, hue: f32, saturation: f32, lightness: f32) -> Pass<'a, HueSatParams> {
    im.gpu.pass(&im.shaders.hue_sat, HueSatParams { hue, saturation, lightness }).texture("u_tex", src)
}

pub fn invert<'a>(im: Imaging<'a>, src: TextureHandle) -> Pass<'a, ()> {
    im.gpu.pass(&im.shaders.invert, ()).texture("u_tex", src)
}

pub fn posterize<'a>(im: Imaging<'a>, src: TextureHandle, levels: u32) -> Pass<'a, PosterizeParams> {
    im.gpu.pass(&im.shaders.posterize, PosterizeParams { levels: levels as f32 }).texture("u_tex", src)
}

pub fn threshold<'a>(im: Imaging<'a>, src: TextureHandle, level: u32) -> Pass<'a, ThresholdParams> {
    im.gpu.pass(&im.shaders.threshold, ThresholdParams { level: level as f32 / 255.0 }).texture("u_tex", src)
}

pub fn solarize<'a>(im: Imaging<'a>, src: TextureHandle, threshold: u32) -> Pass<'a, SolarizeParams> {
    im.gpu.pass(&im.shaders.solarize, SolarizeParams { threshold: threshold as f32 / 255.0 }).texture("u_tex", src)
}

pub fn desaturate<'a>(im: Imaging<'a>, src: TextureHandle) -> Pass<'a, HueSatParams> {
// Desaturate = hue_sat with saturation = -100
    im.gpu.pass(&im.shaders.hue_sat, HueSatParams { hue: 0.0, saturation: -100.0, lightness: 0.0 }).texture("u_tex", src)
}

/// Rec. 709 luma weights, applied to the stored (gamma-encoded) values so
/// the result matches the Black & White adjustment in `adjustments.wgsl`.
const LUMA_R: f32 = 0.2126;
const LUMA_G: f32 = 0.7152;
const LUMA_B: f32 = 0.0722;

/// Column-major mat3 that maps every output channel to the same luma
/// value, yielding R=G=B.
const GRAYSCALE_MATRIX: [f32; 9] = [
    LUMA_R, LUMA_R, LUMA_R,
    LUMA_G, LUMA_G, LUMA_G,
    LUMA_B, LUMA_B, LUMA_B,
];

/// Grey (R=G=B) at each pixel's luma, alpha untouched.
pub fn grayscale<'a>(im: Imaging<'a>, src: TextureHandle) -> Pass<'a, ColorConvertParams> {
    im.gpu
        .pass(&im.shaders.color_convert, ColorConvertParams { color_matrix: Mat3(GRAYSCALE_MATRIX) })
        .texture("u_tex", src)
}
