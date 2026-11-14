//! wasm-bindgen exports for `commands::layer`. Each converts its arguments
//! and calls the one function of the same name there.

use wasm_bindgen::prelude::*;
use web_sys::HtmlCanvasElement;

use crate::Engine;

#[wasm_bindgen(js_name = "addLayer")]
pub fn add_layer(engine: &mut Engine, layer_desc_json: &str) -> Result<(), JsError> {
    lopsy_engine::commands::layer::add_layer(&mut engine.inner, layer_desc_json).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "removeLayer")]
pub fn remove_layer(engine: &mut Engine, layer_id: &str) {
    lopsy_engine::commands::layer::remove_layer(&mut engine.inner, layer_id)
}

#[wasm_bindgen(js_name = "updateLayer")]
pub fn update_layer(engine: &mut Engine, layer_desc_json: &str) -> Result<(), JsError> {
    lopsy_engine::commands::layer::update_layer(&mut engine.inner, layer_desc_json).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "setLayerOrder")]
pub fn set_layer_order(engine: &mut Engine, order_json: &str) -> Result<(), JsError> {
    lopsy_engine::commands::layer::set_layer_order(&mut engine.inner, order_json).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "flattenIntoLayer")]
pub fn flatten_into_layer(engine: &mut Engine, layer_id: &str) -> Result<(), JsError> {
    lopsy_engine::commands::layer::flatten_into_layer(&mut engine.inner, layer_id).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "uploadLayerPixels")]
pub fn upload_layer_pixels(
    engine: &mut Engine,
    layer_id: &str,
    data: &[u8],
    width: u32,
    height: u32,
    offset_x: i32,
    offset_y: i32,
) -> Result<(), JsError> {
    lopsy_engine::commands::layer::upload_layer_pixels(&mut engine.inner, layer_id, data, width, height, offset_x, offset_y).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "uploadLayerPixelsFromCanvas")]
pub fn upload_layer_pixels_from_canvas(
    engine: &mut Engine,
    layer_id: &str,
    canvas: &HtmlCanvasElement,
    width: u32,
    height: u32,
) -> Result<(), JsError> {
    lopsy_engine::commands::layer::upload_layer_pixels_from_canvas(&mut engine.inner, layer_id, canvas, width, height).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "readLayerPixels")]
pub fn read_layer_pixels(engine: &Engine, layer_id: &str) -> Result<Vec<u8>, JsError> {
    lopsy_engine::commands::layer::read_layer_pixels(&engine.inner, layer_id).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "decodeAndUploadImage")]
pub fn decode_and_upload_image(engine: &mut Engine, layer_id: &str, data: &[u8]) -> Vec<u32> {
    lopsy_engine::commands::layer::decode_and_upload_image(&mut engine.inner, layer_id, data)
}

#[wasm_bindgen(js_name = "decodeAndUploadDng")]
pub fn decode_and_upload_dng(engine: &mut Engine, layer_id: &str, data: &[u8]) -> Result<String, JsError> {
    lopsy_engine::commands::layer::decode_and_upload_dng(&mut engine.inner, layer_id, data).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "uploadLayerPixelsF32Rect")]
#[allow(clippy::too_many_arguments)]
pub fn upload_layer_pixels_f32_rect(
    engine: &mut Engine,
    layer_id: &str,
    texture_width: u32,
    texture_height: u32,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    data: &[f32],
) -> Result<(), JsError> {
    lopsy_engine::commands::layer::upload_layer_pixels_f32_rect(&mut engine.inner, layer_id, texture_width, texture_height, x, y, width, height, data).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "uploadLayerSparsePixels")]
pub fn upload_layer_sparse_pixels(
    engine: &mut Engine,
    layer_id: &str,
    indices: &[u32],
    rgba: &[u8],
    sparse_width: u32,
    sparse_height: u32,
    offset_x: i32,
    offset_y: i32,
) -> Result<(), JsError> {
    lopsy_engine::commands::layer::upload_layer_sparse_pixels(&mut engine.inner, layer_id, indices, rgba, sparse_width, sparse_height, offset_x, offset_y).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "uploadLayerMask")]
pub fn upload_layer_mask(engine: &mut Engine, layer_id: &str, mask_data: &[u8], width: u32, height: u32) {
    lopsy_engine::commands::layer::upload_layer_mask(&mut engine.inner, layer_id, mask_data, width, height)
}

#[wasm_bindgen(js_name = "removeLayerMask")]
pub fn remove_layer_mask(engine: &mut Engine, layer_id: &str) {
    lopsy_engine::commands::layer::remove_layer_mask(&mut engine.inner, layer_id)
}

#[wasm_bindgen(js_name = "getLayerTextureDimensions")]
pub fn get_layer_texture_dimensions(engine: &Engine, layer_id: &str) -> Vec<u32> {
    lopsy_engine::commands::layer::get_layer_texture_dimensions(&engine.inner, layer_id)
}

#[wasm_bindgen(js_name = "layerContentGeneration")]
pub fn layer_content_generation(engine: &Engine, layer_id: &str) -> f64 {
    lopsy_engine::commands::layer::layer_content_generation(&engine.inner, layer_id)
}

#[wasm_bindgen(js_name = "getLayerEngineBounds")]
pub fn get_layer_engine_bounds(engine: &Engine, layer_id: &str) -> Vec<i32> {
    lopsy_engine::commands::layer::get_layer_engine_bounds(&engine.inner, layer_id)
}

#[wasm_bindgen(js_name = "getLayerContentBounds")]
pub fn get_layer_content_bounds(engine: &mut Engine, layer_id: &str) -> Vec<i32> {
    lopsy_engine::commands::layer::get_layer_content_bounds(&mut engine.inner, layer_id)
}

#[wasm_bindgen(js_name = "bakeLayerEffects")]
pub fn bake_layer_effects(engine: &mut Engine, layer_id: &str, bake_mask: bool) -> Result<(), JsError> {
    lopsy_engine::commands::layer::bake_layer_effects(&mut engine.inner, layer_id, bake_mask).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "duplicateLayerTexture")]
pub fn duplicate_layer_texture(engine: &mut Engine, src_id: &str, dst_id: &str) -> Result<(), JsError> {
    lopsy_engine::commands::layer::duplicate_layer_texture(&mut engine.inner, src_id, dst_id).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "mergeLayers")]
pub fn merge_layers(
    engine: &mut Engine,
    top_id: &str,
    bottom_id: &str,
    bake_bottom_opacity: bool,
) -> Result<Vec<i32>, JsError> {
    lopsy_engine::commands::layer::merge_layers(&mut engine.inner, top_id, bottom_id, bake_bottom_opacity).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "flipLayer")]
pub fn flip_layer(engine: &mut Engine, layer_id: &str, horizontal: bool) -> Result<(), JsError> {
    lopsy_engine::commands::layer::flip_layer(&mut engine.inner, layer_id, horizontal).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "rotateLayer90")]
pub fn rotate_layer_90(engine: &mut Engine, layer_id: &str, clockwise: bool) -> Result<(), JsError> {
    lopsy_engine::commands::layer::rotate_layer_90(&mut engine.inner, layer_id, clockwise).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "scaleLayerTexture")]
pub fn scale_layer_texture(engine: &mut Engine, layer_id: &str, new_w: u32, new_h: u32) -> Result<(), JsError> {
    lopsy_engine::commands::layer::scale_layer_texture(&mut engine.inner, layer_id, new_w, new_h).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "remapLayerMask")]
pub fn remap_layer_mask(
    engine: &mut Engine,
    layer_id: &str,
    dst_w: u32,
    dst_h: u32,
    a: f32,
    b: f32,
    c: f32,
    d: f32,
    e: f32,
    f: f32,
) -> Result<(), JsError> {
    lopsy_engine::commands::layer::remap_layer_mask(&mut engine.inner, layer_id, dst_w, dst_h, a, b, c, d, e, f).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "resizeCanvasTexture")]
pub fn resize_canvas_texture(
    engine: &mut Engine,
    layer_id: &str,
    old_layer_x: i32,
    old_layer_y: i32,
    old_w: u32,
    old_h: u32,
    new_w: u32,
    new_h: u32,
    offset_x: i32,
    offset_y: i32,
) -> Result<(), JsError> {
    lopsy_engine::commands::layer::resize_canvas_texture(&mut engine.inner, layer_id, old_layer_x, old_layer_y, old_w, old_h, new_w, new_h, offset_x, offset_y).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "cropLayerTexture")]
pub fn crop_layer_texture(
    engine: &mut Engine,
    layer_id: &str,
    layer_x: i32,
    layer_y: i32,
    crop_x: i32,
    crop_y: i32,
    crop_w: u32,
    crop_h: u32,
) -> Result<(), JsError> {
    lopsy_engine::commands::layer::crop_layer_texture(&mut engine.inner, layer_id, layer_x, layer_y, crop_x, crop_y, crop_w, crop_h).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "expandLayerToDocSize")]
pub fn expand_layer_to_doc_size(engine: &mut Engine, layer_id: &str) -> Vec<f64> {
    lopsy_engine::commands::layer::expand_layer_to_doc_size(&mut engine.inner, layer_id)
}

#[wasm_bindgen(js_name = "cropLayerToContent")]
pub fn crop_layer_to_content(
    engine: &mut Engine,
    layer_id: &str,
    content_x: i32,
    content_y: i32,
    content_width: u32,
    content_height: u32,
) -> Vec<f64> {
    lopsy_engine::commands::layer::crop_layer_to_content(&mut engine.inner, layer_id, content_x, content_y, content_width, content_height)
}

#[wasm_bindgen(js_name = "clipboardCopy")]
pub fn clipboard_copy(
    engine: &mut Engine,
    layer_id: &str,
    has_selection: bool,
    bounds_x: i32,
    bounds_y: i32,
    bounds_w: u32,
    bounds_h: u32,
) -> Result<Vec<i32>, JsError> {
    lopsy_engine::commands::layer::clipboard_copy(&mut engine.inner, layer_id, has_selection, bounds_x, bounds_y, bounds_w, bounds_h).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "clipboardCopyMerged")]
pub fn clipboard_copy_merged(
    engine: &mut Engine,
    has_selection: bool,
    bounds_x: i32,
    bounds_y: i32,
    bounds_w: u32,
    bounds_h: u32,
) -> Result<Vec<i32>, JsError> {
    lopsy_engine::commands::layer::clipboard_copy_merged(&mut engine.inner, has_selection, bounds_x, bounds_y, bounds_w, bounds_h)
        .map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "clipboardCut")]
pub fn clipboard_cut(
    engine: &mut Engine,
    layer_id: &str,
    has_selection: bool,
    bounds_x: i32,
    bounds_y: i32,
    bounds_w: u32,
    bounds_h: u32,
) -> Result<Vec<i32>, JsError> {
    lopsy_engine::commands::layer::clipboard_cut(&mut engine.inner, layer_id, has_selection, bounds_x, bounds_y, bounds_w, bounds_h).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "clearSelectedPixels")]
pub fn clear_selected_pixels(engine: &mut Engine, layer_id: &str, has_selection: bool) -> Result<(), JsError> {
    lopsy_engine::commands::layer::clear_selected_pixels(&mut engine.inner, layer_id, has_selection).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "clipboardPaste")]
pub fn clipboard_paste(engine: &mut Engine, dst_layer_id: &str) -> Result<(), JsError> {
    lopsy_engine::commands::layer::clipboard_paste(&mut engine.inner, dst_layer_id).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "readClipboardPixels")]
pub fn read_clipboard_pixels(engine: &Engine) -> Result<Vec<u8>, JsError> {
    lopsy_engine::commands::layer::read_clipboard_pixels(&engine.inner).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "uploadClipboardPixels")]
pub fn upload_clipboard_pixels(
    engine: &mut Engine,
    data: &[u8],
    width: u32,
    height: u32,
    offset_x: i32,
    offset_y: i32,
) -> Result<(), JsError> {
    lopsy_engine::commands::layer::upload_clipboard_pixels(&mut engine.inner, data, width, height, offset_x, offset_y).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "floatSelection")]
pub fn float_selection(engine: &mut Engine, layer_id: &str) -> Result<Vec<f64>, JsError> {
    lopsy_engine::commands::layer::float_selection(&mut engine.inner, layer_id).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "restoreFloatBase")]
pub fn restore_float_base(engine: &mut Engine, src_id: &str) -> Result<(), JsError> {
    lopsy_engine::commands::layer::restore_float_base(&mut engine.inner, src_id).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "compositeFloat")]
pub fn composite_float(engine: &mut Engine, dx: i32, dy: i32) -> Result<(), JsError> {
    lopsy_engine::commands::layer::composite_float(&mut engine.inner, dx, dy).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "dropFloat")]
pub fn drop_float(engine: &mut Engine) {
    lopsy_engine::commands::layer::drop_float(&mut engine.inner)
}

#[wasm_bindgen(js_name = "ensureFloatCovers")]
pub fn ensure_float_covers(engine: &mut Engine, x: i32, y: i32, w: u32, h: u32) -> Result<Vec<i32>, JsError> {
    lopsy_engine::commands::layer::ensure_float_covers(&mut engine.inner, x, y, w, h).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "hasFloat")]
pub fn has_float(engine: &Engine) -> bool {
    lopsy_engine::commands::layer::has_float(&engine.inner)
}

#[wasm_bindgen(js_name = "beginLayerTransform")]
pub fn begin_layer_transform(
    engine: &mut Engine,
    layer_id: &str,
    content_x: i32,
    content_y: i32,
    content_width: u32,
    content_height: u32,
) -> Result<Vec<i32>, JsError> {
    lopsy_engine::commands::layer::begin_layer_transform(&mut engine.inner, layer_id, content_x, content_y, content_width, content_height).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "prepareLayerTransformTarget")]
pub fn prepare_layer_transform_target(
    engine: &mut Engine,
    layer_id: &str,
    x: i32,
    y: i32,
    w: u32,
    h: u32,
) -> Result<Vec<i32>, JsError> {
    lopsy_engine::commands::layer::prepare_layer_transform_target(&mut engine.inner, layer_id, x, y, w, h).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "compositeLayerTransformAffine")]
pub fn composite_layer_transform_affine(
    engine: &mut Engine,
    inv_matrix: &[f32],
    src_center_x: f32,
    src_center_y: f32,
    dst_center_x: f32,
    dst_center_y: f32,
) -> Result<(), JsError> {
    lopsy_engine::commands::layer::composite_layer_transform_affine(&mut engine.inner, inv_matrix, src_center_x, src_center_y, dst_center_x, dst_center_y).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "compositeLayerTransformPerspective")]
pub fn composite_layer_transform_perspective(
    engine: &mut Engine,
    corners: &[f32],
    orig_x: f32,
    orig_y: f32,
    orig_w: f32,
    orig_h: f32,
) -> Result<(), JsError> {
    lopsy_engine::commands::layer::composite_layer_transform_perspective(&mut engine.inner, corners, orig_x, orig_y, orig_w, orig_h).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "hasLayerTransform")]
pub fn has_layer_transform(engine: &Engine) -> bool {
    lopsy_engine::commands::layer::has_layer_transform(&engine.inner)
}

#[wasm_bindgen(js_name = "compositeFloatAffine")]
pub fn composite_float_affine(
    engine: &mut Engine,
    inv_matrix: &[f32],
    src_center_x: f32,
    src_center_y: f32,
    dst_center_x: f32,
    dst_center_y: f32,
    src_width: f32,
    src_height: f32,
) -> Result<(), JsError> {
    lopsy_engine::commands::layer::composite_float_affine(&mut engine.inner, inv_matrix, src_center_x, src_center_y, dst_center_x, dst_center_y, src_width, src_height).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "compositeFloatPerspective")]
pub fn composite_float_perspective(
    engine: &mut Engine,
    corners: &[f32],
    orig_x: f32,
    orig_y: f32,
    orig_w: f32,
    orig_h: f32,
) -> Result<(), JsError> {
    lopsy_engine::commands::layer::composite_float_perspective(&mut engine.inner, corners, orig_x, orig_y, orig_w, orig_h).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "fillWithColor")]
pub fn fill_with_color(
    engine: &mut Engine,
    layer_id: &str,
    r: f32,
    g: f32,
    b: f32,
    a: f32,
) -> Result<(), JsError> {
    lopsy_engine::commands::layer::fill_with_color(&mut engine.inner, layer_id, r, g, b, a).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "fillLayerFrame")]
#[allow(clippy::too_many_arguments)]
pub fn fill_layer_frame(
    engine: &mut Engine,
    layer_id: &str,
    r: f32,
    g: f32,
    b: f32,
    a: f32,
    hole_x: i32,
    hole_y: i32,
    hole_w: u32,
    hole_h: u32,
) -> Result<(), JsError> {
    lopsy_engine::commands::layer::fill_layer_frame(&mut engine.inner, layer_id, r, g, b, a, hole_x, hole_y, hole_w, hole_h).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "fillMaskWithValue")]
pub fn fill_mask_with_value(engine: &mut Engine, layer_id: &str, value: f32) -> Result<(), JsError> {
    lopsy_engine::commands::layer::fill_mask_with_value(&mut engine.inner, layer_id, value).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "uploadLayerPixelsCompressed")]
pub fn upload_layer_pixels_compressed(
    engine: &mut Engine,
    layer_id: &str,
    compressed: &[u8],
) -> Result<(), JsError> {
    lopsy_engine::commands::layer::upload_layer_pixels_compressed(&mut engine.inner, layer_id, compressed).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "readLayerPixelsLz4U16")]
pub fn read_layer_pixels_lz4_u16(engine: &Engine, layer_id: &str) -> Vec<u8> {
    lopsy_engine::commands::layer::read_layer_pixels_lz4_u16(&engine.inner, layer_id)
}

#[wasm_bindgen(js_name = "uploadLayerPixelsCompressedU16")]
pub fn upload_layer_pixels_compressed_u16(
    engine: &mut Engine,
    layer_id: &str,
    compressed: &[u8],
) -> Result<(), JsError> {
    lopsy_engine::commands::layer::upload_layer_pixels_compressed_u16(&mut engine.inner, layer_id, compressed).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "readLayerThumbnail")]
pub fn read_layer_thumbnail(engine: &Engine, layer_id: &str, max_size: u32) -> Vec<u8> {
    lopsy_engine::commands::layer::read_layer_thumbnail(&engine.inner, layer_id, max_size)
}

#[wasm_bindgen(js_name = "readCompositeThumbnail")]
pub fn read_composite_thumbnail(engine: &Engine, max_size: u32) -> Vec<u8> {
    lopsy_engine::commands::layer::read_composite_thumbnail(&engine.inner, max_size)
}

#[wasm_bindgen(js_name = "snapshotLayerGpu")]
pub fn snapshot_layer_gpu(engine: &mut Engine, layer_id: &str) -> u32 {
    lopsy_engine::commands::layer::snapshot_layer_gpu(&mut engine.inner, layer_id)
}

#[wasm_bindgen(js_name = "restoreFromGpuSnapshot")]
pub fn restore_from_gpu_snapshot(engine: &mut Engine, layer_id: &str, snap_id: u32) -> Result<(), JsError> {
    lopsy_engine::commands::layer::restore_from_gpu_snapshot(&mut engine.inner, layer_id, snap_id).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "snapshotMaskGpu")]
pub fn snapshot_mask_gpu(engine: &mut Engine, layer_id: &str) -> u32 {
    lopsy_engine::commands::layer::snapshot_mask_gpu(&mut engine.inner, layer_id)
}

#[wasm_bindgen(js_name = "restoreMaskFromGpuSnapshot")]
pub fn restore_mask_from_gpu_snapshot(
    engine: &mut Engine,
    layer_id: &str,
    snap_id: u32,
) -> Result<(), JsError> {
    lopsy_engine::commands::layer::restore_mask_from_gpu_snapshot(&mut engine.inner, layer_id, snap_id).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "releaseGpuSnapshot")]
pub fn release_gpu_snapshot(engine: &mut Engine, snap_id: u32) {
    lopsy_engine::commands::layer::release_gpu_snapshot(&mut engine.inner, snap_id)
}

#[wasm_bindgen(js_name = "clearGpuSnapshots")]
pub fn clear_gpu_snapshots(engine: &mut Engine) {
    lopsy_engine::commands::layer::clear_gpu_snapshots(&mut engine.inner)
}

#[wasm_bindgen(js_name = "liveGpuSnapshotCount")]
pub fn live_gpu_snapshot_count(engine: &Engine) -> u32 {
    lopsy_engine::commands::layer::live_gpu_snapshot_count(&engine.inner)
}

#[wasm_bindgen(js_name = "effectCacheStats")]
pub fn effect_cache_stats(engine: &Engine) -> Vec<f64> {
    lopsy_engine::commands::layer::effect_cache_stats(&engine.inner)
}
