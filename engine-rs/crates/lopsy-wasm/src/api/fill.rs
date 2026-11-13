//! wasm-bindgen exports for `commands::fill`. Each converts its arguments
//! and calls the one function of the same name there.

use wasm_bindgen::prelude::*;

use crate::Engine;

#[wasm_bindgen(js_name = "bucketFillSolid")]
pub fn bucket_fill_solid(
    engine: &mut Engine,
    layer_id: &str,
    fill_r: f32,
    fill_g: f32,
    fill_b: f32,
    fill_a: f32,
    selection_mask: Option<Vec<u8>>,
    sel_w: u32,
    sel_h: u32,
) {
    crate::commands::fill::bucket_fill_solid(&mut engine.inner, layer_id, fill_r, fill_g, fill_b, fill_a, selection_mask, sel_w, sel_h)
}

#[wasm_bindgen(js_name = "bucketFillByColorGpu")]
pub fn bucket_fill_by_color_gpu(
    engine: &mut Engine,
    layer_id: &str,
    doc_x: i32,
    doc_y: i32,
    fill_r: f32,
    fill_g: f32,
    fill_b: f32,
    fill_a: f32,
    tolerance: f32,
    selection_mask: Option<Vec<u8>>,
    sel_w: u32,
    sel_h: u32,
) {
    crate::commands::fill::bucket_fill_by_color_gpu(&mut engine.inner, layer_id, doc_x, doc_y, fill_r, fill_g, fill_b, fill_a, tolerance, selection_mask, sel_w, sel_h)
}

#[wasm_bindgen(js_name = "floodFill")]
pub fn flood_fill(
    pixel_data: &[u8],
    width: u32,
    height: u32,
    start_x: u32,
    start_y: u32,
    _fill_r: u8,
    _fill_g: u8,
    _fill_b: u8,
    _fill_a: u8,
    tolerance: u32,
    contiguous: bool,
) -> Vec<u8> {
    crate::commands::fill::flood_fill(pixel_data, width, height, start_x, start_y, _fill_r, _fill_g, _fill_b, _fill_a, tolerance, contiguous)
}

#[wasm_bindgen(js_name = "floodFillGraduated")]
pub fn flood_fill_graduated(
    pixel_data: &[u8],
    width: u32,
    height: u32,
    start_x: u32,
    start_y: u32,
    tolerance: u32,
    contiguous: bool,
) -> Vec<u8> {
    crate::commands::fill::flood_fill_graduated(pixel_data, width, height, start_x, start_y, tolerance, contiguous)
}

#[wasm_bindgen(js_name = "applyFillToLayer")]
pub fn apply_fill_to_layer(
    engine: &mut Engine,
    layer_id: &str,
    fill_r: f32,
    fill_g: f32,
    fill_b: f32,
    fill_a: f32,
    mask: &[u8],
    width: u32,
    height: u32,
) {
    crate::commands::fill::apply_fill_to_layer(&mut engine.inner, layer_id, fill_r, fill_g, fill_b, fill_a, mask, width, height)
}

#[wasm_bindgen(js_name = "readLayerPixelsForFill")]
pub fn read_layer_pixels_for_fill(engine: &Engine, layer_id: &str) -> Result<Vec<u8>, JsError> {
    crate::commands::fill::read_layer_pixels_for_fill(&engine.inner, layer_id).map_err(|e| JsError::new(&e))
}
