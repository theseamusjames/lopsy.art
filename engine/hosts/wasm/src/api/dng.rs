//! DNG as a RAW photo: the same split as `raf.rs`, so the app's RAW path
//! takes a DNG with little branching. `dngPrepare` runs the whole-frame
//! stage once (or says why this DNG cannot take this path, and the app
//! uses `decodeAndUploadDng`, the baked decode, instead); workers render
//! row bands with `dngRenderLinearBand` from rows of the prepared plane,
//! planned with `rafPlanBands`; the bands go to the layer with
//! `uploadLayerPixelsF32Rect`; `dngDevelopDefaults` gives `setRawDevelop`'s
//! JSON. None of these touch the GPU or the engine.
//!
//! Units throughout are the RAF renders': linear camera RGB at the
//! as-shot white balance, unclamped below 0, where 1.0 is the white level
//! of the green channel before the as-shot gain, and channel `c` clips at
//! `clipLevels[c]`.
//!
//! Unlike a RAF's, a DNG's camera matrix follows the white balance (the
//! DNG specification's two-illuminant method), and its white balance has a
//! real colour temperature: whenever the app changes `wbRatio` it asks
//! `dngWhiteBalance` for the `camToRgb` that goes with it (and the Kelvin
//! and tint to show), or sets Kelvin and tint with `dngWhiteBalanceKelvin`.

use wasm_bindgen::prelude::*;

use lopsy_core::dng::linear::{self, DngRenderParams};
use lopsy_core::raf::RafBand;

use super::raf::RafRenderedBand;

/// Result of `dngPrepare`: JSON metadata, the render parameters and the
/// prepared plane.
#[wasm_bindgen]
pub struct DngPrepared {
    meta_json: String,
    params_json: String,
    params: DngRenderParams,
    plane: Vec<f32>,
}

#[wasm_bindgen]
impl DngPrepared {
    /// `{ width, height, mosaicWidth, mosaicHeight, samplesPerPixel,
    /// clipLevels, kind, cameraModel, asShotKelvin, asShotTint,
    /// baselineExposure, notApplied }`. `width` and `height` are the final
    /// (oriented) size; `mosaicWidth` × `mosaicHeight` is the plane's,
    /// before orientation, with `samplesPerPixel` values a pixel (3 for
    /// `kind` "linear", already demosaiced; 1 for "bayer"); `clipLevels` is
    /// each channel's clip level `[r, g, b]` in the renders' units;
    /// `asShotKelvin` and `asShotTint` are the as-shot white point's
    /// correlated colour temperature and tint (`lopsy_core::cct`);
    /// `baselineExposure` is in EV; `notApplied` names the file's features
    /// that change the picture and that this decode does not apply.
    #[wasm_bindgen(getter, js_name = "metaJson")]
    pub fn meta_json(&self) -> String {
        self.meta_json.clone()
    }

    /// Render parameters for the other `dng…` calls, kept as the string
    /// Rust wrote so every worker gets exactly the same.
    #[wasm_bindgen(getter, js_name = "paramsJson")]
    pub fn params_json(&self) -> String {
        self.params_json.clone()
    }

    /// `dngRenderBinnedLinear` of the plane this still holds, without
    /// copying it out: call it before `takeMosaic`.
    #[wasm_bindgen(js_name = "binnedLinear")]
    pub fn binned_linear(&self, min_long_edge: u32) -> Result<RafRenderedBand, JsError> {
        if self.plane.is_empty() {
            return Err(JsError::new("The plane was already taken; call binnedLinear before takeMosaic"));
        }
        let (width, height, pixels) =
            linear::render_binned_linear_for(&self.plane, &self.params, min_long_edge).map_err(|e| JsError::new(&e))?;
        Ok(RafRenderedBand { x: 0, y: 0, width, height, pixels })
    }

    /// Moves the prepared plane out: `mosaicWidth × mosaicHeight ×
    /// samplesPerPixel` f32, row-major (interleaved RGB for "linear"). Rows
    /// `[srcY0, srcY1)` of it are `subarray(srcY0 · rowLen, srcY1 · rowLen)`
    /// with `rowLen = mosaicWidth · samplesPerPixel`.
    #[wasm_bindgen(js_name = "takeMosaic")]
    pub fn take_mosaic(&mut self) -> Vec<f32> {
        std::mem::take(&mut self.plane)
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DngPreparedMeta {
    width: u32,
    height: u32,
    mosaic_width: u32,
    mosaic_height: u32,
    samples_per_pixel: u32,
    clip_levels: Option<[f32; 3]>,
    kind: linear::DngKind,
    camera_model: String,
    as_shot_kelvin: f32,
    as_shot_tint: f32,
    baseline_exposure: f64,
    not_applied: Vec<String>,
}

fn params_from(json: &str) -> Result<DngRenderParams, JsError> {
    serde_json::from_str(json).map_err(|e| JsError::new(&format!("DNG params: {e}")))
}

fn to_json<T: serde::Serialize>(v: &T) -> Result<String, JsError> {
    serde_json::to_string(v).map_err(|e| JsError::new(&format!("JSON serialize: {e}")))
}

/// Decode a DNG (the file's bytes) to linear camera RGB for the develop
/// chain. An error starts "DNG cannot open as RAW:" and gives the reason
/// (unsupported compression or layout, no usable colour matrices, a
/// damaged file); the app then opens it with `decodeAndUploadDng` as
/// before.
#[wasm_bindgen(js_name = "dngPrepare")]
pub fn dng_prepare(data: &[u8]) -> Result<DngPrepared, JsError> {
    let prep = linear::prepare_dng(data).map_err(|e| JsError::new(&format!("DNG cannot open as RAW: {e}")))?;
    for line in &prep.debug_log {
        web_sys::console::log_1(&line.into());
    }
    let as_shot = linear::white_balance_for_ratio(&prep.params, [1.0, 1.0, 1.0])
        .map_err(|e| JsError::new(&format!("DNG cannot open as RAW: {e}")))?;
    let (width, height) = prep.params.oriented_size();
    let meta = DngPreparedMeta {
        width,
        height,
        mosaic_width: prep.params.width,
        mosaic_height: prep.params.height,
        samples_per_pixel: prep.params.samples_per_pixel,
        clip_levels: prep.params.clip_levels,
        kind: prep.params.kind,
        camera_model: prep.params.camera_model.clone(),
        as_shot_kelvin: as_shot.kelvin,
        as_shot_tint: as_shot.tint,
        baseline_exposure: prep.params.calibration.baseline_exposure,
        not_applied: prep.unhandled,
    };
    let meta_json = to_json(&meta)?;
    let params_json = to_json(&prep.params)?;
    Ok(DngPrepared { meta_json, params_json, params: prep.params, plane: prep.plane })
}

/// Render plane rows `[srcY0, srcY1)` (passed as `src`, `rowLen` values a
/// row) into rows `[y0, y1)` of linear camera RGB: oriented RGBA f32 at the
/// as-shot white balance, unclamped, alpha 1. Bands from `rafPlanBands`
/// carry enough context rows for either kind, and a band is bit-identical
/// to the same rows of the whole frame.
#[wasm_bindgen(js_name = "dngRenderLinearBand")]
pub fn dng_render_linear_band(
    src: &[f32],
    params_json: &str,
    y0: u32,
    y1: u32,
    src_y0: u32,
    src_y1: u32,
) -> Result<RafRenderedBand, JsError> {
    let params = params_from(params_json)?;
    let band = RafBand { y0, y1, src_y0, src_y1 };
    let out = linear::render_linear_band(src, &params, band).map_err(|e| JsError::new(&e))?;
    Ok(RafRenderedBand { x: out.x, y: out.y, width: out.width, height: out.height, pixels: out.pixels })
}

/// A quick first view without demosaicing: the whole plane (from
/// `takeMosaic`) binned by the coarsest factor that keeps the long edge at
/// least `minLongEdge` (any factor for "linear", an even one for "bayer";
/// 1, no binning, when the frame is already that small). The same units as
/// `dngRenderLinearBand`. x = y = 0; width and height are the reduced,
/// oriented size.
#[wasm_bindgen(js_name = "dngRenderBinnedLinear")]
pub fn dng_render_binned_linear(src: &[f32], params_json: &str, min_long_edge: u32) -> Result<RafRenderedBand, JsError> {
    let params = params_from(params_json)?;
    let (width, height, pixels) =
        linear::render_binned_linear_for(src, &params, min_long_edge).map_err(|e| JsError::new(&e))?;
    Ok(RafRenderedBand { x: 0, y: 0, width, height, pixels })
}

/// The settings a DNG opens with, as the JSON `setRawDevelop` takes:
/// `wbRatio` `[1, 1, 1]` (as shot), `camToRgb` from the file's calibration
/// for that white balance, `exposureEv` the file's `BaselineExposure`
/// (plus `BaselineExposureOffset`), `saturation` 1, the neutral base curve,
/// and `clipLevels`.
#[wasm_bindgen(js_name = "dngDevelopDefaults")]
pub fn dng_develop_defaults(params_json: &str) -> Result<String, JsError> {
    let params = params_from(params_json)?;
    to_json(&linear::develop_defaults(&params).map_err(|e| JsError::new(&e))?)
}

/// The white balance for a `wbRatio` (`[r, g, b]` multipliers on top of the
/// as-shot balance, as `setRawDevelop` takes it), as JSON `{ wbRatio,
/// camToRgb, kelvin, tint, whiteXy }`: `wbRatio` normalized so the as-shot
/// gain times it has green 1, `camToRgb` (row-major, camera RGB → linear
/// sRGB) to put in `setRawDevelop` with it, `kelvin` and `tint` the white
/// point's correlated colour temperature and tint, `whiteXy` its CIE xy.
#[wasm_bindgen(js_name = "dngWhiteBalance")]
pub fn dng_white_balance(params_json: &str, wb_ratio: &[f32]) -> Result<String, JsError> {
    let params = params_from(params_json)?;
    let ratio: [f32; 3] = wb_ratio.try_into().map_err(|_| JsError::new("wbRatio must have three values"))?;
    to_json(&linear::white_balance_for_ratio(&params, ratio).map_err(|e| JsError::new(&e))?)
}

/// The white balance for a colour temperature in kelvin and a tint (the
/// scale of `metaJson`'s `asShotTint`; positive is greener light, rendered
/// more magenta), as the same JSON as `dngWhiteBalance`. Temperatures
/// outside 1667..25000 K are taken at that range's end.
#[wasm_bindgen(js_name = "dngWhiteBalanceKelvin")]
pub fn dng_white_balance_kelvin(params_json: &str, kelvin: f32, tint: f32) -> Result<String, JsError> {
    let params = params_from(params_json)?;
    to_json(&linear::white_balance_for_temperature(&params, kelvin, tint).map_err(|e| JsError::new(&e))?)
}
