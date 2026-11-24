//! The develop chain's working space: linear Rec. 2020 float, unclamped,
//! from the RAW step (or, for a photo that is not RAW, the input step) to
//! the output step. A document asks for it with
//! `commands::develop::set_develop_working_space`; without it every stage
//! runs as it always has, and Lopsy never turns it on.
//!
//! The conversions here (`gpu/shaders/develop/working_space.wgsl`, CPU
//! reference `lopsy_core::working_space`) are the input step and the two
//! ends of the display-encoded block: the stages that still assume
//! sRGB-encoded values in sRGB primaries run between a `ToDisplay` and a
//! `FromDisplay` (`compositor`, `MIDDLE_STAGES`).

use lopsy_core::working_space::{conversion, Gamut, SourceEncoding};

use crate::develop::tone::mat3;
use crate::engine::EngineInner;
use crate::gpu::params::develop::WorkingSpaceParams;
use crate::gpu::pass::Pass;
use crate::gpu::shader::ShaderProgram;
use crate::gpu::texture_pool::TextureHandle;

/// A document's working space.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WorkingSpace {
    /// How the composite is encoded when there is no RAW develop state.
    pub source: SourceEncoding,
    /// The last live frame's rendered image (linear Rec. 2020, before the
    /// output step), document-sized, for the statistics and the float
    /// read; made by the first live frame.
    pub rendered: Option<TextureHandle>,
}

/// A conversion of the whole composite.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Conversion {
    /// The input step: the encoded photo to linear Rec. 2020, rendered
    /// equal to scene (no tone curve).
    Input(SourceEncoding),
    /// Rendered linear Rec. 2020 to sRGB primaries with the extended sRGB
    /// curve, for the stages that work on encoded values.
    ToDisplay,
    /// The way back from `ToDisplay`.
    FromDisplay,
}

/// The conversion shader's uniforms.
pub fn params(c: Conversion) -> WorkingSpaceParams {
    let (from, to, mode) = match c {
        Conversion::Input(source) => (source.gamut(), Gamut::Rec2020, 0),
        Conversion::ToDisplay => (Gamut::Rec2020, Gamut::Srgb, 1),
        Conversion::FromDisplay => (Gamut::Srgb, Gamut::Rec2020, 0),
    };
    WorkingSpaceParams { matrix: mat3(conversion(from, to)), mode }
}

/// The conversion pass over `source`, with `program` from
/// `engine.shaders.working_space()`.
pub fn pass<'a>(
    engine: &'a EngineInner,
    program: &'a ShaderProgram<WorkingSpaceParams>,
    source: TextureHandle,
    c: Conversion,
) -> Pass<'a, WorkingSpaceParams> {
    engine.pass(program, params(c)).texture("u_tex", source)
}
