//! The format-neutral RAW exports (`lopsy_core::raw`): one set of calls for
//! RAF, DNG and Sony ARW. `rawPrepare` runs the whole-frame stage once and
//! describes the file; workers render bands with `rawRenderLinearBand` (or
//! `rawRenderFinishedBand`, RAF's legacy look) from rows of the plane,
//! planned with `rawPlanBands` (or `rawRenderScaledBand` from
//! `rawPlanScaledBands`, for a frame reduced to fit the GPU's textures);
//! the main thread asks `rawWhiteBalance` and
//! `rawTemperatureForKelvin` for the RAW step's white balance in recipe
//! units, and `rawAutoWhiteBalance` for Auto. Every call after
//! `rawPrepare` takes the format id (`"raf"`, `"dng"`, `"arw"`) and that
//! format's own params string, which for a RAF is byte for byte
//! `rafPrepare`'s. Rendered rows come back as a [`RawRenderedBand`]. None
//! of these touch the GPU except `decodeAndUploadRawBaked`. The `raf…`,
//! `dng…` and `arw…` exports stay.

use wasm_bindgen::prelude::*;

use lopsy_core::raw::{self, RawBand, RawBandPixels, RawFormatId};

use crate::Engine;

fn err(e: String) -> JsError {
    JsError::new(&e)
}

fn format_of(format: &str) -> Result<RawFormatId, JsError> {
    RawFormatId::parse(format).map_err(err)
}

/// The RAW format of a file from its header: `"raf"`, `"dng"` or `"arw"`,
/// or `undefined` for anything else. Sony's older SR2 and SRF answer
/// `"arw"`; `rawPrepare` then refuses them with a sentence.
#[wasm_bindgen(js_name = "rawFormatOf")]
pub fn raw_format_of(data: &[u8]) -> Option<String> {
    raw::sniff(data).map(|f| f.as_str().to_string())
}

/// Rows of a rendered RAW picture, from `rawRenderLinearBand`,
/// `rawRenderFinishedBand` or `RawPrepared.binnedLinear`: where they go in
/// the oriented frame (`x`, `y`), their size, and RGBA f32 pixels, moved
/// out once with `takePixels`. The same fields and getters as the RAF
/// exports' `RafRenderedBand`.
#[wasm_bindgen]
pub struct RawRenderedBand {
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    pixels: Vec<f32>,
}

impl From<RawBandPixels> for RawRenderedBand {
    fn from(b: RawBandPixels) -> Self {
        RawRenderedBand { x: b.x, y: b.y, width: b.width, height: b.height, pixels: b.pixels }
    }
}

#[wasm_bindgen]
impl RawRenderedBand {
    #[wasm_bindgen(getter)]
    pub fn x(&self) -> u32 {
        self.x
    }

    #[wasm_bindgen(getter)]
    pub fn y(&self) -> u32 {
        self.y
    }

    #[wasm_bindgen(getter)]
    pub fn width(&self) -> u32 {
        self.width
    }

    #[wasm_bindgen(getter)]
    pub fn height(&self) -> u32 {
        self.height
    }

    /// Moves the RGBA f32 pixels out.
    #[wasm_bindgen(js_name = "takePixels")]
    pub fn take_pixels(&mut self) -> Vec<f32> {
        std::mem::take(&mut self.pixels)
    }
}

/// Result of `rawPrepare`.
#[wasm_bindgen]
pub struct RawPrepared {
    inner: raw::PreparedRaw,
    describe_json: String,
}

#[wasm_bindgen]
impl RawPrepared {
    /// `"raf"`, `"dng"` or `"arw"`: pass it to every later `raw…` call.
    #[wasm_bindgen(getter)]
    pub fn format(&self) -> String {
        self.inner.format.as_str().to_string()
    }

    /// The `RawDescription` as JSON: `{ format, width, height, planeWidth,
    /// planeHeight, samplesPerPixel, clipLevels, cameraModel, colorNote,
    /// notApplied, developDefaults, profiles, whiteBalance: { matrix,
    /// kelvin, presetSource, presets }, finishedBands }` (see
    /// `lopsy_core::raw::RawDescription`). Each profile is `{ id, name,
    /// settings, role, menuName, listed, sameAs, makerStandard }`: a menu
    /// lists the entries whose `listed` is true, in order, under `menuName`
    /// (`lopsy_core::raf::develop::DevelopProfile`).
    #[wasm_bindgen(getter, js_name = "describeJson")]
    pub fn describe_json(&self) -> String {
        self.describe_json.clone()
    }

    /// The format's own render parameters, kept as the string Rust wrote so
    /// every worker gets exactly the same.
    #[wasm_bindgen(getter, js_name = "paramsJson")]
    pub fn params_json(&self) -> String {
        self.inner.params_json.clone()
    }

    /// The binned first view of the plane this still holds (call it before
    /// `takePlane`): linear camera RGB, oriented, x = y = 0.
    #[wasm_bindgen(js_name = "binnedLinear")]
    pub fn binned_linear(&self, min_long_edge: u32) -> Result<RawRenderedBand, JsError> {
        if self.inner.plane().is_empty() {
            return Err(JsError::new("The plane was already taken; call binnedLinear before takePlane"));
        }
        let (width, height, pixels) = self.inner.binned_linear(min_long_edge).map_err(err)?;
        Ok(RawRenderedBand { x: 0, y: 0, width, height, pixels })
    }

    /// Moves the plane out: `planeWidth × planeHeight × samplesPerPixel`
    /// f32, row-major. Rows `[srcY0, srcY1)` of it are `subarray(srcY0 ·
    /// rowLen, srcY1 · rowLen)` with `rowLen = planeWidth · samplesPerPixel`.
    #[wasm_bindgen(js_name = "takePlane")]
    pub fn take_plane(&mut self) -> Vec<f32> {
        self.inner.take_plane()
    }
}

/// Prepare a RAW file of any format. An error is a sentence a person can
/// read; a DNG's starts "DNG cannot open as RAW:", after which a host uses
/// the baked decode.
#[wasm_bindgen(js_name = "rawPrepare")]
pub fn raw_prepare(data: &[u8]) -> Result<RawPrepared, JsError> {
    let inner = raw::prepare(data).map_err(err)?;
    for line in inner.debug_log() {
        web_sys::console::log_1(&line.into());
    }
    let describe_json = serde_json::to_string(&inner.description).map_err(|e| JsError::new(&format!("JSON serialize: {e}")))?;
    Ok(RawPrepared { inner, describe_json })
}

/// Bands for the plane, flattened as `[y0, y1, srcY0, srcY1, …]`.
#[wasm_bindgen(js_name = "rawPlanBands")]
pub fn raw_plan_bands(format: &str, params_json: &str, max_bands: u32) -> Result<Vec<u32>, JsError> {
    let bands = raw::plan_bands(format_of(format)?, params_json, max_bands).map_err(err)?;
    Ok(bands.into_iter().flat_map(|b| [b.y0, b.y1, b.src_y0, b.src_y1]).collect())
}

/// Render plane rows `[srcY0, srcY1)` (passed as `src`) into rows
/// `[y0, y1)` of linear camera RGB at the as-shot white balance: oriented
/// RGBA f32, unclamped, bit-identical to the same rows of the whole frame.
#[wasm_bindgen(js_name = "rawRenderLinearBand")]
pub fn raw_render_linear_band(format: &str, src: &[f32], params_json: &str, y0: u32, y1: u32, src_y0: u32, src_y1: u32) -> Result<RawRenderedBand, JsError> {
    let out = raw::render_linear_band(format_of(format)?, src, params_json, RawBand { y0, y1, src_y0, src_y1 }).map_err(err)?;
    Ok(out.into())
}

/// Bands that render the frame reduced to `dstWidth`×`dstHeight` (each side
/// at most the frame's), for a device whose largest texture is smaller than
/// the frame (`lopsy_core::raw::scaled`), flattened as `[y0, y1, srcY0,
/// srcY1, d0, d1, …]`: plane rows to render, as `rawPlanBands` gives them,
/// and the destination rows (or columns, when the frame is turned a quarter)
/// `[d0, d1)` they make.
#[wasm_bindgen(js_name = "rawPlanScaledBands")]
pub fn raw_plan_scaled_bands(format: &str, params_json: &str, dst_width: u32, dst_height: u32, max_bands: u32) -> Result<Vec<u32>, JsError> {
    let bands = raw::plan_scaled_bands(format_of(format)?, params_json, dst_width, dst_height, max_bands).map_err(err)?;
    Ok(bands.into_iter().flat_map(|s| [s.band.y0, s.band.y1, s.band.src_y0, s.band.src_y1, s.d0, s.d1]).collect())
}

/// One band of `rawPlanScaledBands`: plane rows `[srcY0, srcY1)` (passed as
/// `src`) rendered as `rawRenderLinearBand` renders them (or, with `linear`
/// false, as `rawRenderFinishedBand` does), then reduced by area to
/// destination rows (or columns) `[d0, d1)` of the `dstWidth`×`dstHeight`
/// frame, placed in it (`x`, `y`): oriented RGBA f32, bit-identical to the
/// same pixels of the whole frame reduced.
#[allow(clippy::too_many_arguments)]
#[wasm_bindgen(js_name = "rawRenderScaledBand")]
pub fn raw_render_scaled_band(
    format: &str,
    src: &[f32],
    params_json: &str,
    y0: u32,
    y1: u32,
    src_y0: u32,
    src_y1: u32,
    dst_width: u32,
    dst_height: u32,
    d0: u32,
    d1: u32,
    linear: bool,
) -> Result<RawRenderedBand, JsError> {
    let scaled = raw::ScaledBand { band: RawBand { y0, y1, src_y0, src_y1 }, d0, d1 };
    let out = raw::render_scaled_band(format_of(format)?, src, params_json, scaled, dst_width, dst_height, linear).map_err(err)?;
    Ok(out.into())
}

/// Whether a format renders finished bands (`rawRenderFinishedBand`, RAF's
/// legacy look), from its id alone, before a file is prepared: what that
/// format's description says in `finishedBands`. An error for an id that
/// is not `"raf"`, `"dng"` or `"arw"`.
#[wasm_bindgen(js_name = "rawRendersFinishedBands")]
pub fn raw_renders_finished_bands(format: &str) -> Result<bool, JsError> {
    Ok(raw::renders_finished_bands(format_of(format)?))
}

/// The finished look of a band, for a format whose description has
/// `finishedBands` (RAF); an error for the others, which use
/// `decodeAndUploadRawBaked`.
#[wasm_bindgen(js_name = "rawRenderFinishedBand")]
pub fn raw_render_finished_band(format: &str, src: &[f32], params_json: &str, y0: u32, y1: u32, src_y0: u32, src_y1: u32) -> Result<RawRenderedBand, JsError> {
    let out = raw::render_finished_band(format_of(format)?, src, params_json, RawBand { y0, y1, src_y0, src_y1 }).map_err(err)?;
    Ok(out.into())
}

/// Auto white balance of linear camera RGB of any format (RGBA f32 from
/// `binnedLinear` or `rawRenderLinearBand`): `[r, g, b]` wbRatio
/// multipliers relative to as shot, green = 1. Pixels with a channel at or
/// above 90 % of its clip level are left out (clipped and reconstructed
/// highlights are not measurements of a neutral): `clipLevels` is the
/// description's `clipLevels`, three floats; any other length (or `null`
/// passed as an empty array) measures every pixel. Bit for bit what
/// `rafAutoWhiteBalanceClipped` gives (`lopsy_core::develop_stats`).
#[wasm_bindgen(js_name = "rawAutoWhiteBalance")]
pub fn raw_auto_white_balance(linear_rgba: &[f32], clip_levels: &[f32]) -> Vec<f32> {
    let clip = <[f32; 3]>::try_from(clip_levels).ok();
    lopsy_core::develop_stats::auto_white_balance_clipped(linear_rgba, clip).to_vec()
}

/// The RAW step's white balance for the recipe's Temperature and Tint
/// (relative to as shot, −200..200), as JSON `{ wbRatio, camToRgb,
/// kelvin, tint }`: `wbRatio` for `setRawDevelop`; `camToRgb` the matrix
/// to send with it, or `null` when the matrix is fixed (keep the
/// profile's); `kelvin` and `tint` the white's colour temperature and
/// tint, or `null` when the format has no measured Kelvin.
#[wasm_bindgen(js_name = "rawWhiteBalance")]
pub fn raw_white_balance(format: &str, params_json: &str, temperature: f32, tint: f32) -> Result<String, JsError> {
    let white = raw::white_for_recipe(format_of(format)?, params_json, temperature, tint).map_err(err)?;
    serde_json::to_string(&white).map_err(|e| JsError::new(&format!("JSON serialize: {e}")))
}

/// The recipe Temperature (unrounded, within ±200) whose white reads
/// `kelvin` at the recipe's `tint`, for a format with measured Kelvin; an
/// error for the others (a RAF converts with its description's fitted
/// scale).
#[wasm_bindgen(js_name = "rawTemperatureForKelvin")]
pub fn raw_temperature_for_kelvin(format: &str, params_json: &str, kelvin: f32, tint: f32) -> Result<f32, JsError> {
    raw::temperature_for_kelvin(format_of(format)?, params_json, kelvin, tint).map_err(err)
}

/// Decode any RAW to its finished look, whole-frame, into a layer (the
/// legacy path, and DNG versions edited before DNG took the RAW path).
/// Returns that decode's JSON with `format` added. A picture wider or
/// taller than an editable layer may be (the GPU's largest texture less
/// two pixels, `commands::layer::TRANSFORM_BORDER`) is reduced to fit:
/// `width` and `height` are then the layer's, and `fullWidth` and
/// `fullHeight` the picture's own.
#[wasm_bindgen(js_name = "decodeAndUploadRawBaked")]
pub fn decode_and_upload_raw_baked(engine: &mut Engine, layer_id: &str, data: &[u8]) -> Result<String, JsError> {
    lopsy_engine::commands::layer::decode_and_upload_raw_baked(&mut engine.inner, layer_id, data).map_err(|e| JsError::new(&e))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A frame with a cast, near-neutral greys, saturated colours, noise
    /// and a clipped highlight, all deterministic.
    fn frame() -> Vec<f32> {
        let mut seed = 0x2545_f491u32;
        let mut next = move || {
            seed ^= seed << 13;
            seed ^= seed >> 17;
            seed ^= seed << 5;
            (seed as f32) / (u32::MAX as f32)
        };
        (0..4096)
            .flat_map(|i| {
                let v = next();
                let px = match i % 5 {
                    0 => [0.30 * v + 0.05, 0.25 * v + 0.05, 0.18 * v + 0.04],
                    1 => [0.9 * v, 0.2 * v, 0.1 * v],
                    2 => [1.8, 1.95, 1.4],
                    3 => [0.002 * v, 0.003 * v, 0.001 * v],
                    _ => [0.2 + 0.01 * v, 0.17 + 0.01 * v, 0.12 + 0.01 * v],
                };
                [px[0], px[1], px[2], 1.0]
            })
            .collect()
    }

    #[test]
    fn the_neutral_auto_white_balance_is_the_raf_one_bit_for_bit() {
        let px = frame();
        for clip in [&[1.9f32, 2.0, 1.5][..], &[], &[1.0, 1.0]] {
            let ours = raw_auto_white_balance(&px, clip);
            let raf = super::super::develop::raf_auto_white_balance_clipped(&px, clip);
            assert_eq!(ours.iter().map(|v| v.to_bits()).collect::<Vec<_>>(), raf.iter().map(|v| v.to_bits()).collect::<Vec<_>>(), "{clip:?}");
            assert_eq!(ours.len(), 3);
        }
    }

    #[test]
    fn only_raf_renders_finished_bands() {
        // (An unknown id is an error, which only a wasm target can build.)
        assert!(raw_renders_finished_bands("raf").ok() == Some(true));
        assert!(raw_renders_finished_bands("dng").ok() == Some(false));
        assert!(raw_renders_finished_bands("arw").ok() == Some(false));
    }

    #[test]
    fn a_rendered_band_keeps_its_place_size_and_pixels() {
        let mut band = RawRenderedBand::from(RawBandPixels { x: 3, y: 7, width: 2, height: 1, pixels: vec![0.5; 8] });
        assert_eq!((band.x(), band.y(), band.width(), band.height()), (3, 7, 2, 1));
        assert_eq!(band.take_pixels(), vec![0.5; 8]);
        assert!(band.take_pixels().is_empty());
    }
}
