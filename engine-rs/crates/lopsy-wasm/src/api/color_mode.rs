//! wasm-bindgen exports for `commands::color_mode`. Each converts its arguments
//! and calls the one function of the same name there.

use wasm_bindgen::prelude::*;

use crate::Engine;

#[wasm_bindgen(js_name = "convertLayerToGrayscale")]
pub fn convert_layer_to_grayscale(engine: &mut Engine, layer_id: &str) {
    crate::commands::color_mode::convert_layer_to_grayscale(&mut engine.inner, layer_id)
}

#[wasm_bindgen(js_name = "convertLayerToLab")]
pub fn convert_layer_to_lab(engine: &mut Engine, layer_id: &str) -> Result<(), JsError> {
    crate::commands::color_mode::convert_layer_to_lab(&mut engine.inner, layer_id).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "convertLayerFromLab")]
pub fn convert_layer_from_lab(engine: &mut Engine, layer_id: &str) -> Result<(), JsError> {
    crate::commands::color_mode::convert_layer_from_lab(&mut engine.inner, layer_id).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "bakeCmykGamut")]
pub fn bake_cmyk_gamut(engine: &mut Engine, layer_id: &str) -> Result<(), JsError> {
    crate::commands::color_mode::bake_cmyk_gamut(&mut engine.inner, layer_id).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "quantizeCompositeToPalette")]
pub fn quantize_composite_to_palette(engine: &mut Engine, max_colors: u32) -> Result<Vec<u8>, JsError> {
    crate::commands::color_mode::quantize_composite_to_palette(&mut engine.inner, max_colors).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "applyPaletteToLayer")]
pub fn apply_palette_to_layer(
    engine: &mut Engine,
    layer_id: &str,
    palette: &[u8],
    dither: bool,
) -> Result<(), JsError> {
    crate::commands::color_mode::apply_palette_to_layer(&mut engine.inner, layer_id, palette, dither).map_err(|e| JsError::new(&e))
}
