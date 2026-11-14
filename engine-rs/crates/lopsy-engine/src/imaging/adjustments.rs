//! Tone and colour adjustments as one pass over a source texture: the
//! develop pipeline. The compositor runs it on the composite and on layer
//! groups; the Brightness / Contrast filter runs it on a layer.

use crate::gpu::params::filters::{AdjustmentsParams, VignetteParams};
use crate::gpu::pass::Pass;
use crate::gpu::texture_pool::TextureHandle;
use crate::imaging::Imaging;

/// Per-document image adjustments applied on the compositor's final pass.
/// Scalars plus optional LUT textures for curves and levels. Values here
/// don't touch pixel data — they're read by the compositor each frame.
#[derive(Clone)]
pub struct ImageAdjustmentState {
    pub exposure: f32,
    pub contrast: f32,
    pub highlights: f32,
    pub shadows: f32,
    pub whites: f32,
    pub blacks: f32,
    pub vignette: f32,
    pub saturation: f32,
    pub vibrance: f32,
    pub curves_texture: Option<TextureHandle>,
    pub has_curves: bool,
    pub levels_rgb: [f32; 5],
    pub levels_r: [f32; 5],
    pub levels_g: [f32; 5],
    pub levels_b: [f32; 5],
    pub levels_texture: Option<TextureHandle>,
    pub has_levels: bool,
    // Hue/Saturation
    pub hue_shift: f32,
    pub hsl_saturation: f32,
    pub lightness: f32,
    // Color Balance (CMY→RGB shifts per tonal range, -100..100)
    pub cb_shadows: [f32; 3],
    pub cb_midtones: [f32; 3],
    pub cb_highlights: [f32; 3],
    // Photo Filter
    pub pf_color: [f32; 3],
    pub pf_density: f32,
    pub pf_preserve_luminosity: bool,
    // Black & White
    pub bw_reds: f32,
    pub bw_yellows: f32,
    pub bw_greens: f32,
    pub bw_cyans: f32,
    pub bw_blues: f32,
    pub bw_magentas: f32,
    pub bw_enabled: bool,
    // Channel Mixer (row per output channel: [from_r, from_g, from_b, constant])
    pub cm_r: [f32; 4],
    pub cm_g: [f32; 4],
    pub cm_b: [f32; 4],
    pub cm_enabled: bool,
    // Invert
    pub invert: bool,
    // Gradient Map
    pub gradient_map_texture: Option<TextureHandle>,
    pub has_gradient_map: bool,
    // Color Grading (per wheel: [tint_r, tint_g, tint_b, luminance], as offsets)
    pub cg_enabled: bool,
    pub cg_shadows: [f32; 4],
    pub cg_midtones: [f32; 4],
    pub cg_highlights: [f32; 4],
    pub cg_global: [f32; 4],
    pub cg_exponent: f32,
    pub cg_width: f32,
}

impl Default for ImageAdjustmentState {
    fn default() -> Self {
        Self {
            exposure: 0.0,
            contrast: 0.0,
            highlights: 0.0,
            shadows: 0.0,
            whites: 0.0,
            blacks: 0.0,
            vignette: 0.0,
            saturation: 0.0,
            vibrance: 0.0,
            curves_texture: None,
            has_curves: false,
            levels_rgb: [0.0, 1.0, 1.0, 0.0, 1.0],
            levels_r: [0.0, 1.0, 1.0, 0.0, 1.0],
            levels_g: [0.0, 1.0, 1.0, 0.0, 1.0],
            levels_b: [0.0, 1.0, 1.0, 0.0, 1.0],
            levels_texture: None,
            has_levels: false,
            hue_shift: 0.0,
            hsl_saturation: 0.0,
            lightness: 0.0,
            cb_shadows: [0.0; 3],
            cb_midtones: [0.0; 3],
            cb_highlights: [0.0; 3],
            pf_color: [1.0; 3],
            pf_density: 0.0,
            pf_preserve_luminosity: true,
            bw_reds: 40.0,
            bw_yellows: 60.0,
            bw_greens: 40.0,
            bw_cyans: 60.0,
            bw_blues: 20.0,
            bw_magentas: 80.0,
            bw_enabled: false,
            cm_r: [1.0, 0.0, 0.0, 0.0],
            cm_g: [0.0, 1.0, 0.0, 0.0],
            cm_b: [0.0, 0.0, 1.0, 0.0],
            cm_enabled: false,
            invert: false,
            gradient_map_texture: None,
            has_gradient_map: false,
            cg_enabled: false,
            cg_shadows: [0.0; 4],
            cg_midtones: [0.0; 4],
            cg_highlights: [0.0; 4],
            cg_global: [0.0; 4],
            cg_exponent: 1.0,
            cg_width: 0.18,
        }
    }
}

fn has_lut(is_enabled: bool, texture: Option<TextureHandle>) -> bool {
    is_enabled && texture.is_some()
}

fn flag(is_on: bool) -> f32 {
    if is_on { 1.0 } else { 0.0 }
}

/// Every non-sampler uniform of `adjustments.glsl`, including the
/// `u_has*` LUT flags, derived from `adj`.
pub fn params(adj: &ImageAdjustmentState, brightness: f32, doc_color_mode: u32) -> AdjustmentsParams {
    AdjustmentsParams {
        brightness,
        contrast: adj.contrast / 100.0,
        exposure: adj.exposure,
        highlights: adj.highlights,
        shadows: adj.shadows,
        whites: adj.whites,
        blacks: adj.blacks,
        saturation: adj.saturation / 100.0,
        vibrance: adj.vibrance / 100.0,
        has_levels: flag(has_lut(adj.has_levels, adj.levels_texture)),
        has_curves: flag(has_lut(adj.has_curves, adj.curves_texture)),
        // Hue/Saturation
        hue_shift: adj.hue_shift,
        hsl_saturation: adj.hsl_saturation,
        lightness: adj.lightness,
        // Color Balance
        cb_shadows: adj.cb_shadows,
        cb_midtones: adj.cb_midtones,
        cb_highlights: adj.cb_highlights,
        // Photo Filter
        pf_color: adj.pf_color,
        pf_density: adj.pf_density,
        pf_luminosity: flag(adj.pf_preserve_luminosity),
        // Black & White
        bw_reds: adj.bw_reds,
        bw_yellows: adj.bw_yellows,
        bw_greens: adj.bw_greens,
        bw_cyans: adj.bw_cyans,
        bw_blues: adj.bw_blues,
        bw_magentas: adj.bw_magentas,
        bw_enabled: flag(adj.bw_enabled),
        // Channel Mixer
        cm_rr: adj.cm_r[0] / 100.0,
        cm_rg: adj.cm_r[1] / 100.0,
        cm_rb: adj.cm_r[2] / 100.0,
        cm_rc: adj.cm_r[3],
        cm_gr: adj.cm_g[0] / 100.0,
        cm_gg: adj.cm_g[1] / 100.0,
        cm_gb: adj.cm_g[2] / 100.0,
        cm_gc: adj.cm_g[3],
        cm_br: adj.cm_b[0] / 100.0,
        cm_bg: adj.cm_b[1] / 100.0,
        cm_bb: adj.cm_b[2] / 100.0,
        cm_bc: adj.cm_b[3],
        cm_enabled: flag(adj.cm_enabled),
        invert: flag(adj.invert),
        has_gradient_map: flag(has_lut(adj.has_gradient_map, adj.gradient_map_texture)),
        // Color Grading
        cg_enabled: flag(adj.cg_enabled),
        cg_shadows: adj.cg_shadows,
        cg_midtones: adj.cg_midtones,
        cg_highlights: adj.cg_highlights,
        cg_global: adj.cg_global,
        cg_exponent: adj.cg_exponent,
        cg_width: adj.cg_width,
        doc_color_mode: doc_color_mode as i32,
    }
}

/// The pass that applies `adj` to `source`, with the Curves, Levels and
/// Gradient Map LUTs it enables. `brightness` is added on top, for the
/// Brightness / Contrast filter. A LUT sampler that is not in use points at
/// unit 0, the source, so it cannot alias the render target. Returns the
/// pass and how many texture units it bound.
pub fn pass<'a>(
    im: Imaging<'a>,
    source: TextureHandle,
    adj: &ImageAdjustmentState,
    brightness: f32,
    color_mode: u32,
) -> (Pass<'a, AdjustmentsParams>, u32) {
    let mut pass = im.gpu.pass(&im.shaders.adjustments, params(adj, brightness, color_mode)).texture("u_tex", source);
    let mut units = 1;
    let luts = [
        ("u_levelsLut", has_lut(adj.has_levels, adj.levels_texture), adj.levels_texture),
        ("u_curveLut", has_lut(adj.has_curves, adj.curves_texture), adj.curves_texture),
        ("u_gradientLut", has_lut(adj.has_gradient_map, adj.gradient_map_texture), adj.gradient_map_texture),
    ];
    for (name, is_enabled, texture) in luts {
        let live = texture.filter(|&h| is_enabled && im.gpu.has_texture(h));
        pass = match live {
            Some(lut) => {
                units += 1;
                pass.texture(name, lut)
            }
            None => pass.sampler_unit(name, 0),
        };
    }
    (pass, units)
}

/// The pass that applies only a brightness offset and a contrast to
/// `source`, every other adjustment at the identity, from the same list
/// [`pass`] writes (#1163).
pub fn brightness_contrast<'a>(
    im: Imaging<'a>,
    source: TextureHandle,
    brightness: f32,
    contrast: f32,
    color_mode: u32,
) -> Pass<'a, AdjustmentsParams> {
    let adj = ImageAdjustmentState { contrast, ..Default::default() };
    pass(im, source, &adj, brightness, color_mode).0
}

/// The pass that applies a vignette of `amount` to `source`.
pub fn vignette<'a>(im: Imaging<'a>, source: TextureHandle, amount: f32, color_mode: u32) -> Pass<'a, VignetteParams> {
    im.gpu
        .pass(&im.shaders.vignette, VignetteParams { amount, doc_color_mode: color_mode as i32 })
        .texture("u_tex", source)
}
