//! wasm-bindgen exports for `commands::psd`. Each converts its arguments
//! and calls the one function of the same name there.

use wasm_bindgen::prelude::*;

use crate::readback::{readback_export, task};
use crate::Engine;

readback_export! {
    #[wasm_bindgen(js_name = "exportPsd")]
    pub fn export_psd(
        engine,
        layers_json: &str,
        mask_data: &[u8],
        depth: u8,
        color_space: u8,
        color_mode: u8,
    ) -> Result<Vec<u8>> {
        let (layers_json, mask_data) = (layers_json.to_string(), mask_data.to_vec());
        task(|cx| lopsy_engine::commands::psd::export_psd(cx, layers_json, mask_data, depth, color_space, color_mode))
    }
}

#[wasm_bindgen(js_name = "parsePsd")]
pub fn parse_psd(data: &[u8]) -> Result<String, JsError> {
    lopsy_engine::commands::psd::parse_psd(data).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "decodeAndUploadPsdLayer")]
pub fn decode_and_upload_psd_layer(
    engine: &mut Engine,
    layer_id: &str,
    data: &[u8],
    layer_index: u32,
) -> Result<(), JsError> {
    lopsy_engine::commands::psd::decode_and_upload_psd_layer(&mut engine.inner, layer_id, data, layer_index).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "getPsdLayerMask")]
pub fn get_psd_layer_mask(data: &[u8], layer_index: u32) -> Result<Vec<u8>, JsError> {
    lopsy_engine::commands::psd::get_psd_layer_mask(data, layer_index).map_err(|e| JsError::new(&e))
}
