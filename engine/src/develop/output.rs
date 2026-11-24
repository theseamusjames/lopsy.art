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
        Transfer::Linear => (3, 1.0),
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
/// limited to any display's, and for a photo that is not RAW once tone on
/// scene data or the look pass changed it (white balance and saturation
/// can take a colour out of the gamut it came in), and otherwise the gamut
/// the photo was encoded in. With the working space no stage clamps to
/// sRGB: the image adjustments and the old colour by hue, which did, do not
/// run. A document that is neither RAW nor in the working space is sRGB.
/// Whether the run applies Lopsy's image
/// adjustments no longer matters, since they never run with the working
/// space; the argument stays for the callers that pass it.
pub fn source_gamut(engine: &EngineInner, _with_adjustments: bool) -> Gamut {
    match (&engine.raw_develop, &engine.working_space) {
        (Some(_), _) => Gamut::Rec2020,
        (None, Some(_)) if crate::develop::tone::scene_is_active(engine) || crate::document::compositor::look_draws(engine) => {
            Gamut::Rec2020
        }
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

/// The HDR output of the document to `target` (an HDR one) with
/// highlights up to `peak` in units of SDR white. Never dithered.
pub fn hdr_settings_for(engine: &EngineInner, target: OutputTarget, peak: f32) -> OutputSettings {
    OutputSettings::hdr(target, source_gamut(engine, true), peak)
}

/// The canvas's space: Display P3 when the host said the screen is.
pub fn screen_target(engine: &EngineInner) -> OutputTarget {
    if engine.screen_is_display_p3 {
        OutputTarget::DisplayP3
    } else {
        OutputTarget::Srgb
    }
}
