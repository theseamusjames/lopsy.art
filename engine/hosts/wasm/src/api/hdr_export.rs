//! The HDR file encoders: a 16-bit BT.2100 PQ PNG, and a JPEG with a gain
//! map (Ultra HDR / ISO 21496-1). None of these touch the GPU or the
//! engine, so they run in any instance of the module, a worker's included.
//!
//! Every picture is row-major from the top-left, four values a pixel
//! (RGBA). The HDR picture is linear light in Rec. 2020 primaries with 1.0
//! at SDR reference white; values above 1.0 are highlights.
//!
//! The PQ PNG is one call: `encodePqPng`.
//!
//! The gain-map JPEG takes four steps, because the browser encodes JPEGs:
//! 1. `computeGainMap(hdr, sdr, …)` with the HDR picture and the same
//!    picture as an ordinary screen shows it (8-bit sRGB or Display P3).
//! 2. Draw the SDR picture on a canvas in its colour space and encode it
//!    with `convertToBlob({ type: 'image/jpeg' })`: the base JPEG.
//! 3. Draw `GainMapResult.rgba` (`width`×`height`, grey) on a canvas and
//!    encode it the same way: the gain map JPEG.
//! 4. `assembleGainMapJpeg(base, gainMap, result.metadata)` gives the file.

use wasm_bindgen::prelude::*;

use lopsy_core::gain_map::{self, GainMapMetadata, GainMapScale};
use lopsy_engine::commands::export::color_space_from_code;

/// A 16-bit PNG in BT.2100 PQ with `cICP`, `mDCV` and `cLLI`.
///
/// - `pixels`: `width * height * 4` f32 (a `Float32Array`): RGBA, linear
///   Rec. 2020, 1.0 = SDR white. Alpha is straight, 0..1; the file is RGB
///   when every pixel is opaque.
/// - `sdr_white_nits`: the luminance SDR white is given, in cd/m²; pass
///   203 (ITU-R BT.2408) unless there is a reason not to.
///
/// Returns the PNG file's bytes.
#[wasm_bindgen(js_name = "encodePqPng")]
pub fn encode_pq_png(pixels: &[f32], width: u32, height: u32, sdr_white_nits: f32) -> Result<Vec<u8>, JsError> {
    lopsy_core::hdr_png::encode_pq_png(pixels, width, height, sdr_white_nits).map_err(|e| JsError::new(&e))
}

/// Result of `computeGainMap`.
#[wasm_bindgen]
pub struct GainMapResult {
    width: u32,
    height: u32,
    rgba: Vec<u8>,
    metadata: GainMapMetadata,
}

#[wasm_bindgen]
impl GainMapResult {
    /// The gain map's width in pixels: the picture's, or half of it rounded up.
    #[wasm_bindgen(getter)]
    pub fn width(&self) -> u32 {
        self.width
    }

    /// The gain map's height in pixels.
    #[wasm_bindgen(getter)]
    pub fn height(&self) -> u32 {
        self.height
    }

    /// The gain map as `width * height * 4` bytes of RGBA, grey (R = G =
    /// B) and opaque, ready for an `ImageData`.
    #[wasm_bindgen(js_name = "takeRgba")]
    pub fn take_rgba(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.rgba)
    }

    /// Seven numbers (a `Float64Array`) to pass to `assembleGainMapJpeg`
    /// unchanged: gain map min and max (log2), gamma, offset SDR, offset
    /// HDR (linear, in units of SDR white), HDR capacity min and max (log2).
    #[wasm_bindgen(getter)]
    pub fn metadata(&self) -> Vec<f64> {
        self.metadata.to_values().to_vec()
    }
}

/// The gain map that takes the SDR picture to the HDR one.
///
/// - `hdr`: `width * height * 4` f32 (a `Float32Array`): RGBA, linear
///   Rec. 2020, 1.0 = SDR white. Alpha is ignored.
/// - `sdr`: `width * height * 4` bytes (a `Uint8Array`): RGBA, the same
///   picture for an ordinary screen, encoded in `sdr_space` (0 sRGB, 1
///   Display P3). Alpha is ignored.
/// - `scale`: 1 for a full-size map, 2 for half the width and height.
#[wasm_bindgen(js_name = "computeGainMap")]
pub fn compute_gain_map(
    hdr: &[f32],
    sdr: &[u8],
    width: u32,
    height: u32,
    sdr_space: u8,
    scale: u32,
) -> Result<GainMapResult, JsError> {
    let space = color_space_from_code(sdr_space).map_err(|e| JsError::new(&e))?;
    let scale = GainMapScale::from_divisor(scale).map_err(|e| JsError::new(&e))?;
    let map = gain_map::compute_gain_map(hdr, sdr, width, height, space, scale).map_err(|e| JsError::new(&e))?;
    Ok(GainMapResult { width: map.width, height: map.height, rgba: map.rgba, metadata: map.metadata })
}

/// The gain-map JPEG file from its two encoded JPEGs.
///
/// - `base`: the SDR picture as a JPEG file (a `Uint8Array`). Its ICC
///   profile, JFIF and Exif segments are kept.
/// - `gain_map`: the gain map (`GainMapResult.takeRgba`) as a JPEG file.
/// - `metadata`: `GainMapResult.metadata`, the seven numbers unchanged.
///
/// Returns the file's bytes, or an error if either JPEG is malformed or
/// the metadata is out of range.
#[wasm_bindgen(js_name = "assembleGainMapJpeg")]
pub fn assemble_gain_map_jpeg(base: &[u8], gain_map: &[u8], metadata: &[f64]) -> Result<Vec<u8>, JsError> {
    let metadata = GainMapMetadata::from_values(metadata).map_err(|e| JsError::new(&e))?;
    lopsy_core::gain_map_jpeg::assemble_gain_map_jpeg(base, gain_map, &metadata).map_err(|e| JsError::new(&e))
}
