//! The proof-of-concept RAW develop stage: the first step of spec E2/E3.
//!
//! A RAW document's layer holds linear camera RGB at the as-shot white
//! balance (`lopsy_core::raf::develop::render_linear_band`). When the
//! document has a [`RawDevelopState`], the compositor runs
//! `gpu/shaders/develop/raw_develop.wgsl` over the composite after the layers
//! are blended and before the document's image adjustments: white balance
//! (`wb_ratio`, camera space) → camera matrix → exposure (baseline + user
//! EV) → saturation → highlight desaturation → base curve (a LUT texture) →
//! sRGB transfer. White balance and exposure are therefore applied in linear
//! light and can change without decoding again. With the settings from
//! `develop_defaults` the result matches today's baked decode without its
//! capture sharpening; `lopsy_core::raf::develop::develop_reference` is the
//! CPU twin the tests compare against.
//!
//! With no state (the default) nothing runs and Lopsy renders as before.
//!
//! Limits of the proof of concept, which the full scene-referred pipeline
//! (spec 6.10) replaces: it develops the whole composite, so anything else in
//! the document (other layers, the background colour) is developed too; it
//! works in sRGB primaries rather than linear Rec. 2020; the camera matrix
//! does not follow the white balance (no dual-illuminant interpolation); it
//! desaturates highlights instead of reconstructing them; there is no stage
//! caching, sharpening, noise reduction or Lab support. On a WebGL context
//! without float render targets the composite is 8-bit, which clips and
//! bands linear values: develop there only on RGBA16F.

use lopsy_core::raf::develop::RawDevelopSettings;

use crate::engine::EngineInner;
use crate::gpu::params::develop::RawDevelopParams;
use crate::gpu::pass::Pass;
use crate::gpu::shader::ShaderProgram;
use crate::gpu::texture_pool::TextureHandle;
use crate::gpu::uniforms::Mat3;

/// Texels per row of the base-curve LUT texture. Entry `i` is texel
/// `(i % CURVE_WIDTH, i / CURVE_WIDTH)`, so a 4096-entry curve is 256×16,
/// inside every WebGL2 texture size limit.
pub const CURVE_WIDTH: u32 = 256;

/// The develop settings of a document, and the LUT texture of its base curve.
pub struct RawDevelopState {
    pub settings: RawDevelopSettings,
    /// The base curve, one entry per texel in the red channel, when the
    /// settings have one.
    pub curve_texture: Option<TextureHandle>,
    /// Entries in `curve_texture`.
    pub curve_size: u32,
}

/// The curve as RGBA f32 texels: each entry in R, G and B, alpha 1, padded
/// with the last entry to whole rows of `CURVE_WIDTH`. Returns the texels
/// and the texture's height.
pub fn curve_texels(curve: &[f32]) -> (Vec<f32>, u32) {
    let rows = (curve.len() as u32).div_ceil(CURVE_WIDTH).max(1);
    let last = curve.last().copied().unwrap_or(0.0);
    let mut texels = Vec::with_capacity((rows * CURVE_WIDTH * 4) as usize);
    for i in 0..(rows * CURVE_WIDTH) as usize {
        let v = curve.get(i).copied().unwrap_or(last);
        texels.extend_from_slice(&[v, v, v, 1.0]);
    }
    (texels, rows)
}

/// The shader's uniforms for `state`.
pub fn params(state: &RawDevelopState) -> RawDevelopParams {
    let s = &state.settings;
    let m = s.cam_to_rgb;
    let has_curve = state.curve_texture.is_some() && state.curve_size >= 2;
    RawDevelopParams {
        // Row-major in the settings, column-major in the shader.
        cam_to_rgb: Mat3([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]),
        wb_ratio: s.wb_ratio,
        exposure_gain: s.exposure_ev.exp2(),
        saturation: s.saturation,
        highlight_desat: i32::from(s.highlight_desaturation),
        curve_size: if has_curve { state.curve_size as i32 } else { 0 },
        curve_width: CURVE_WIDTH as i32,
    }
}

/// The develop pass over `source`, with `program` from
/// `engine.shaders.raw_develop()`. Without a curve, the LUT sampler points
/// at unit 0, the source, so it cannot alias the render target. Returns the
/// pass and how many texture units it bound.
pub fn pass<'a>(
    engine: &'a EngineInner,
    program: &'a ShaderProgram<RawDevelopParams>,
    source: TextureHandle,
    state: &RawDevelopState,
) -> (Pass<'a, RawDevelopParams>, u32) {
    let pass = engine.pass(program, params(state)).texture("u_tex", source);
    match state.curve_texture.filter(|&h| engine.gpu().has_texture(h)) {
        Some(lut) => (pass.texture("u_curveLut", lut), 2),
        None => (pass.sampler_unit("u_curveLut", 0), 1),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn curve_texels_pad_whole_rows() {
        let curve: Vec<f32> = (0..300).map(|i| i as f32 / 299.0).collect();
        let (texels, rows) = curve_texels(&curve);
        assert_eq!(rows, 2);
        assert_eq!(texels.len(), (2 * CURVE_WIDTH * 4) as usize);
        assert_eq!(texels[299 * 4], 1.0);
        assert_eq!(texels[511 * 4], 1.0);
        assert_eq!(texels[3], 1.0);
    }

    #[test]
    fn develop_shader_keeps_the_reference_order() {
        let src = include_str!("../gpu/shaders/develop/raw_develop.wgsl");
        let code: String = src.lines().filter(|l| !l.trim_start().starts_with("//")).collect::<Vec<_>>().join("\n");
        let at = |needle: &str| code.find(needle).unwrap_or_else(|| panic!("missing {needle}"));
        let order = [
            "params.u_wbRatio",
            "params.u_exposureGain",
            "params.u_saturation",
            "params.u_highlightDesat",
            "params.u_curveSize",
            "linearToSrgb(rgb.r)",
        ];
        for pair in order.windows(2) {
            assert!(at(pair[0]) < at(pair[1]), "{} must come before {}", pair[0], pair[1]);
        }
    }
}
