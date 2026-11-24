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

/// The HDR view of the live frame (`setDevelopHdr`): whether it is wanted
/// and its peak, in units of SDR white.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct HdrView {
    pub on: bool,
    pub peak: f32,
}

impl Default for HdrView {
    /// On, at the starting peak: an HDR screen shows HDR until the app
    /// turns the view off.
    fn default() -> Self {
        HdrView { on: true, peak: lopsy_core::output::DEFAULT_HDR_PEAK }
    }
}

/// Whether the live frame is rendered for HDR: the view is on and the
/// screen really is HDR (`EngineInner::screen_is_hdr`).
pub fn live_is_hdr(engine: &EngineInner) -> bool {
    engine.develop_hdr.on && engine.screen_is_hdr()
}

/// The peak the live frame is rendered to: the view's while
/// [`live_is_hdr`], 1 (white) otherwise.
pub fn live_peak(engine: &EngineInner) -> f32 {
    if live_is_hdr(engine) {
        lopsy_core::output::hdr_peak(engine.develop_hdr.peak)
    } else {
        1.0
    }
}

/// The output step of the working space's live frame: for the HDR canvas
/// with the view's peak when [`live_is_hdr`], otherwise the SDR output for
/// the screen's space. Neither is dithered here: the final blit dithers an
/// 8-bit screen, and an HDR one is float. With the view off, an HDR screen
/// is given exactly the SDR rendering, whose 1.0 the canvas shows as its
/// SDR white.
pub fn live_settings(engine: &EngineInner) -> OutputSettings {
    live_settings_on(engine, engine.screen_is_hdr())
}

/// [`live_settings`] for a surface that is HDR (`surface_is_hdr`) or not,
/// so the choice can be tested on an engine with no canvas.
pub fn live_settings_on(engine: &EngineInner, surface_is_hdr: bool) -> OutputSettings {
    if engine.develop_hdr.on && surface_is_hdr {
        hdr_settings_for(engine, OutputTarget::hdr_screen(engine.screen_is_display_p3), engine.develop_hdr.peak)
    } else {
        settings_for(engine, screen_target(engine), false, true)
    }
}

/// The canvas's space: Display P3 when the host said the screen is.
pub fn screen_target(engine: &EngineInner) -> OutputTarget {
    if engine.screen_is_display_p3 {
        OutputTarget::DisplayP3
    } else {
        OutputTarget::Srgb
    }
}
