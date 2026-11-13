use crate::gpu::params::filters::{CelShadingParams, ChromaticAberrationParams, EmbossParams, HalftoneParams, KaleidoscopeParams, LensDistortionParams, OilPaintParams, PixelStretchParams, VoronoiParams};
use crate::gpu::pass::Pass;
use crate::gpu::texture_pool::TextureHandle;
use crate::imaging::Imaging;

pub fn find_edges<'a>(im: Imaging<'a>, src: TextureHandle) -> Pass<'a, ()> {
    im.gpu.pass(&im.shaders.find_edges, ()).texture("u_tex", src)
}

pub fn cel_shading<'a>(im: Imaging<'a>, src: TextureHandle, levels: u32, edge_strength: f32) -> Pass<'a, CelShadingParams> {
    im.gpu.pass(&im.shaders.cel_shading, CelShadingParams { levels: levels as i32, edge_strength }).texture("u_tex", src)
}

pub fn halftone<'a>(im: Imaging<'a>, src: TextureHandle, dot_size: f32, density: f32, angle: f32, contrast: f32) -> Pass<'a, HalftoneParams> {
    let density = density.clamp(0.25, 3.0);
    im.gpu.pass(&im.shaders.halftone, HalftoneParams { dot_size, angle, contrast, density }).texture("u_tex", src)
}

pub fn oil_paint<'a>(im: Imaging<'a>, src: TextureHandle, radius: f32, sharpness: f32) -> Pass<'a, OilPaintParams> {
    let radius = radius.clamp(1.0, 10.0);
    let sharpness = sharpness.clamp(0.1, 5.0);
    im.gpu.pass(&im.shaders.oil_paint, OilPaintParams { radius, sharpness }).texture("u_tex", src)
}

pub fn chromatic_aberration<'a>(im: Imaging<'a>, src: TextureHandle, amount: f32, angle_degrees: f32) -> Pass<'a, ChromaticAberrationParams> {
    let amount = amount.clamp(0.0, 100.0);
    im.gpu.pass(&im.shaders.chromatic_aberration, ChromaticAberrationParams { amount, angle: angle_degrees.to_radians() }).texture("u_tex", src)
}

pub fn pixel_stretch<'a>(im: Imaging<'a>, src: TextureHandle, amount: f32, bands: f32, seed: f32, rgb_split: f32) -> Pass<'a, PixelStretchParams> {
    let amount = amount.clamp(0.0, 200.0);
    let bands = bands.clamp(2.0, 50.0);
    let rgb_split = rgb_split.clamp(0.0, 1.0);
    im.gpu.pass(&im.shaders.pixel_stretch, PixelStretchParams { amount, bands, seed, rgb_split }).texture("u_tex", src)
}

pub fn emboss<'a>(im: Imaging<'a>, src: TextureHandle, angle_degrees: f32, strength: f32, emboss_type: f32) -> Pass<'a, EmbossParams> {
    let strength = strength.clamp(0.0, 1.0);
    let emboss_type = emboss_type.clamp(0.0, 1.0);
    im.gpu.pass(&im.shaders.emboss, EmbossParams { angle: angle_degrees.to_radians(), strength, emboss_type }).texture("u_tex", src)
}

#[allow(clippy::too_many_arguments)]
pub fn voronoi<'a>(im: Imaging<'a>, src: TextureHandle, cell_count: f32, edge_width: f32, edge_r: f32, edge_g: f32, edge_b: f32, seed: f32) -> Pass<'a, VoronoiParams> {
    let cell_count = cell_count.clamp(2.0, 200.0);
    let edge_width = edge_width.clamp(0.0, 20.0);
    let edge_r = edge_r.clamp(0.0, 1.0);
    let edge_g = edge_g.clamp(0.0, 1.0);
    let edge_b = edge_b.clamp(0.0, 1.0);
    let seed = seed.clamp(0.0, 999.0);
    im.gpu.pass(&im.shaders.voronoi, VoronoiParams { cell_count, edge_width, edge_r, edge_g, edge_b, seed }).texture("u_tex", src)
}

/// Mirror `src` into `segments` wedges around `center` (in the source's UV
/// space). `size` is the source's size in pixels, which keeps the polar
/// math isotropic on a non-square source.
pub fn kaleidoscope<'a>(
    im: Imaging<'a>,
    src: TextureHandle,
    size: [f32; 2],
    center: [f32; 2],
    segments: u32,
    rotation_degrees: f32,
) -> Pass<'a, KaleidoscopeParams> {
    let params = KaleidoscopeParams {
        segments: segments.max(2) as f32,
        rotation: rotation_degrees.to_radians(),
        size,
        center,
    };
    im.gpu.pass(&im.shaders.kaleidoscope, params).texture("u_tex", src)
}

/// Barrel or pincushion distortion around `center` (in the source's UV
/// space). `radius_scale` is the length in pixels that a radius of 1 maps
/// to: the long side of the image being distorted.
pub fn lens_distortion<'a>(
    im: Imaging<'a>,
    src: TextureHandle,
    center: [f32; 2],
    radius_scale: f32,
    strength: f32,
    zoom: f32,
    fringing: f32,
) -> Pass<'a, LensDistortionParams> {
    let params = LensDistortionParams {
        strength: strength.clamp(-1.0, 1.0),
        zoom: zoom.clamp(0.5, 2.0),
        fringing: fringing.clamp(0.0, 1.0),
        center,
        radius_scale,
    };
    im.gpu.pass(&im.shaders.lens_distortion, params).texture("u_tex", src)
}
