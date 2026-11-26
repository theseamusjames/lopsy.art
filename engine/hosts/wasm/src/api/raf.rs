//! RAF (Fujifilm RAW) decode API, split so the work can be spread across
//! Web Workers: `rafPrepare` runs the whole-frame stage once, then each
//! worker renders row bands with `rafRenderBand`, and the main thread
//! uploads every band straight into the layer texture with
//! `uploadLayerPixelsF32Rect`. None of these touch the GPU or the engine,
//! so they run in any instance of the module.

use wasm_bindgen::prelude::*;

use lopsy_core::raf::{self, RafBand, RafRenderParams};

/// Result of `rafPrepare`: JSON metadata plus the white-balanced mosaic.
#[wasm_bindgen]
pub struct RafPrepared {
    meta_json: String,
    params_json: String,
    params: RafRenderParams,
    mosaic: Vec<f32>,
}

#[wasm_bindgen]
impl RafPrepared {
    /// `{ width, height, mosaicWidth, mosaicHeight, clipLevels }` — width
    /// and height are the final (oriented) size; `clipLevels` is each
    /// channel's clip level `[r, g, b]` in the linear renders' units.
    #[wasm_bindgen(getter, js_name = "metaJson")]
    pub fn meta_json(&self) -> String {
        self.meta_json.clone()
    }

    /// Render parameters for `rafRenderBand`. Kept as the string Rust wrote
    /// so the floats reach every worker exactly as serialized.
    #[wasm_bindgen(getter, js_name = "paramsJson")]
    pub fn params_json(&self) -> String {
        self.params_json.clone()
    }

    /// `rafRenderBinnedLinear` of the mosaic this still holds, without
    /// copying it out and back in: call it before `takeMosaic`. On a 40 MP
    /// frame that saves two 160 MB copies on the way to the first view.
    #[wasm_bindgen(js_name = "binnedLinear")]
    pub fn binned_linear(&self, min_long_edge: u32) -> Result<RafRenderedBand, JsError> {
        if self.mosaic.is_empty() {
            return Err(JsError::new("The mosaic was already taken; call binnedLinear before takeMosaic"));
        }
        let (width, height, pixels) = raf::develop::render_binned_linear_for(&self.mosaic, &self.params, min_long_edge)
            .map_err(|e| JsError::new(&e))?;
        Ok(RafRenderedBand { x: 0, y: 0, width, height, pixels })
    }

    /// Moves the mosaic out (`mosaicWidth`×`mosaicHeight` f32, row-major).
    #[wasm_bindgen(js_name = "takeMosaic")]
    pub fn take_mosaic(&mut self) -> Vec<f32> {
        std::mem::take(&mut self.mosaic)
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RafPreparedMeta {
    width: u32,
    height: u32,
    mosaic_width: u32,
    mosaic_height: u32,
    /// Each channel's clip level `[r, g, b]` in the linear renders' units
    /// (camera RGB at the as-shot white balance), as `clipLevels` in the
    /// params; `null` when unknown.
    clip_levels: Option<[f32; 3]>,
}

#[wasm_bindgen(js_name = "rafPrepare")]
pub fn raf_prepare(data: &[u8]) -> Result<RafPrepared, JsError> {
    let prep = raf::prepare_raf(data, raf::RafDecodeOpts::default())
        .map_err(|e| JsError::new(&format!("RAF decode failed: {e}")))?;
    for line in &prep.debug_log {
        web_sys::console::log_1(&line.into());
    }
    let (width, height) = prep.params.oriented_size();
    let meta = RafPreparedMeta {
        width,
        height,
        mosaic_width: prep.params.width,
        mosaic_height: prep.params.height,
        clip_levels: prep.params.clip_levels,
    };
    let to_json = |e: serde_json::Error| JsError::new(&format!("JSON serialize: {e}"));
    let meta_json = serde_json::to_string(&meta).map_err(to_json)?;
    let params_json = serde_json::to_string(&prep.params).map_err(to_json)?;
    Ok(RafPrepared { meta_json, params_json, params: prep.params, mosaic: prep.mosaic })
}

/// Bands for a `height`-row mosaic, flattened as
/// `[y0, y1, srcY0, srcY1, y0, y1, …]`.
#[wasm_bindgen(js_name = "rafPlanBands")]
pub fn raf_plan_bands(height: u32, max_bands: u32) -> Vec<u32> {
    raf::plan_bands(height, max_bands)
        .into_iter()
        .flat_map(|b| [b.y0, b.y1, b.src_y0, b.src_y1])
        .collect()
}

/// One rendered, oriented band and where it goes in the final image.
#[wasm_bindgen]
pub struct RafRenderedBand {
    pub(crate) x: u32,
    pub(crate) y: u32,
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) pixels: Vec<f32>,
}

#[wasm_bindgen]
impl RafRenderedBand {
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

/// Render mosaic rows `[srcY0, srcY1)` (passed as `src`) into the final
/// pixels of rows `[y0, y1)`.
#[wasm_bindgen(js_name = "rafRenderBand")]
pub fn raf_render_band(
    src: &[f32],
    params_json: &str,
    y0: u32,
    y1: u32,
    src_y0: u32,
    src_y1: u32,
) -> Result<RafRenderedBand, JsError> {
    let params: RafRenderParams = serde_json::from_str(params_json)
        .map_err(|e| JsError::new(&format!("RAF params: {e}")))?;
    let band = RafBand { y0, y1, src_y0, src_y1 };
    let out = raf::render_band(src, &params, band).map_err(|e| JsError::new(&e))?;
    Ok(RafRenderedBand { x: out.x, y: out.y, width: out.width, height: out.height, pixels: out.pixels })
}

/// Render mosaic rows `[srcY0, srcY1)` (passed as `src`) into rows
/// `[y0, y1)` of linear camera RGB for the develop stage: oriented RGBA f32
/// at the as-shot white balance, unclamped, no tone or gamma. The same band
/// shape as `rafRenderBand`.
#[wasm_bindgen(js_name = "rafRenderLinearBand")]
pub fn raf_render_linear_band(
    src: &[f32],
    params_json: &str,
    y0: u32,
    y1: u32,
    src_y0: u32,
    src_y1: u32,
) -> Result<RafRenderedBand, JsError> {
    let params: RafRenderParams = serde_json::from_str(params_json)
        .map_err(|e| JsError::new(&format!("RAF params: {e}")))?;
    let band = RafBand { y0, y1, src_y0, src_y1 };
    let out = raf::develop::render_linear_band(src, &params, band).map_err(|e| JsError::new(&e))?;
    Ok(RafRenderedBand { x: out.x, y: out.y, width: out.width, height: out.height, pixels: out.pixels })
}

/// A quick first view without demosaicing: the whole mosaic (from
/// `takeMosaic`) binned by the coarsest whole-CFA-unit factor that keeps the
/// long edge at least `minLongEdge` (3 for a 40 MP X-Trans frame and 2048).
/// Linear camera RGB like `rafRenderLinearBand`, so the same `setRawDevelop`
/// settings develop it. x = y = 0; width and height are the reduced,
/// oriented size.
#[wasm_bindgen(js_name = "rafRenderBinnedLinear")]
pub fn raf_render_binned_linear(src: &[f32], params_json: &str, min_long_edge: u32) -> Result<RafRenderedBand, JsError> {
    let params: RafRenderParams = serde_json::from_str(params_json)
        .map_err(|e| JsError::new(&format!("RAF params: {e}")))?;
    let (width, height, pixels) =
        raf::develop::render_binned_linear_for(src, &params, min_long_edge).map_err(|e| JsError::new(&e))?;
    Ok(RafRenderedBand { x: 0, y: 0, width, height, pixels })
}

/// The Profile control's entries as JSON:
/// `[{ "id", "name", "settings": { "camToRgb", "exposureEv", "saturation",
/// "highlightDesaturation", "baseCurve" } }, …]`. `exposureEv` is the
/// baseline; add the user's EV and a `wbRatio` to get `setRawDevelop`'s JSON.
/// Ids: camera, provia, velvia, astia, classic-chrome, pro-neg, neutral,
/// monochrome; `camera` equals `rafDevelopDefaults` without `wbRatio`.
#[wasm_bindgen(js_name = "rafDevelopProfiles")]
pub fn raf_develop_profiles(params_json: &str) -> Result<String, JsError> {
    let params: RafRenderParams = serde_json::from_str(params_json)
        .map_err(|e| JsError::new(&format!("RAF params: {e}")))?;
    serde_json::to_string(&raf::develop::develop_profiles(&params))
        .map_err(|e| JsError::new(&format!("JSON serialize: {e}")))
}

/// The develop settings that reproduce `rafRenderBand`'s look (without its
/// capture sharpening) from `rafRenderLinearBand`'s pixels, as the JSON
/// `setRawDevelop` takes.
#[wasm_bindgen(js_name = "rafDevelopDefaults")]
pub fn raf_develop_defaults(params_json: &str) -> Result<String, JsError> {
    let params: RafRenderParams = serde_json::from_str(params_json)
        .map_err(|e| JsError::new(&format!("RAF params: {e}")))?;
    serde_json::to_string(&raf::develop::develop_defaults(&params))
        .map_err(|e| JsError::new(&format!("JSON serialize: {e}")))
}

/// The camera's white-balance presets, read from `data` (the RAF file), as
/// JSON `[{ "name", "temperature", "tint" }]` in the recipe's units
/// (relative to as shot, clamped to −200..200), in menu order: Daylight,
/// Cloudy, Tungsten, the fluorescents (`raf::wb_presets`). `[]` for a file
/// without an as-shot balance or without the camera's preset table.
#[wasm_bindgen(js_name = "rafWhiteBalancePresets")]
pub fn raf_white_balance_presets(data: &[u8]) -> Result<String, JsError> {
    let (_, as_shot) = raf::read_wb_info(data).map_err(|e| JsError::new(&e))?;
    let camera = raf::wb_presets::read_camera_white_balance(data);
    let presets = as_shot.map(|a| raf::wb_presets::recipe_presets(&camera, a)).unwrap_or_default();
    serde_json::to_string(&presets).map_err(|e| JsError::new(&e.to_string()))
}

/// The Kelvin scale for the recipe's temperature on this frame, fitted
/// through the camera's calibration whites, as JSON
/// `{ "miredAtZero", "miredPerUnit", "asShotKelvin" }` or `null`:
/// `kelvin = 1e6 / (miredAtZero + miredPerUnit · temperature)` and
/// `temperature = (1e6 / kelvin − miredAtZero) / miredPerUnit`.
#[wasm_bindgen(js_name = "rafWhiteBalanceKelvin")]
pub fn raf_white_balance_kelvin(data: &[u8]) -> Result<String, JsError> {
    let (_, as_shot) = raf::read_wb_info(data).map_err(|e| JsError::new(&e))?;
    let camera = raf::wb_presets::read_camera_white_balance(data);
    let scale = as_shot.and_then(|a| raf::wb_presets::kelvin_scale(&camera, a));
    serde_json::to_string(&scale).map_err(|e| JsError::new(&e.to_string()))
}
