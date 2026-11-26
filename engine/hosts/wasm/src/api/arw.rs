//! Sony ARW: what the app needs to recognise one, size it without decoding
//! it, and open it as a RAW photo. The baked decode into a layer is
//! `decodeAndUploadArw` (`layer.rs`). The linear path mirrors `dng.rs`:
//! `arwPrepare` runs the whole-frame stage once; workers render row bands
//! with `arwRenderLinearBand` from rows of the prepared plane, planned
//! with `rafPlanBands`; `arwDevelopDefaults` gives `setRawDevelop`'s JSON.
//! None of these touch the GPU or the engine.
//!
//! Units are a Bayer DNG's (`dngRenderLinearBand`): linear camera RGB at
//! the as-shot white balance, unclamped below 0, 1.0 the white level of
//! the green channel, channel `c` clipping at `clipLevels[c]`. Unlike a
//! For a body with measured colour (`lopsy_core::arw::colour`) the camera
//! matrix follows the white balance as a DNG's does: the app asks
//! `arwWhiteBalance` or `arwWhiteBalanceKelvin` for the `camToRgb` that goes
//! with a `wbRatio` or a temperature, as with `dngWhiteBalance`. For any
//! other body the matrix is fixed (as a RAF's) and those two answer with an
//! error: changing the white balance changes `wbRatio` only. Every error is
//! a sentence a person can read.

use wasm_bindgen::prelude::*;

use lopsy_core::arw::{self, linear::{self, ArwRenderParams}};
use lopsy_core::dng::linear::{render_binned_linear_for, render_linear_band};
use lopsy_core::raf::RafBand;

use super::raf::RafRenderedBand;

fn to_json<T: serde::Serialize>(v: &T) -> Result<String, JsError> {
    serde_json::to_string(v).map_err(|e| JsError::new(&format!("JSON serialize: {e}")))
}

fn params_from(json: &str) -> Result<ArwRenderParams, JsError> {
    serde_json::from_str(json).map_err(|e| JsError::new(&format!("ARW params: {e}")))
}

/// Whether the bytes are a Sony raw by IFD0 alone (a TIFF, `Make` "SONY",
/// no `DNGVersion`). True for Sony's older SR2 and SRF too, which
/// `sonyRawInfo` and the decodes refuse with a sentence.
#[wasm_bindgen(js_name = "isSonyRaw")]
pub fn is_sony_raw(data: &[u8]) -> bool {
    arw::is_sony_raw(data)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SonyRawInfo {
    width: u32,
    height: u32,
    camera_model: String,
    encoding: arw::ArwEncoding,
    bits: u16,
    color_approximate: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    color_note: Option<&'static str>,
}

/// An ARW's tags, without decoding its pixels (it reads the headers and
/// deciphers Sony's small private block): `{ width, height, cameraModel,
/// encoding, bits, colorApproximate, colorNote }` (`colorNote` absent for
/// a body with measured colour, whose `colorApproximate` is false). `width` × `height` is
/// the size `decodeAndUploadArw` will give (the crop Sony intends, after
/// orientation); `encoding` is "lossy", "uncompressed" or "lossless". An
/// error means the decodes will refuse the file too, with the same
/// sentence.
#[wasm_bindgen(js_name = "sonyRawInfo")]
pub fn sony_raw_info(data: &[u8]) -> Result<String, JsError> {
    let info = arw::read_info(data).map_err(|e| JsError::new(&e))?;
    let (width, height) = info.oriented_size();
    to_json(&SonyRawInfo {
        width,
        height,
        camera_model: info.camera_model,
        encoding: info.encoding,
        bits: info.bits,
        color_approximate: info.colour.is_approximate(),
        color_note: info.colour.note(),
    })
}

/// Result of `arwPrepare`: JSON metadata, the render parameters and the
/// prepared plane.
#[wasm_bindgen]
pub struct ArwPrepared {
    meta_json: String,
    params_json: String,
    params: ArwRenderParams,
    plane: Vec<f32>,
}

#[wasm_bindgen]
impl ArwPrepared {
    /// `{ width, height, mosaicWidth, mosaicHeight, samplesPerPixel,
    /// clipLevels, kind, cameraModel, colorApproximate, colorNote,
    /// asShotKelvin, asShotTint, notApplied }`, as `dngPrepare`'s where the
    /// names are the same (`kind` is always "bayer", `samplesPerPixel` 1;
    /// no baseline exposure). A body with measured colour has
    /// `colorApproximate` false, no `colorNote`, and the as-shot white
    /// point's `asShotKelvin` and `asShotTint`; any other has no Kelvin or
    /// tint.
    #[wasm_bindgen(getter, js_name = "metaJson")]
    pub fn meta_json(&self) -> String {
        self.meta_json.clone()
    }

    /// Render parameters for the other `arw…` calls, kept as the string
    /// Rust wrote so every worker gets exactly the same.
    #[wasm_bindgen(getter, js_name = "paramsJson")]
    pub fn params_json(&self) -> String {
        self.params_json.clone()
    }

    /// `arwRenderBinnedLinear` of the plane this still holds: call it
    /// before `takeMosaic`.
    #[wasm_bindgen(js_name = "binnedLinear")]
    pub fn binned_linear(&self, min_long_edge: u32) -> Result<RafRenderedBand, JsError> {
        if self.plane.is_empty() {
            return Err(JsError::new("The plane was already taken; call binnedLinear before takeMosaic"));
        }
        let (width, height, pixels) = render_binned_linear_for(&self.plane, &self.params, min_long_edge).map_err(|e| JsError::new(&e))?;
        Ok(RafRenderedBand { x: 0, y: 0, width, height, pixels })
    }

    /// Moves the prepared plane out: `mosaicWidth × mosaicHeight` f32,
    /// row-major.
    #[wasm_bindgen(js_name = "takeMosaic")]
    pub fn take_mosaic(&mut self) -> Vec<f32> {
        std::mem::take(&mut self.plane)
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ArwPreparedMeta {
    width: u32,
    height: u32,
    mosaic_width: u32,
    mosaic_height: u32,
    samples_per_pixel: u32,
    clip_levels: Option<[f32; 3]>,
    kind: &'static str,
    camera_model: String,
    color_approximate: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    color_note: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    as_shot_kelvin: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    as_shot_tint: Option<f32>,
    not_applied: Vec<String>,
}

/// Decode an ARW (the file's bytes) to linear camera RGB for the develop
/// chain.
#[wasm_bindgen(js_name = "arwPrepare")]
pub fn arw_prepare(data: &[u8]) -> Result<ArwPrepared, JsError> {
    let prep = linear::prepare_arw(data).map_err(|e| JsError::new(&e))?;
    for line in &prep.debug_log {
        web_sys::console::log_1(&line.into());
    }
    let (width, height) = prep.params.oriented_size();
    let as_shot = linear::white_balance_for_ratio(&prep.params, [1.0, 1.0, 1.0]).ok();
    let meta = ArwPreparedMeta {
        width,
        height,
        mosaic_width: prep.params.width,
        mosaic_height: prep.params.height,
        samples_per_pixel: 1,
        clip_levels: prep.params.clip_levels,
        kind: "bayer",
        camera_model: prep.params.camera_model.clone(),
        color_approximate: prep.params.colour.is_approximate(),
        color_note: prep.params.colour.note(),
        as_shot_kelvin: as_shot.as_ref().map(|w| w.kelvin),
        as_shot_tint: as_shot.as_ref().map(|w| w.tint),
        not_applied: prep.unhandled,
    };
    let meta_json = to_json(&meta)?;
    let params_json = to_json(&prep.params)?;
    Ok(ArwPrepared { meta_json, params_json, params: prep.params, plane: prep.plane })
}

/// Render plane rows `[srcY0, srcY1)` (passed as `src`) into rows
/// `[y0, y1)`: oriented RGBA f32, unclamped, alpha 1, bit-identical to the
/// same rows of the whole frame. As `dngRenderLinearBand`.
#[wasm_bindgen(js_name = "arwRenderLinearBand")]
pub fn arw_render_linear_band(src: &[f32], params_json: &str, y0: u32, y1: u32, src_y0: u32, src_y1: u32) -> Result<RafRenderedBand, JsError> {
    let params = params_from(params_json)?;
    let out = render_linear_band(src, &params, RafBand { y0, y1, src_y0, src_y1 }).map_err(|e| JsError::new(&e))?;
    Ok(RafRenderedBand { x: out.x, y: out.y, width: out.width, height: out.height, pixels: out.pixels })
}

/// The binned first view of the whole plane (from `takeMosaic`), as
/// `dngRenderBinnedLinear`.
#[wasm_bindgen(js_name = "arwRenderBinnedLinear")]
pub fn arw_render_binned_linear(src: &[f32], params_json: &str, min_long_edge: u32) -> Result<RafRenderedBand, JsError> {
    let params = params_from(params_json)?;
    let (width, height, pixels) = render_binned_linear_for(src, &params, min_long_edge).map_err(|e| JsError::new(&e))?;
    Ok(RafRenderedBand { x: 0, y: 0, width, height, pixels })
}

/// The settings an ARW opens with, as the JSON `setRawDevelop` takes:
/// `wbRatio` `[1, 1, 1]` (as shot), `camToRgb` the file's fixed matrix,
/// `exposureEv` 0, `saturation` 1, the neutral base curve, and
/// `clipLevels`.
#[wasm_bindgen(js_name = "arwDevelopDefaults")]
pub fn arw_develop_defaults(params_json: &str) -> Result<String, JsError> {
    to_json(&linear::develop_defaults(&params_from(params_json)?))
}

/// The white balance for a `wbRatio`, as `dngWhiteBalance`: JSON `{ wbRatio,
/// camToRgb, kelvin, tint, whiteXy }`. An error for a body without measured
/// colour (`colorApproximate` true), whose `camToRgb` does not change.
#[wasm_bindgen(js_name = "arwWhiteBalance")]
pub fn arw_white_balance(params_json: &str, wb_ratio: &[f32]) -> Result<String, JsError> {
    let params = params_from(params_json)?;
    let ratio: [f32; 3] = wb_ratio.try_into().map_err(|_| JsError::new("wbRatio must have three values"))?;
    to_json(&linear::white_balance_for_ratio(&params, ratio).map_err(|e| JsError::new(&e))?)
}

/// The white balance for a colour temperature and tint, as
/// `dngWhiteBalanceKelvin`. An error for a body without measured colour.
#[wasm_bindgen(js_name = "arwWhiteBalanceKelvin")]
pub fn arw_white_balance_kelvin(params_json: &str, kelvin: f32, tint: f32) -> Result<String, JsError> {
    let params = params_from(params_json)?;
    to_json(&linear::white_balance_for_temperature(&params, kelvin, tint).map_err(|e| JsError::new(&e))?)
}
