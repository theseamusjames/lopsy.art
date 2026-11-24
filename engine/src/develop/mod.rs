//! The Photonamous develop chain: the GPU stages that turn a document's
//! composite into the developed picture, and the RAW stage that starts it.
//! Start here; each stage's maths lives in its CPU reference in `lopsy-core`.
//!
//! # Stage order
//!
//! Every stage is `None` (or off) by default; then nothing runs and the
//! composite is byte-identical to Lopsy's. Each pass reads the composite,
//! draws into scratch A and is copied back texel for texel.
//!
//! | # | Stage | Pass | Shader (`gpu/shaders/`) | CPU reference (`lopsy_core::`) |
//! |---|---|---|---|---|
//! | 1 | Layers composited | `document::compositor` | `blend.wgsl` | — |
//! | 2 | RAW develop: white balance, camera matrix, exposure, saturation, highlight desaturation, base curve, sRGB | this module | `develop/raw_develop.wgsl` | `raf::develop::develop_reference` |
//! | 3 | Noise reduction | [`detail::apply_noise_reduction`] | `develop/noise_reduce.wgsl` | `detail::noise_reduce_reference` |
//! | 4 | Haze, large and small details | [`detail::apply_local_contrast`] | `develop/local_contrast.wgsl` | `detail::local_contrast_reference` |
//! | 5 | Image adjustments: tone, colour, curves, levels, colour grading | `imaging::adjustments` | `filters/adjustments.wgsl` | — (Lopsy's) |
//! | 6 | Colour by hue | `compositor::apply_color_mixer` | `develop/color_mixer.wgsl` | `color_mixer::color_mixer_reference` |
//! | 7 | Areas (linear and radial masks) | `compositor::apply_areas` | `develop/areas.wgsl` | `areas::areas_reference` |
//! | 7b | Each area's layer: stages 3–6, 8 and 9 again with the area's own settings, through its mask | `compositor::apply_area_layers` | those stages' shaders, then `develop/area_layer.wgsl` | `areas::area_layer_reference` (the mix) |
//! | 8 | Sharpening | [`detail::apply_sharpening`] | `develop/detail_sharpen.wgsl` | `detail::sharpen_reference` |
//! | 9 | Finish: shaped vignette, grain | `compositor::apply_finish` | `develop/finish.wgsl` | `finish::finish_reference` |
//! | 10 | Screen only: sharpening mask view (in place of 8), area mask overlay, clipping warning | `compositor` (live frame) | `develop/detail_sharpen.wgsl`, `develop/areas.wgsl`, `develop/clip_warning.wgsl` | `areas::overlay_reference` |
//!
//! Blurs for stages 3, 4 and 8 are `develop/blur_axis.wgsl`, separable up
//! to σ = 4 working pixels and box-downscaled first above that
//! ([`detail`]). Radii are in full-resolution pixels times a `pixelScale`
//! (working width / full width), so the reduced working image and the
//! full-size export blur over the same part of the picture.
//!
//! **Exports.** The 16-bit exports (`exportPng16`, `exportTiff16`) run stages
//! 1–9. The 8-bit `compositeForExport` and Flatten run 1–9 except 5:
//! they never applied the document's image adjustments in Lopsy, and that
//! is unchanged. Stage 10 never reaches an export.
//!
//! **Lazily compiled.** Every shader under `gpu/shaders/develop/` (raw
//! develop, colour mixer, areas, blur, noise reduction, sharpening, local
//! contrast, finish, clipping warning) is compiled the first time a stage
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
//! White balance and statistics:
//! - `rafAutoWhiteBalance(linearRgba)`: near-neutral-pixel white balance, as `wbRatio`.
//! - `rafWhiteBalancePresets(rafBytes)`, `rafWhiteBalanceKelvin(rafBytes)`: the body's presets in recipe units, and the Kelvin scale.
//! - `sampleNeutralWhiteBalance(engine, x, y, radius)` (readback): the picker.
//! - `readDevelopHistogram(engine)` (readback): 4 × 256 bins of the displayed result.
//! - `autoTone(histogram, currentJson)`.
//!
//! Colour: `setImageColorMixer` / `clearImageColorMixer` (24 floats),
//! `setImageColorGrading` / `clearImageColorGrading` (Lopsy's 18 floats, on
//! the document's image adjustments).
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
//! Export: `exportTiff16(engine, colorSpace)` (readback), the same composite
//! as `exportPng16` (`lopsy_core::tiff`).
//!
//! Each export's layout and units are in its doc comment and in the
//! command in `commands/develop.rs` (or `commands/adjustment.rs`).
//!
//! # Deviations from spec 6.10
//!
//! This is a proof of concept on Lopsy's compositor, not the scene-referred
//! pipeline the spec describes:
//! - After the RAW stage everything is display-referred (sRGB-encoded) in
//!   sRGB primaries, not linear Rec. 2020: the stages that follow are
//!   Lopsy's image adjustments, which work that way.
//! - The camera matrix does not follow the white balance (no dual-
//!   illuminant interpolation, so no true Kelvin; the Kelvin readout is a
//!   fit to the body's presets), and highlights are desaturated, not
//!   reconstructed.
//! - Noise reduction and local contrast run on encoded values, and local
//!   contrast runs before the tone controls instead of after them, because
//!   tone, colour and curves are one pass (stage 5).
//! - Areas apply their own adjustments after the global colour stages
//!   rather than re-running stages 3–12 per area, and the large-details
//!   control is not offered in that pass. An area's further settings (its
//!   layer, stage 7b) run over the whole composite once per area that has
//!   any: a copy of the composite, the stages the area set, and the mix.
//!   Its noise reduction and local contrast therefore work on the image
//!   after the document's tone and colour, not before as stages 3 and 4 do.
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
