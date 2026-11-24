//! The output step on the GPU (`gpu/shaders/develop/output.wgsl`): rendered
//! linear Rec. 2020 to the screen's or a file's space. `lopsy_core::output`
//! is the method, its constants and its CPU reference.

use lopsy_core::output::{OutputSettings, OutputTarget, Transfer};
use lopsy_core::working_space::{conversion, luma, Gamut};

use crate::develop::tone::mat3;
use crate::engine::EngineInner;
use crate::gpu::params::develop::OutputParams;
use crate::gpu::pass::Pass;
use crate::gpu::shader::ShaderProgram;
use crate::gpu::texture_pool::TextureHandle;

/// The output shader's uniforms for `s`.
pub fn params(s: &OutputSettings) -> OutputParams {
    let (transfer, gamma) = match s.target.transfer() {
        Transfer::Srgb => (0, 1.0),
        Transfer::Gamma(g) => (1, g),
        Transfer::Bt709 => (2, 1.0),
    };
    OutputParams {
        to_target: mat3(conversion(Gamut::Rec2020, s.target.gamut())),
        luma: luma(Gamut::Rec2020),
        target_luma: luma(s.target.gamut()),
        peak: s.peak,
        knee: s.knee,
        gamut_threshold: s.gamut_threshold,
        transfer,
        gamma,
        dither: s.dither,
    }
}

/// The output pass over `source`, with `program` from `engine.shaders.output()`.
pub fn pass<'a>(
    engine: &'a EngineInner,
    program: &'a ShaderProgram<OutputParams>,
    source: TextureHandle,
    settings: &OutputSettings,
) -> Pass<'a, OutputParams> {
    engine.pass(program, params(settings)).texture("u_tex", source)
}

/// The gamut the document's colours can lie anywhere in when they reach
/// the output step: Rec. 2020 for a RAW photo, whose camera colours are not
/// limited to any display's, and otherwise the gamut the photo was encoded
/// in; but sRGB when a stage that clamps every channel to 0..1 in sRGB ran
/// over the whole image (the image adjustments, `with_adjustments` when the
/// run applies them, or colour by hue), since nothing outside sRGB is left.
pub fn source_gamut(engine: &EngineInner, with_adjustments: bool) -> Gamut {
    let clamps_to_srgb = engine.color_mixer.is_some()
        || (with_adjustments && crate::document::compositor::has_any_adjustment(&engine.adjustments));
    match (&engine.raw_develop, &engine.working_space) {
        _ if clamps_to_srgb => Gamut::Srgb,
        (Some(_), _) => Gamut::Rec2020,
        (None, Some(ws)) => ws.source.gamut(),
        (None, None) => Gamut::Srgb,
    }
}

/// The SDR output of the document to `target`, after a chain that applied
/// the image adjustments when `with_adjustments`. `is_8bit` dithers, and
/// only a RAW photo is dithered: one that is not RAW came in as 8-bit
/// values, and passed through unedited it should come back out as them.
pub fn settings_for(engine: &EngineInner, target: OutputTarget, is_8bit: bool, with_adjustments: bool) -> OutputSettings {
    OutputSettings::sdr(target, source_gamut(engine, with_adjustments), is_8bit && engine.raw_develop.is_some())
}

/// The canvas's space: Display P3 when the host said the screen is.
pub fn screen_target(engine: &EngineInner) -> OutputTarget {
    if engine.screen_is_display_p3 {
        OutputTarget::DisplayP3
    } else {
        OutputTarget::Srgb
    }
}
