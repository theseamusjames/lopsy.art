//! The tone step on the GPU (`gpu/shaders/develop/tone.wgsl`): scene linear
//! Rec. 2020 to rendered linear Rec. 2020, with the RAW develop settings'
//! saturation, highlight desaturation and base curve. It runs only on a
//! RAW document with the working space; `lopsy_core::tone` is the maths and
//! its CPU reference.

use lopsy_core::tone::{curve_top, SHOULDER_HEADROOM};
use lopsy_core::working_space::{conversion, luma, Gamut};

use crate::develop::{RawDevelopState, CURVE_WIDTH};
use crate::engine::EngineInner;
use crate::gpu::params::develop::ToneParams;
use crate::gpu::pass::Pass;
use crate::gpu::shader::ShaderProgram;
use crate::gpu::texture_pool::TextureHandle;
use crate::gpu::uniforms::Mat3;

/// A row-major matrix as the shader's column-major `mat3x3`.
pub(crate) fn mat3(m: [f32; 9]) -> Mat3 {
    Mat3([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]])
}

/// The tone shader's uniforms for `state`.
pub fn params(state: &RawDevelopState) -> ToneParams {
    let s = &state.settings;
    let curve = s.base_curve.as_deref().filter(|c| c.len() >= 2 && state.curve_texture.is_some() && state.curve_size >= 2);
    let (top, slope) = curve.map_or((1.0, 0.0), curve_top);
    ToneParams {
        to_srgb: mat3(conversion(Gamut::Rec2020, Gamut::Srgb)),
        from_srgb: mat3(conversion(Gamut::Srgb, Gamut::Rec2020)),
        luma: luma(Gamut::Rec2020),
        saturation: s.saturation,
        highlight_desat: i32::from(s.highlight_desaturation),
        curve_size: if curve.is_some() { state.curve_size as i32 } else { 0 },
        curve_width: CURVE_WIDTH as i32,
        curve_top: top,
        curve_slope: slope,
        shoulder_headroom: SHOULDER_HEADROOM,
    }
}

/// The tone pass over `source`, with `program` from `engine.shaders.tone()`.
/// Without a curve, the LUT sampler points at unit 0, the source, so it
/// cannot alias the render target. Returns the pass and how many texture
/// units it bound.
pub fn pass<'a>(
    engine: &'a EngineInner,
    program: &'a ShaderProgram<ToneParams>,
    source: TextureHandle,
    state: &RawDevelopState,
) -> (Pass<'a, ToneParams>, u32) {
    let pass = engine.pass(program, params(state)).texture("u_tex", source);
    match state.curve_texture.filter(|&h| engine.gpu().has_texture(h)) {
        Some(lut) => (pass.texture("u_curveLut", lut), 2),
        None => (pass.sampler_unit("u_curveLut", 0), 1),
    }
}
