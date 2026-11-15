use crate::gpu::params::filters::{ColorLutParams, PatternFillParams, SunburstParams};
use crate::gpu::pass::Pass;
use crate::gpu::texture_pool::TextureHandle;
use crate::imaging::Imaging;

/// How a pattern is laid over the source. `stagger` offsets alternate rows
/// and columns (brick, half-drop) and `origin` shifts the whole grid; both
/// are fractions of one tile.
pub struct PatternTiling {
    pub pattern_size: (u32, u32),
    pub scale: f32,
    pub stagger: [f32; 2],
    pub origin: [f32; 2],
}

/// Tile `pattern` over a source of `size` texels.
pub fn pattern_fill<'a>(
    im: Imaging<'a>,
    src: TextureHandle,
    size: (u32, u32),
    pattern: Option<TextureHandle>,
    tiling: PatternTiling,
) -> Pass<'a, PatternFillParams> {
    let pass = im.gpu
        .pass(&im.shaders.pattern_fill, PatternFillParams {
            layer_size: [size.0 as f32, size.1 as f32],
            pattern_size: [tiling.pattern_size.0 as f32, tiling.pattern_size.1 as f32],
            scale: tiling.scale.max(0.01),
            stagger: tiling.stagger,
            origin: tiling.origin,
        })
        .texture("u_tex", src);
    with_second_texture(pass, "u_pattern", pattern)
}

/// Grade the source through `lut`, a strip of `lut_size` slices each
/// `lut_size` texels square, sampled with linear filtering and no wrap.
pub fn color_lut<'a>(
    im: Imaging<'a>,
    src: TextureHandle,
    lut: Option<TextureHandle>,
    lut_size: u32,
    intensity: f32,
) -> Pass<'a, ColorLutParams> {
    let pass = im.gpu
        .pass(&im.shaders.color_lut, ColorLutParams { lut_size: lut_size as f32, intensity: intensity.clamp(0.0, 1.0) })
        .texture("u_tex", src);
    with_second_texture(pass, "u_lut", lut)
}

/// Bind the texture a filter samples besides its source. With none to
/// give, the sampler is pointed at the unit after the source's, where
/// nothing is bound.
pub(super) fn with_second_texture<'a, P>(pass: Pass<'a, P>, sampler: &str, texture: Option<TextureHandle>) -> Pass<'a, P> {
    match texture {
        Some(texture) => pass.texture(sampler, texture),
        None => pass.sampler_unit(sampler, 1),
    }
}

/// The rays of a sunburst. Fractions are of the ray's own extent.
pub struct SunburstRays {
    pub rays: u32,
    pub rotation_degrees: f32,
    pub length: f32,
    pub width: f32,
    pub taper: f32,
    pub fade: f32,
    pub softness: f32,
    pub jitter: f32,
    pub seed: f32,
    pub ray_color: [f32; 4],
    /// Whether the space between rays is filled with `gap_color` or left
    /// as the source.
    pub fill_gaps: bool,
    pub gap_color: [f32; 3],
}

/// Draw a sunburst over a source of `size` texels, from `center` (in
/// texels) out to `reach`.
pub fn sunburst<'a>(
    im: Imaging<'a>,
    src: TextureHandle,
    size: (u32, u32),
    center: [f32; 2],
    reach: f32,
    rays: SunburstRays,
) -> Pass<'a, SunburstParams> {
    let [ray_r, ray_g, ray_b, ray_a] = rays.ray_color;
    im.gpu
        .pass(&im.shaders.sunburst, SunburstParams {
            size: [size.0 as f32, size.1 as f32],
            center,
            reach,
            rays: rays.rays.max(3) as f32,
            rotation: rays.rotation_degrees.to_radians(),
            length: rays.length.max(0.0),
            width: rays.width.clamp(0.0, 1.0),
            taper: rays.taper.clamp(0.0, 1.0),
            fade: rays.fade.clamp(0.0, 1.0),
            softness: rays.softness.clamp(0.0, 1.0),
            jitter: rays.jitter.clamp(0.0, 1.0),
            seed: rays.seed,
            ray_color: [ray_r, ray_g, ray_b, ray_a.clamp(0.0, 1.0)],
            fill_gaps: i32::from(rays.fill_gaps),
            gap_color: rays.gap_color,
        })
        .texture("u_tex", src)
}
