//! The Photonamous develop chain: the GPU stages that turn a document's
//! composite into the developed picture, and the RAW stage that starts it.
//! Start here; each stage's maths lives in its CPU reference in `lopsy-core`.
//!
//! # Stage order
//!
//! Every stage is `None` (or off) by default; then nothing runs and the
//! composite is byte-identical to Lopsy's. Each pass reads the composite,
//! draws into scratch A and is copied back texel for texel. The chain is
//! run by `compositor::run_develop_chain` (stages 2–9) for the live frame
//! and every export alike; stages 3–9 are its `MIDDLE_STAGES`.
//!
//! **The working space.** A document that asks for it
//! (`setDevelopWorkingSpace`, [`working_space`]; Photonamous does for every
//! photo, Lopsy never) holds unclamped linear Rec. 2020 float from stage 2
//! (or 2i) to stage 11: "scene" data before the tone step, "rendered" after
//! it (1.0 is white, above it HDR headroom). The column "space" says what
//! each stage reads and writes then; without the working space every stage
//! reads and writes sRGB-encoded values in sRGB primaries, as it always has,
//! and stages 2i, 2t, D, D′ and 11 do not run.
//!
//! | # | Stage | Space (working space on) | Pass | Shader (`gpu/shaders/`) | CPU reference (`lopsy_core::`) |
//! |---|---|---|---|---|---|
//! | 1 | Layers composited | camera RGB (RAW) or the photo's encoding | `document::compositor` | `blend.wgsl` | — |
//! | 2 | RAW develop. Working space off: white balance, camera matrix, exposure, saturation, highlight desaturation, base curve, sRGB. On: white balance, camera matrix to Rec. 2020, exposure, nothing else | camera RGB → scene | this module | `develop/raw_develop.wgsl` | `raf::develop::develop_reference`, `raf::develop::scene_reference` |
//! | 2i | Input step, a photo that is not RAW: decode sRGB or Display P3 to linear Rec. 2020, no curve (rendered equals scene) | encoded → scene | `compositor::enter_working_space` | `develop/working_space.wgsl` | `working_space::input_reference` |
//! | 2t | Tone pass. First tone on scene data: the photo's Exposure, Temperature and Tint (not RAW: the RAW step has a RAW photo's), Contrast, Highlights, Shadows, Whites and Blacks, with each area's Exposure, Temperature, Tint, Contrast, Highlights, Shadows and its layer's Whites and Blacks blended in through its mask; a gain, then the tone map on luminance in stops. Then a RAW photo's profile: saturation, highlight desaturation (in sRGB primaries), base curve with its shoulder above 1. A photo that is not RAW runs it only when tone on scene data has something to do | scene → rendered | [`tone`] | `develop/tone.wgsl` | `scene_tone::scene_tone_reference`, then `tone::tone_reference` |
//! | D | Into the display encoding, before the first `Display` stage of a run of them that draws: sRGB primaries, sRGB curve extended past 0..1 | rendered → display | `compositor::convert_composite` | `develop/working_space.wgsl` | `working_space::to_display_reference` |
//! | 3 | Noise reduction | display | [`detail::apply_noise_reduction`] | `develop/noise_reduce.wgsl` | `detail::noise_reduce_reference` |
//! | 4 | Haze, large and small details | display | [`detail::apply_local_contrast`] | `develop/local_contrast.wgsl` | `detail::local_contrast_reference` |
//! | 5 | Image adjustments: tone, colour, curves, levels, colour grading. **Working space off only** | display | `imaging::adjustments` | `filters/adjustments.wgsl` | — (Lopsy's) |
//! | 6 | Colour by hue, on sRGB-encoded values. **Working space off only** | display | `compositor::apply_color_mixer` | `develop/color_mixer.wgsl` | `color_mixer::color_mixer_reference` |
//! | 6L | Look pass. **Working space on only**: Saturation and Vibrance (each area's Saturation and its layer's Vibrance blended in through its mask) and Color by hue in OkLab, colour grading, curves (4096-entry float tables) through the sRGB curve on Rec. 2020 primaries; unclamped | rendered | [`look`] | `develop/look.wgsl` | `look::look_reference` |
//! | 7 | Areas' built-in adjustments (linear and radial masks). **Working space off only**: with it they act in 2t and 6L | display | `compositor::apply_areas` | `develop/areas.wgsl` | `areas::areas_reference` |
//! | 7b | Each area's layer, through its mask. Working space off: stages 3–6, 8 and 9 again with the area's own settings. On: 6L with the area's Color by hue, grade and curves on rendered data, then its 3, 4, 8 and 9 inside D and D′ | display (off); rendered, with its own D and D′ (on) | `compositor::apply_area_layers` | those stages' shaders, then `develop/area_layer.wgsl` | `areas::area_layer_reference` (the mix) |
//! | 8 | Sharpening | display | [`detail::apply_sharpening`] | `develop/detail_sharpen.wgsl` | `detail::sharpen_reference` |
//! | 9 | Finish: shaped vignette, grain | display | `compositor::apply_finish` | `develop/finish.wgsl` | `finish::finish_reference` |
//! | D′ | Back from the display encoding, after the last of 3–9 that drew | display → rendered | `compositor::convert_composite` | `develop/working_space.wgsl` | `working_space::from_display_reference` |
//! | 11 | Output: highlight roll-off, gamut mapping, the target's transfer curve, dither for 8 bits; for the screen (the space `setScreenOutput` said) or the file | rendered → target | [`output`] | `develop/output.wgsl` | `output::output_reference` |
//! | 10 | Screen only, after 11: sharpening mask view (in place of 8), area mask overlay, clipping warning | screen | `compositor` (live frame) | `develop/detail_sharpen.wgsl`, `develop/areas.wgsl`, `develop/clip_warning.wgsl` | `areas::overlay_reference` |
//!
//! Blurs for stages 3, 4 and 8 are `develop/blur_axis.wgsl`, separable up
//! to σ = 4 working pixels and box-downscaled first above that
//! ([`detail`]). Radii are in full-resolution pixels times a `pixelScale`
//! (working width / full width), so the reduced working image and the
//! full-size export blur over the same part of the picture.
//!
//! With the working space, the stages that still assume sRGB-encoded
//! values (3, 4, 8, 9 and an area layer's own 3, 4, 8 and 9) run between D
//! and D′, once each way for each run of consecutive ones that draw, and not
//! at all when none does; 6L and 7b work on rendered data
//! (`compositor::MIDDLE_STAGES`, each stage's `space`). The image
//! adjustments (5), the old colour by hue (6) and the old areas pass (7) do
//! not run at all then, so nothing clamps the image to sRGB any more and
//! the output step maps whatever gamut it reaches (`output::source_gamut`).
//! Noise reduction (3), local contrast and haze (4), sharpening (8) and
//! finish (9) still clamp negative encoded values to 0 and keep the rest of
//! a value above 1.
//!
//! **Exports.** The 16-bit exports (`exportPng16`, `exportTiff16`) run stages
//! 1–9. The 8-bit `compositeForExport` and Flatten run 1–9 except 5:
//! they never applied the document's image adjustments in Lopsy, and that
//! is unchanged. Stage 10 never reaches an export. With the working space,
//! each export ends with stage 11 for its file's space: the 16-bit ones for
//! their `colorSpace` (0 sRGB, 1 Display P3, 2 Rec. 2020), not dithered; the
//! 8-bit one for sRGB, dithered when the photo is RAW; Flatten for sRGB, not
//! dithered (it is copied at the layer's precision).
//!
//! **Statistics.** With the working space, the live frame keeps its
//! rendered image (after D′, before 11) in the working space's own texture.
//! The histogram (`readDevelopHistogram`, and so Auto tone) and the pixel
//! readout (`sampleColor`) read that image through stage 11 for sRGB with no
//! dither (`compositor::statistics_image`), whatever the screen is and
//! without stage 10. `readRenderedF32` reads it as it is. The white balance
//! picker (`sampleNeutralWhiteBalance`) reads stage 1, as before.
//!
//! **Lazily compiled.** Every shader under `gpu/shaders/develop/` (raw
//! develop, colour mixer, areas, blur, noise reduction, sharpening, local
//! contrast, finish, clipping warning, working space, tone, look, output) is compiled the first time a stage
//! asks for it through `ShaderPrograms::<name>()`, never in `compile_all`,
//! so a Lopsy session never links them and a driver that rejects one cannot
//! stop the engine from starting.
//!
//! # The JS API (wasm exports)
//!
//! RAW develop (`hosts/wasm/src/api/raf.rs`, `develop.rs`):
//! - `rafRenderLinearBand(src, paramsJson, y0, y1, srcY0, srcY1)`: a band in linear camera RGB, unclamped.
//! - `rafRenderBinnedLinear(src, paramsJson, minLongEdge)` and `RafPrepared.binnedLinear(minLongEdge)`: the binned first view, no demosaic.
//! - `rafDevelopDefaults(paramsJson)`: the settings that reproduce Lopsy's import look.
//! - `rafDevelopProfiles(paramsJson)`: the Profile menu (camera, the film-simulation looks, neutral, monochrome).
//! - `setRawDevelop(engine, json)`, `clearRawDevelop(engine)`.
//!
//! Working space (`develop.rs`, `lib.rs`):
//! - `setDevelopWorkingSpace(engine, on, sourceSpace)`: on or off; `sourceSpace` 0 sRGB, 1 Display P3 for a photo that is not RAW.
//! - `setScreenOutput(engine, isDisplayP3, wantsHdr)`: the screen's space, which the live frame's output step renders for (on WebGL too).
//! - `readRenderedF32(engine)` (readback): the rendered image, linear Rec. 2020 RGBA f32, unclamped.
//!
//! White balance and statistics:
//! - `rafAutoWhiteBalance(linearRgba)`: near-neutral-pixel white balance, as `wbRatio`.
//! - `rafWhiteBalancePresets(rafBytes)`, `rafWhiteBalanceKelvin(rafBytes)`: the body's presets in recipe units, and the Kelvin scale.
//! - `sampleNeutralWhiteBalance(engine, x, y, radius)` (readback): the picker.
//! - `readDevelopHistogram(engine)` (readback): 4 × 256 bins of the displayed result; with the working space, of the sRGB output.
//! - `sampleColor(engine, x, y, size)` (readback, `drawing.rs`): the pixel readout; with the working space, of the sRGB output.
//! - `autoTone(histogram, currentJson)`: Auto tone from the displayed
//!   histogram (`develop_stats::auto_tone`), kept until the app has moved.
//! - `readSceneStatistics(engine)` (readback, working space only): 8 floats,
//!   the share counted and seven luminance percentiles in stops of the scene
//!   before the tone pass, current exposure applied; with
//!   `autoToneScene(stats, currentJson)`, Auto tone on linear statistics
//!   (`lopsy_core::scene_stats`), the one to use with the working space.
//!
//! Tone, colour and curves with the working space (`develop.rs`; all zeros
//! is the identity, and each acts only with the working space):
//! - `setDevelopTone(engine, Float32Array(8))`: exposure EV, temperature,
//!   tint, contrast, highlights, shadows, whites, blacks (recipe units);
//!   exposure, temperature and tint 0 for a RAW photo.
//! - `setDevelopLook(engine, Float32Array(44))`: vibrance, saturation,
//!   Color by hue's 24, a grade's 18.
//! - `setDevelopCurves(engine, Float32Array(16384))`: master, red, green,
//!   blue, 4096 entries each; `clearDevelopCurves(engine)`.
//! - `clearDevelopAdjustments(engine)`: the three above off.
//! - `setDevelopAreaLook(engine, index, Float32Array(45))`: an area layer's
//!   whites, blacks, vibrance, Color by hue's 24, a grade's 18;
//!   `setDevelopAreaCurves(engine, index, Float32Array(16384))`.
//!
//! With the working space these older calls change nothing (they still
//! work without it): Lopsy's image adjustments (`setImageExposure` …
//! `setImageVibrance`, `setImagePhotoFilter`, `setImageCurvesLut`,
//! `setImageColorGrading`), `setImageColorMixer`, and an area layer's
//! `setImageAreaTone`, `setImageAreaCurvesLut`, `setImageAreaColorGrading`
//! and `setImageAreaColorMixer`. An area's seven built-in sliders keep
//! `setImageAreas`' layout and act in the tone and look passes.
//!
//! Colour without the working space: `setImageColorMixer` /
//! `clearImageColorMixer` (24 floats), `setImageColorGrading` /
//! `clearImageColorGrading` (Lopsy's 18 floats, on the document's image
//! adjustments).
//!
//! Detail: `setImageDetail` / `clearImageDetail` (7 floats: sharpening and
//! noise reduction), `setImageLocalContrast` / `clearImageLocalContrast`
//! (4 floats).
//!
//! Areas: `setImageAreas` / `clearImageAreas` (16 floats an area, at most 8).
//! An area's layer, by the area's index: `setImageAreaTone` (whites,
//! blacks, vibrance), `setImageAreaCurvesLut`, `setImageAreaColorGrading`,
//! `setImageAreaColorMixer`, `setImageAreaDetail`,
//! `setImageAreaLocalContrast`, `setImageAreaFinish`, each with its
//! document-wide twin's values; `clearImageAreaLayer(engine, index)` and
//! `clearImageAreaLayers`.
//!
//! Finish: `setImageFinish` / `clearImageFinish` (9 floats).
//!
//! Views, screen only: `setImageAreaOverlay(engine, index)`,
//! `setClippingWarning(engine, shadows, highlights)`,
//! `setImageDetailMaskView(engine, on)`.
//!
//! Export: `exportPng16(engine, colorSpace)` and `exportTiff16(engine,
//! colorSpace)` (readbacks, `lib.rs`; `lopsy_core::tiff` for the TIFF),
//! `colorSpace` 0 sRGB, 1 Display P3, 2 Rec. 2020; `compositeForExport`
//! (sRGB, 8-bit).
//!
//! Each export's layout and units are in its doc comment and in the
//! command in `commands/develop.rs` (or `commands/adjustment.rs`).
//!
//! # Deviations from spec 6.10
//!
//! This is a proof of concept on Lopsy's compositor, not the scene-referred
//! pipeline the spec describes:
//! - Without the working space, everything after the RAW stage is
//!   display-referred (sRGB-encoded) in sRGB primaries. With it, tone acts
//!   on scene data (2t) and colour, grading and curves on rendered linear
//!   data (6L), but noise reduction, local contrast and haze, sharpening and
//!   finish still run on a display encoding (D, D′), and local contrast
//!   runs after tone with the noise reduction, before colour
//!   (`docs/photonamous-linear-plan.md`, Phase 5).
//! - Highlights and Shadows are a per-pixel curve on luminance, not the
//!   spec's edge-aware version, so they cannot make halos but do not
//!   separate local from global contrast.
//! - An area's built-in sliders and its layer's Whites, Blacks and Vibrance
//!   are blended into the photo's own values through the mask and the maths
//!   is evaluated once; its layer's Color by hue, grade and curves run over
//!   a copy and are laid back through the mask.
//! - The output step is SDR only (peak 1.0); an HDR target with a headroom
//!   is a later phase (`lopsy_core::output::OutputSettings` has its
//!   parameters). Its gamut mapping is a compression toward the neutral
//!   axis (`lopsy_core::output`), not a perceptual mapping.
//! - The camera matrix does not follow the white balance (no dual-
//!   illuminant interpolation, so no true Kelvin; the Kelvin readout is a
//!   fit to the body's presets), and highlights are desaturated, not
//!   reconstructed.
//! - Without the working space, noise reduction and local contrast run on
//!   encoded values before the tone controls, because tone, colour and
//!   curves are one pass (stage 5), and areas apply their own adjustments
//!   after the global colour stages (7) rather than re-running stages 3–12
//!   per area; the large-details control is not offered per area.
//! - An area's further settings (its layer, stage 7b) run over the whole
//!   composite once per area that has any: a copy of the composite, the
//!   stages the area set, and the mix. Its noise reduction and local
//!   contrast therefore work on the image after the document's tone and
//!   colour, not before as stages 3 and 4 do.
//! - There is no stage caching: a frame runs every active stage.
//! - The RAW stage develops the whole composite, so anything else in the
//!   document (other layers, the background colour) is developed too. On a
//!   WebGL context without float render targets the composite is 8-bit,
//!   which clips and bands linear values: develop only on RGBA16F.
//! - Lab documents are not handled by these stages.
//!
//! # This module: the RAW stage
//!
//! A RAW document's layer holds linear camera RGB at the as-shot white
//! balance (`lopsy_core::raf::develop::render_linear_band`). With a
//! [`RawDevelopState`], stage 2 develops it; with the settings from
//! `develop_defaults` the result matches Lopsy's baked RAF decode without
//! its capture sharpening.

pub mod detail;
pub mod look;
pub mod output;
pub mod tone;
pub mod working_space;

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

/// The shader's uniforms for `state`. With `scene`, the stage stops at
/// scene data in linear Rec. 2020, for the working space.
pub fn params(state: &RawDevelopState, scene: bool) -> RawDevelopParams {
    let s = &state.settings;
    let m = if scene { lopsy_core::raf::develop::cam_to_working(s) } else { s.cam_to_rgb };
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
        scene_only: i32::from(scene),
    }
}

/// The develop pass over `source`, with `program` from
/// `engine.shaders.raw_develop()`: to scene data when the document has the
/// working space, to sRGB otherwise. Without a curve, the LUT sampler
/// points at unit 0, the source, so it cannot alias the render target.
/// Returns the pass and how many texture units it bound.
pub fn pass<'a>(
    engine: &'a EngineInner,
    program: &'a ShaderProgram<RawDevelopParams>,
    source: TextureHandle,
    state: &RawDevelopState,
) -> (Pass<'a, RawDevelopParams>, u32) {
    let pass = engine.pass(program, params(state, engine.working_space.is_some())).texture("u_tex", source);
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
