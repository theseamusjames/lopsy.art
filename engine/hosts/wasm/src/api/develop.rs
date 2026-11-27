//! wasm-bindgen exports for `commands::develop`, the proof-of-concept RAW
//! develop stage. The settings JSON is
//! `{ "wbRatio": [r,g,b], "camToRgb": [9 floats, row-major], "exposureEv": f32,
//!    "saturation": f32, "highlightDesaturation": bool, "baseCurve": [N floats] | null }`,
//! the shape of a RAW description's `developDefaults` (`rawPrepare`), and of
//! `rafDevelopDefaults`.

use wasm_bindgen::prelude::*;

use crate::readback::{read, readback_export};
use crate::Engine;

#[wasm_bindgen(js_name = "setRawDevelop")]
pub fn set_raw_develop(engine: &mut Engine, json: &str) -> Result<(), JsError> {
    lopsy_engine::commands::develop::set_raw_develop_json(&mut engine.inner, json).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "clearRawDevelop")]
pub fn clear_raw_develop(engine: &mut Engine) {
    lopsy_engine::commands::develop::clear_raw_develop(&mut engine.inner)
}

/// The document is the rectangle at (`x`, `y`) of a larger picture;
/// `commands::develop::set_document_region`. Set it after the size.
#[wasm_bindgen(js_name = "setDocumentRegion")]
pub fn set_document_region(engine: &mut Engine, x: u32, y: u32, whole_width: u32, whole_height: u32) -> Result<(), JsError> {
    lopsy_engine::commands::develop::set_document_region(&mut engine.inner, x, y, whole_width, whole_height).map_err(|e| JsError::new(&e))
}

/// The document is the whole picture (the default).
#[wasm_bindgen(js_name = "clearDocumentRegion")]
pub fn clear_document_region(engine: &mut Engine) {
    lopsy_engine::commands::develop::clear_document_region(&mut engine.inner)
}

/// The apron in pixels a tile needs: `develop::tile::apron`.
#[wasm_bindgen(js_name = "developApron")]
pub fn develop_apron(engine: &Engine) -> u32 {
    lopsy_engine::commands::develop::develop_apron(&engine.inner)
}

/// Turn the develop working space on (`on`) or off. On, the image is held
/// as unclamped linear Rec. 2020 float from the RAW step (after
/// `setRawDevelop`) or, for a photo that is not RAW, from an input step that
/// decodes the composite, to an output step that renders it for the screen
/// (the space `setScreenOutput` last said) and for each export's colour
/// space. `sourceSpace` is how a photo that is not RAW is encoded: 0 sRGB,
/// 1 Display P3; it is ignored while a RAW develop state is set. Off, every
/// stage renders as it did before: Lopsy never turns it on. Fails (throws),
/// changing nothing, for another `sourceSpace`, and when turning it on on a
/// GPU without float render targets (WebGL without
/// `EXT_color_buffer_float`); turning it off never fails.
#[wasm_bindgen(js_name = "setDevelopWorkingSpace")]
pub fn set_develop_working_space(engine: &mut Engine, on: bool, source_space: u8) -> Result<(), JsError> {
    lopsy_engine::commands::develop::set_develop_working_space(&mut engine.inner, on, source_space)
        .map_err(|e| JsError::new(&e))
}

readback_export! {
    /// The rendered image of the last live frame with the working space on:
    /// linear Rec. 2020 (D65) before the output step, unclamped (1.0 is
    /// white, above it is HDR headroom), straight alpha. A `Float32Array`
    /// of `docWidth × docHeight × 4` floats, RGBA, rows from the top.
    /// Draws the frame first if it is stale. Fails without the working
    /// space. Wrap with `'any-time'`.
    #[wasm_bindgen(js_name = "readRenderedF32")]
    pub fn read_rendered_f32(engine) -> Result<Vec<f32>> {
        read(lopsy_engine::commands::develop::read_rendered_f32(engine))
    }
}

/// The HDR view of the working space's live frame. `on`: while the screen
/// is HDR (`setScreenOutput` asked for it and `screenIsHdr` says it got
/// it), highlights run above white up to `peak`, in units of SDR white
/// (4.0, two stops, to start; clamped to 1..=64). Off: the screen shows the
/// SDR rendering, as an ordinary screen will, with no change to the
/// canvas. On by default, at 4.0. On WebGL and on an SDR screen it changes
/// nothing on screen; a document without the working space never uses it.
#[wasm_bindgen(js_name = "setDevelopHdr")]
pub fn set_develop_hdr(engine: &mut Engine, on: bool, peak: f32) {
    lopsy_engine::commands::develop::set_develop_hdr(&mut engine.inner, on, peak)
}

readback_export! {
    /// The HDR picture of the document for a file, with the working space:
    /// the whole export chain at the document's size (not the screen's),
    /// then the output step for linear Rec. 2020 with highlights rolled off
    /// toward `peak` (units of SDR white; 4.0 to start). A `Float32Array` of
    /// `docWidth × docHeight × 4` floats, RGBA, straight alpha, rows from
    /// the top, 1.0 = SDR white: what `encodePqPng` and `computeGainMap`
    /// take, the latter with `compositeForExport` as the SDR picture. Fails
    /// without the working space. Replaces the live composite, so the next
    /// frame rebuilds it: do not wrap with `'any-time'`.
    #[wasm_bindgen(js_name = "readHdrOutputF32")]
    pub fn read_hdr_output_f32(engine, peak: f32) -> Result<Vec<f32>> {
        read(lopsy_engine::commands::develop::read_hdr_output_f32(engine, peak))
    }
}

readback_export! {
    /// `readHdrOutputF32` at an output size, with the working space: the
    /// whole export chain at the document's size, the rendered linear image
    /// box-reduced on the GPU to `width × height` (each at most the
    /// document's, neither 0; each axis scaled on its own), then the output
    /// step for linear Rec. 2020 up to `peak`. A `Float32Array` of
    /// `width × height × 4` floats, RGBA, straight alpha, rows from the top,
    /// 1.0 = SDR white. With `compositeForExportSized` at the same size it
    /// is the same picture: `encodePqPng(hdr, width, height, 203)` makes
    /// the PQ PNG, and `computeGainMap(hdr, sdr, width, height, 0, scale)`
    /// (0: the SDR picture is sRGB) the gain map. Sharpening, grain and the blurs are rendered at the document's
    /// size and reduced with the rest, as a full-size export scaled down
    /// is. Fails without the working space and for an empty or larger size.
    /// Re-composites and replaces the live composite, so the next frame
    /// rebuilds it: not safe as an any-time read; do not wrap with
    /// `'any-time'`.
    #[wasm_bindgen(js_name = "readHdrOutputF32Sized")]
    pub fn read_hdr_output_f32_sized(engine, peak: f32, width: u32, height: u32) -> Result<Vec<f32>> {
        read(lopsy_engine::commands::develop::read_hdr_output_f32_sized(engine, peak, width, height))
    }
}

readback_export! {
    /// `compositeForExport` at an output size: the whole export chain at
    /// the document's size, the rendered image box-reduced on the GPU to
    /// `width × height` (each at most the document's, neither 0; each axis
    /// scaled on its own), then, with the working space, the output step
    /// for sRGB, dithered for a RAW photo as `compositeForExport` is.
    /// Without the working space the sRGB result is reduced as it is. A
    /// `Uint8Array` of `width × height × 4` bytes, RGBA8 sRGB, straight
    /// alpha, rows from the top: the SDR picture `readHdrOutputF32Sized`
    /// makes at the same size, for `computeGainMap`. Fails for an empty or
    /// larger size. Re-composites and replaces the live composite, so the
    /// next frame rebuilds it: not safe as an any-time read; do not wrap
    /// with `'any-time'`.
    #[wasm_bindgen(js_name = "compositeForExportSized")]
    pub fn composite_for_export_sized(engine, width: u32, height: u32) -> Result<Vec<u8>> {
        read(lopsy_engine::commands::develop::composite_for_export_sized(engine, width, height))
    }
}

readback_export! {
    /// 1024 bins of the displayed result: red 0..=255, green, blue, then
    /// Rec. 709 luminance of the encoded values. With the working space,
    /// of the image rendered for sRGB whatever the screen is, without the
    /// screen-only views (the area overlay, the clipping warning and the
    /// sharpening mask view: while that is on, the photo is counted as
    /// sharpened, not the mask). Wrap with `'any-time'`.
    #[wasm_bindgen(js_name = "readDevelopHistogram")]
    pub fn read_develop_histogram(engine) -> Result<Vec<u32>> {
        read(lopsy_engine::commands::develop::read_develop_histogram(engine))
    }
}

readback_export! {
    /// 1024 bins of the HDR rendering, for drawing the region right of
    /// white, with the working space: the image rendered for the HDR canvas
    /// (sRGB primaries, the sRGB curve continued past 1) with highlights up
    /// to `peak` (units of SDR white, as `setDevelopHdr` and
    /// `readHdrOutputF32` take it), whatever the screen is, without the
    /// screen-only views (the sharpening mask view included, as for
    /// `readDevelopHistogram`). Red 0..=255, green, blue, then Rec. 709
    /// luminance of the encoded values; bin 0 is black, bin 255 the peak,
    /// and white is at `hdrHistogramWhiteBin(peak)` (139.7 for 4). Fails
    /// without the working space. `readDevelopHistogram` and Auto tone are
    /// unchanged. Wrap with `'any-time'`.
    #[wasm_bindgen(js_name = "readHdrHistogram")]
    pub fn read_hdr_histogram(engine, peak: f32) -> Result<Vec<u32>> {
        read(lopsy_engine::commands::develop::read_hdr_histogram(engine, peak))
    }
}

/// Where SDR white falls on `readHdrHistogram`'s axis for `peak`, in bins
/// from the left (0..=255; 255 / the peak's encoded value, 139.7 for 4).
#[wasm_bindgen(js_name = "hdrHistogramWhiteBin")]
pub fn hdr_histogram_white_bin(peak: f32) -> f32 {
    lopsy_core::output::hdr_histogram_white_bin(peak)
}

/// Auto tone: the histogram (as `readDevelopHistogram` returns it) of the
/// render with `currentJson` applied, and the current
/// `{exposure, contrast, highlights, shadows, whites, blacks}`; returns the
/// new values as the same JSON.
#[wasm_bindgen(js_name = "autoTone")]
pub fn auto_tone(histogram: &[u32], current_json: &str) -> Result<String, JsError> {
    lopsy_core::develop_stats::auto_tone_json(histogram, current_json).map_err(|e| JsError::new(&e))
}

readback_export! {
    /// Scene statistics for `autoToneScene`, with the working space: a
    /// `Float32Array` of 8, the share of pixels counted, then the 1st, 5th,
    /// 25th, 50th, 75th, 95th and 99th percentiles of scene luminance in
    /// stops from middle grey (0.18), of the scene image before the tone
    /// pass with the photo's current exposure applied, read at 256 pixels
    /// on its long edge. Renders a live frame. Wrap with `'any-time'`.
    #[wasm_bindgen(js_name = "readSceneStatistics")]
    pub fn read_scene_statistics(engine) -> Result<Vec<f32>> {
        read(lopsy_engine::commands::develop::read_scene_statistics(engine))
    }
}

/// Auto tone from scene statistics (`readSceneStatistics`) and the current
/// `{exposure, contrast, highlights, shadows, whites, blacks}` as JSON, the
/// recipe's units; returns the new values as the same JSON
/// (`lopsy_core::scene_stats`). With the working space this replaces
/// `autoTone`, which reads the displayed histogram.
#[wasm_bindgen(js_name = "autoToneScene")]
pub fn auto_tone_scene(stats: &[f32], current_json: &str) -> Result<String, JsError> {
    lopsy_core::scene_stats::auto_tone_scene_json(stats, current_json).map_err(|e| JsError::new(&e))
}

/// Grey-world white balance of linear camera RGB (RGBA f32 from
/// `rafRenderBinnedLinear` or `rafRenderLinearBand`): `[r, g, b]` wbRatio
/// multipliers relative to as shot, green = 1.
#[wasm_bindgen(js_name = "rafAutoWhiteBalance")]
pub fn raf_auto_white_balance(linear_rgba: &[f32]) -> Vec<f32> {
    lopsy_core::develop_stats::auto_white_balance(linear_rgba).to_vec()
}

/// `rafAutoWhiteBalance` that leaves out every pixel with a channel at or
/// above 90 % of its clip level: clipped and reconstructed highlights are
/// not measurements of a neutral. `clipLevels` is the three floats
/// `[r, g, b]` of the render params' `clipLevels` (linear camera RGB at the
/// as-shot balance, the units of the pixels); any other length measures
/// every pixel, as `rafAutoWhiteBalance` does.
#[wasm_bindgen(js_name = "rafAutoWhiteBalanceClipped")]
pub fn raf_auto_white_balance_clipped(linear_rgba: &[f32], clip_levels: &[f32]) -> Vec<f32> {
    let clip = <[f32; 3]>::try_from(clip_levels).ok();
    lopsy_core::develop_stats::auto_white_balance_clipped(linear_rgba, clip).to_vec()
}

/// Color by hue: 24 floats, (hue, saturation, luminance) per band in
/// −100..100 (clamped), bands red, orange, yellow, green, aqua, blue,
/// purple, magenta. The pass without the working space; `setDevelopLook`'s
/// Color by hue takes −150..150.
#[wasm_bindgen(js_name = "setImageColorMixer")]
pub fn set_image_color_mixer(engine: &mut Engine, values: &[f32]) -> Result<(), JsError> {
    lopsy_engine::commands::develop::set_image_color_mixer(&mut engine.inner, values).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "clearImageColorMixer")]
pub fn clear_image_color_mixer(engine: &mut Engine) {
    lopsy_engine::commands::develop::clear_image_color_mixer(&mut engine.inner)
}

/// Sharpening and noise reduction: 7 floats `[amount 0..150, radius
/// 0.5..3 (full-resolution px), edges 0..150, nrLuminance 0..150,
/// nrColor 0..100, nrDetail 0..100, pixelScale]`, each clamped to its
/// range. Past 100 nrLuminance widens the filter's range; its mix stays whole.
#[wasm_bindgen(js_name = "setImageDetail")]
pub fn set_image_detail(engine: &mut Engine, values: &[f32]) -> Result<(), JsError> {
    lopsy_engine::commands::develop::set_image_detail(&mut engine.inner, values).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "clearImageDetail")]
pub fn clear_image_detail(engine: &mut Engine) {
    lopsy_engine::commands::develop::clear_image_detail(&mut engine.inner)
}

/// Local contrast and haze: 4 floats `[large −100..150, small −100..150,
/// haze −150..100, pixelScale]`, clamped. With the working space they act in linear light (haze
/// before tone, the details after it); the layout is the same.
#[wasm_bindgen(js_name = "setImageLocalContrast")]
pub fn set_image_local_contrast(engine: &mut Engine, values: &[f32]) -> Result<(), JsError> {
    lopsy_engine::commands::develop::set_image_local_contrast(&mut engine.inner, values).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "clearImageLocalContrast")]
pub fn clear_image_local_contrast(engine: &mut Engine) {
    lopsy_engine::commands::develop::clear_image_local_contrast(&mut engine.inner)
}

/// Areas: 16 floats per area, at most 8 (throws otherwise, or on a kind
/// other than 0/1 or a non-finite value). Per area:
/// `[kind (0 linear, 1 radial), invert (0/1), amount 0..1,
///   x0, y0, x1, y1, rotation (rad), feather 0..1,
///   exposure (EV −4..4), contrast, highlights, shadows,
///   temperature, tint (−200..200), saturation (−100..150)]`, clamped
/// (contrast, highlights and shadows to ±150).
/// Without the working space the areas pass holds the six sliders to
/// ±100; with it the tone and look passes take them whole.
/// Linear: (x0, y0) = p0 (full effect), (x1, y1) = p1 (no effect).
/// Radial: (x0, y0) = centre, (x1, y1) = radii; rotation and feather apply.
/// Coordinates are document pixels.
#[wasm_bindgen(js_name = "setImageAreas")]
pub fn set_image_areas(engine: &mut Engine, values: &[f32]) -> Result<(), JsError> {
    lopsy_engine::commands::develop::set_image_areas(&mut engine.inner, values).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "clearImageAreas")]
pub fn clear_image_areas(engine: &mut Engine) {
    lopsy_engine::commands::develop::clear_image_areas(&mut engine.inner)
}

// An area's layer: after the areas pass, the image is run through the
// develop stages again with the area's own settings and shows through the
// area's mask, over the photo's own edits. `index` is the area's place in
// `setImageAreas` (0..7). Each setter throws on an index out of range or
// on values its document-wide twin would refuse. What is set stays until
// `clearImageAreaLayer`, `clearImageAreaLayers` or `clearImageAreas`.

/// Whites, blacks and vibrance of an area's layer, −100..100 each (Lopsy's
/// image adjustments; with the working space `setDevelopAreaLook`).
#[wasm_bindgen(js_name = "setImageAreaTone")]
pub fn set_image_area_tone(engine: &mut Engine, index: u32, whites: f32, blacks: f32, vibrance: f32) -> Result<(), JsError> {
    lopsy_engine::commands::develop::set_image_area_tone(&mut engine.inner, index, whites, blacks, vibrance).map_err(|e| JsError::new(&e))
}

/// The curves of an area's layer: the 256×4 LUT of `setImageCurvesLut`.
#[wasm_bindgen(js_name = "setImageAreaCurvesLut")]
pub fn set_image_area_curves_lut(engine: &mut Engine, index: u32, lut: &[u8]) -> Result<(), JsError> {
    lopsy_engine::commands::develop::set_image_area_curves_lut(&mut engine.inner, index, lut).map_err(|e| JsError::new(&e))
}

/// Colour grading of an area's layer: the 18 floats of `setImageColorGrading`.
#[wasm_bindgen(js_name = "setImageAreaColorGrading")]
pub fn set_image_area_color_grading(engine: &mut Engine, index: u32, values: &[f32]) -> Result<(), JsError> {
    lopsy_engine::commands::develop::set_image_area_color_grading(&mut engine.inner, index, values).map_err(|e| JsError::new(&e))
}

/// Color by hue of an area's layer: the 24 floats of `setImageColorMixer`.
#[wasm_bindgen(js_name = "setImageAreaColorMixer")]
pub fn set_image_area_color_mixer(engine: &mut Engine, index: u32, values: &[f32]) -> Result<(), JsError> {
    lopsy_engine::commands::develop::set_image_area_color_mixer(&mut engine.inner, index, values).map_err(|e| JsError::new(&e))
}

/// Sharpening and noise reduction of an area's layer: the 7 floats of `setImageDetail`.
#[wasm_bindgen(js_name = "setImageAreaDetail")]
pub fn set_image_area_detail(engine: &mut Engine, index: u32, values: &[f32]) -> Result<(), JsError> {
    lopsy_engine::commands::develop::set_image_area_detail(&mut engine.inner, index, values).map_err(|e| JsError::new(&e))
}

/// Large details, small details and haze of an area's layer: the 4 floats of `setImageLocalContrast`.
#[wasm_bindgen(js_name = "setImageAreaLocalContrast")]
pub fn set_image_area_local_contrast(engine: &mut Engine, index: u32, values: &[f32]) -> Result<(), JsError> {
    lopsy_engine::commands::develop::set_image_area_local_contrast(&mut engine.inner, index, values).map_err(|e| JsError::new(&e))
}

/// Vignette and grain of an area's layer: the 9 floats of `setImageFinish`.
#[wasm_bindgen(js_name = "setImageAreaFinish")]
pub fn set_image_area_finish(engine: &mut Engine, index: u32, values: &[f32]) -> Result<(), JsError> {
    lopsy_engine::commands::develop::set_image_area_finish(&mut engine.inner, index, values).map_err(|e| JsError::new(&e))
}

/// One area's layer off; the area keeps its mask and built-in adjustments.
#[wasm_bindgen(js_name = "clearImageAreaLayer")]
pub fn clear_image_area_layer(engine: &mut Engine, index: u32) {
    lopsy_engine::commands::develop::clear_image_area_layer(&mut engine.inner, index)
}

/// Every area's layer off; the areas themselves stay.
#[wasm_bindgen(js_name = "clearImageAreaLayers")]
pub fn clear_image_area_layers(engine: &mut Engine) {
    lopsy_engine::commands::develop::clear_image_area_layers(&mut engine.inner)
}

/// Show area `index`'s mask as a red overlay on screen only; −1 for none.
#[wasm_bindgen(js_name = "setImageAreaOverlay")]
pub fn set_image_area_overlay(engine: &mut Engine, index: i32) {
    lopsy_engine::commands::develop::set_image_area_overlay(&mut engine.inner, index)
}

/// Mark clipped pixels on screen only: shadows (any channel ≤ 0) in blue,
/// highlights (any channel ≥ 1) in red, after the whole develop chain.
/// With the working space, of the screen's output: what shows as 0 or 255,
/// or in the HDR view (`setDevelopHdr` on an HDR screen) as 0 or the peak.
#[wasm_bindgen(js_name = "setClippingWarning")]
pub fn set_clipping_warning(engine: &mut Engine, shadows: bool, highlights: bool) {
    lopsy_engine::commands::develop::set_clipping_warning(&mut engine.inner, shadows, highlights)
}

readback_export! {
    /// `[temperature, tint]` (recipe units) that make the patch of
    /// `radius` document pixels around (x, y) neutral. Read before the RAW
    /// stage and every adjustment. Wrap with `'any-time'`.
    #[wasm_bindgen(js_name = "sampleNeutralWhiteBalance")]
    pub fn sample_neutral_white_balance(engine, x: f32, y: f32, radius: f32) -> Result<Vec<f32>> {
        read(lopsy_engine::commands::develop::sample_neutral_white_balance(engine, x, y, radius))
    }
}

/// Show the sharpening edge mask as grey on screen while `on` (needs
/// `setImageDetail`); never in exports.
#[wasm_bindgen(js_name = "setImageDetailMaskView")]
pub fn set_image_detail_mask_view(engine: &mut Engine, on: bool) {
    lopsy_engine::commands::develop::set_image_detail_mask_view(&mut engine.inner, on)
}

/// Shaped vignette and grain, last in the develop chain: 9 floats
/// `[vignetteAmount −100..100, size 0..100, roundness −100..100,
///   feather 0..100, grainAmount 0..150, grainSize 0..150,
///   grainRoughness 0..100, seed (an integer per photo), pixelScale]`,
///   clamped.
/// Replaces the adjustments' vignette: set that one to 0 when using this.
#[wasm_bindgen(js_name = "setImageFinish")]
pub fn set_image_finish(engine: &mut Engine, values: &[f32]) -> Result<(), JsError> {
    lopsy_engine::commands::develop::set_image_finish(&mut engine.inner, values).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "clearImageFinish")]
pub fn clear_image_finish(engine: &mut Engine) {
    lopsy_engine::commands::develop::clear_image_finish(&mut engine.inner)
}

// Tone, colour and curves on linear data. These act only with the working
// space (`setDevelopWorkingSpace`); with it, Lopsy's image adjustments
// (`setImageExposure` … `setImageVibrance`, `setImagePhotoFilter`,
// `setImageCurvesLut`, `setImageColorGrading`), `setImageColorMixer` and
// the area layers' `setImageAreaTone`, `setImageAreaCurvesLut`,
// `setImageAreaColorGrading` and `setImageAreaColorMixer` change nothing.
// All zeros is the identity.

/// Tone on scene data, before the profile's base curve: 8 floats
/// `[exposure EV −5..5, temperature, tint (each −200..200),
///   contrast, highlights, shadows, whites, blacks (each −150..150)]`, the
/// recipe's units, clamped (exposure to ±10 EV). Exposure, Temperature and
/// Tint are for a photo that is not RAW; for a RAW photo send them as 0
/// (the RAW step applies the photo's own). Temperature ±100 is a red and
/// blue gain of 2^(±0.6) and 2^(∓0.6), Tint ±100 a green gain of 2^(∓0.4),
/// luminance kept; ±200 is 2^(±1.2) and 2^(∓0.8).
#[wasm_bindgen(js_name = "setDevelopTone")]
pub fn set_develop_tone(engine: &mut Engine, values: &[f32]) -> Result<(), JsError> {
    lopsy_engine::commands::develop::set_develop_tone(&mut engine.inner, values).map_err(|e| JsError::new(&e))
}

/// Colour on rendered linear data, in OkLab: 44 floats `[vibrance,
/// saturation (−100..150), Color by hue's 24 (setImageColorMixer's layout;
/// hue and luminance −150..150, saturation −100..150), a colour grade's 18
/// (as setImageColorGrading)]`, clamped.
#[wasm_bindgen(js_name = "setDevelopLook")]
pub fn set_develop_look(engine: &mut Engine, values: &[f32]) -> Result<(), JsError> {
    lopsy_engine::commands::develop::set_develop_look(&mut engine.inner, values).map_err(|e| JsError::new(&e))
}

/// Curves: 16384 floats, four tables of 4096 (master, red, green, blue),
/// entry `i` the curve's output at input `i / 4095`, both on the sRGB
/// curve's encoding (as Lopsy's 256-entry LUT, over 0..1). A table equal
/// to the identity is skipped.
#[wasm_bindgen(js_name = "setDevelopCurves")]
pub fn set_develop_curves(engine: &mut Engine, values: &[f32]) -> Result<(), JsError> {
    lopsy_engine::commands::develop::set_develop_curves(&mut engine.inner, values).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "clearDevelopCurves")]
pub fn clear_develop_curves(engine: &mut Engine) {
    lopsy_engine::commands::develop::clear_develop_curves(&mut engine.inner)
}

/// `setDevelopTone`, `setDevelopLook` and `setDevelopCurves` all off.
#[wasm_bindgen(js_name = "clearDevelopAdjustments")]
pub fn clear_develop_adjustments(engine: &mut Engine) {
    lopsy_engine::commands::develop::clear_develop_adjustments(&mut engine.inner)
}

/// Area `index`'s layer: 45 floats `[whites, blacks (−150..150), vibrance (−100..150),
/// Color by hue's 24, a colour grade's 18]`. Whites and Blacks act in the
/// tone map and Vibrance in the colour step, through the area's mask;
/// Color by hue and the grade run over a copy laid back through the mask.
/// Cleared with the area's layer (`clearImageAreaLayer`).
#[wasm_bindgen(js_name = "setDevelopAreaLook")]
pub fn set_develop_area_look(engine: &mut Engine, index: u32, values: &[f32]) -> Result<(), JsError> {
    lopsy_engine::commands::develop::set_develop_area_look(&mut engine.inner, index, values).map_err(|e| JsError::new(&e))
}

/// Area `index`'s curves, in `setDevelopCurves`' layout.
#[wasm_bindgen(js_name = "setDevelopAreaCurves")]
pub fn set_develop_area_curves(engine: &mut Engine, index: u32, values: &[f32]) -> Result<(), JsError> {
    lopsy_engine::commands::develop::set_develop_area_curves(&mut engine.inner, index, values).map_err(|e| JsError::new(&e))
}
