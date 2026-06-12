//! Layer API: add/remove/update, pixel upload (dense + sparse + compressed),
//! mask upload, and the GPU-only operations (duplicate, merge, flip, rotate,
//! scale, resize canvas, crop, fill, clipboard copy/cut/paste, floating
//! selection, thumbnail readback).
//!
//! Each function is a thin `#[wasm_bindgen]` wrapper over `layer_manager`
//! (or specific helpers in `lopsy_core`). The grouping matches the
//! "layers" mental model: anything
//! you do *to* a layer — and the layer-bound clipboard/float state that's
//! logically a bolted-on layer feature — lives here.

use wasm_bindgen::prelude::*;
use web_sys::HtmlCanvasElement;

use lopsy_core::layer::LayerDesc;

use crate::{Engine, compositor, layer_manager};

// ============================================================
// Layer Management
// ============================================================

#[wasm_bindgen(js_name = "addLayer")]
pub fn add_layer(engine: &mut Engine, layer_desc_json: &str) -> Result<(), JsError> {
    let desc: LayerDesc = serde_json::from_str(layer_desc_json)
        .map_err(|e| JsError::new(&format!("Invalid layer JSON: {e}")))?;
    layer_manager::add_layer(&mut engine.inner, desc).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "removeLayer")]
pub fn remove_layer(engine: &mut Engine, layer_id: &str) {
    layer_manager::remove_layer(&mut engine.inner, layer_id);
}

#[wasm_bindgen(js_name = "updateLayer")]
pub fn update_layer(engine: &mut Engine, layer_desc_json: &str) -> Result<(), JsError> {
    let desc: LayerDesc = serde_json::from_str(layer_desc_json)
        .map_err(|e| JsError::new(&format!("Invalid layer JSON: {e}")))?;
    layer_manager::update_layer(&mut engine.inner, desc);
    Ok(())
}

#[wasm_bindgen(js_name = "setLayerOrder")]
pub fn set_layer_order(engine: &mut Engine, order_json: &str) -> Result<(), JsError> {
    let order: Vec<String> = serde_json::from_str(order_json)
        .map_err(|e| JsError::new(&format!("Invalid order JSON: {e}")))?;
    layer_manager::set_layer_order(&mut engine.inner, &order);
    Ok(())
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
    layer_manager::upload_pixels(&mut engine.inner, layer_id, data, width, height, offset_x, offset_y)
        .map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "uploadLayerPixelsFromCanvas")]
pub fn upload_layer_pixels_from_canvas(
    engine: &mut Engine,
    layer_id: &str,
    canvas: &HtmlCanvasElement,
    width: u32,
    height: u32,
) -> Result<(), JsError> {
    layer_manager::upload_pixels_from_canvas(&mut engine.inner, layer_id, canvas, width, height)
        .map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "readLayerPixels")]
pub fn read_layer_pixels(engine: &Engine, layer_id: &str) -> Result<Vec<u8>, JsError> {
    layer_manager::read_pixels(&engine.inner, layer_id)
        .map_err(|e| JsError::new(&e))
}

/// Decode a PNG blob and upload pixels to a layer texture, preserving 16-bit precision.
/// Returns [width, height] on success, or an empty Vec if the format is not supported
/// (caller should fall back to the canvas 2D decode path).
#[wasm_bindgen(js_name = "decodeAndUploadImage")]
pub fn decode_and_upload_image(
    engine: &mut Engine,
    layer_id: &str,
    data: &[u8],
) -> Vec<u32> {
    let decoded = match lopsy_core::decode::decode_png(data) {
        Some(d) => d,
        None => return Vec::new(),
    };

    let result = match decoded.pixels {
        lopsy_core::decode::DecodedPixels::Rgba8(ref pixels) => {
            layer_manager::upload_pixels(
                &mut engine.inner, layer_id, pixels,
                decoded.width, decoded.height, 0, 0,
            )
        }
        lopsy_core::decode::DecodedPixels::RgbaF32(ref pixels) => {
            layer_manager::upload_pixels_f32(
                &mut engine.inner, layer_id, pixels,
                decoded.width, decoded.height,
            )
        }
    };

    match result {
        Ok(()) => vec![decoded.width, decoded.height],
        Err(_) => Vec::new(),
    }
}

/// Decode a DNG (raw) file and upload to a layer texture as f32 RGBA.
/// Returns JSON: `{ width, height, baselineExposure, toneCurve: [[x,y], ...] }`
#[wasm_bindgen(js_name = "decodeAndUploadDng")]
pub fn decode_and_upload_dng(
    engine: &mut Engine,
    layer_id: &str,
    data: &[u8],
) -> Result<String, JsError> {
    let dng = lopsy_core::dng::read_dng(data)
        .map_err(|e| JsError::new(&format!("DNG decode failed: {e}")))?;

    layer_manager::upload_pixels_f32(
        &mut engine.inner,
        layer_id,
        &dng.pixels,
        dng.width,
        dng.height,
    ).map_err(|e| JsError::new(&e))?;

    for line in &dng.debug_log {
        web_sys::console::log_1(&line.into());
    }

    #[derive(serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct DngMeta {
        width: u32,
        height: u32,
        baseline_exposure: f64,
        tone_curve: Vec<[f64; 2]>,
    }

    let meta = DngMeta {
        width: dng.width,
        height: dng.height,
        baseline_exposure: dng.baseline_exposure,
        tone_curve: dng.tone_curve.iter().map(|&(x, y)| [x, y]).collect(),
    };

    serde_json::to_string(&meta)
        .map_err(|e| JsError::new(&format!("JSON serialize: {e}")))
}

/// Decode a RAF (Fujifilm RAW) file and upload to a layer texture as f32 RGBA.
/// Returns JSON: `{ width, height }`
#[wasm_bindgen(js_name = "decodeAndUploadRaf")]
pub fn decode_and_upload_raf(
    engine: &mut Engine,
    layer_id: &str,
    data: &[u8],
) -> Result<String, JsError> {
    let raf = lopsy_core::raf::read_raf(data)
        .map_err(|e| JsError::new(&format!("RAF decode failed: {e}")))?;

    layer_manager::upload_pixels_f32(
        &mut engine.inner,
        layer_id,
        &raf.pixels,
        raf.width,
        raf.height,
    ).map_err(|e| JsError::new(&e))?;

    for line in &raf.debug_log {
        web_sys::console::log_1(&line.into());
    }

    #[derive(serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct RafMeta {
        width: u32,
        height: u32,
    }

    let meta = RafMeta {
        width: raf.width,
        height: raf.height,
    };

    serde_json::to_string(&meta)
        .map_err(|e| JsError::new(&format!("JSON serialize: {e}")))
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
    let sparse = lopsy_core::sparse::SparsePixelData {
        indices: indices.to_vec(),
        rgba: rgba.to_vec(),
        width: sparse_width,
        height: sparse_height,
    };
    let dense = lopsy_core::sparse::from_sparse(&sparse, sparse_width, sparse_height, 0, 0);
    layer_manager::upload_pixels(&mut engine.inner, layer_id, &dense, sparse_width, sparse_height, offset_x, offset_y)
        .map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "uploadLayerMask")]
pub fn upload_layer_mask(
    engine: &mut Engine, layer_id: &str,
    mask_data: &[u8], width: u32, height: u32,
) {
    let gl = &engine.inner.gl;
    // Upload mask as RGBA texture
    let mut rgba = vec![0u8; (width * height * 4) as usize];
    for i in 0..(width * height) as usize {
        let v = if i < mask_data.len() { mask_data[i] } else { 0 };
        rgba[i * 4] = v;
        rgba[i * 4 + 1] = v;
        rgba[i * 4 + 2] = v;
        rgba[i * 4 + 3] = 255;
    }
    if let Ok(tex) = engine.inner.texture_pool.acquire(gl, width, height) {
        let _ = engine.inner.texture_pool.upload_rgba(
            gl, tex, 0, 0, width, height, &rgba,
        );
        // Release old mask if present
        if let Some(old) = engine.inner.layer_masks.insert(layer_id.to_string(), tex) {
            engine.inner.texture_pool.release(old);
        }
    }
    engine.inner.needs_recomposite = true;
}

#[wasm_bindgen(js_name = "removeLayerMask")]
pub fn remove_layer_mask(engine: &mut Engine, layer_id: &str) {
    if let Some(mask) = engine.inner.layer_masks.remove(layer_id) {
        engine.inner.texture_pool.release(mask);
    }
    engine.inner.needs_recomposite = true;
}

#[wasm_bindgen(js_name = "getLayerTextureDimensions")]
pub fn get_layer_texture_dimensions(engine: &Engine, layer_id: &str) -> Vec<u32> {
    if let Some(&tex) = engine.inner.layer_textures.get(layer_id) {
        if let Some((w, h)) = engine.inner.texture_pool.get_size(tex) {
            return vec![w, h];
        }
    }
    vec![0, 0]
}

#[wasm_bindgen(js_name = "getLayerEngineBounds")]
pub fn get_layer_engine_bounds(engine: &Engine, layer_id: &str) -> Vec<i32> {
    let (x, y) = engine.inner.layer_stack.iter()
        .find(|l| l.id == layer_id)
        .map(|l| (l.x, l.y))
        .unwrap_or((0, 0));
    let (w, h) = engine.inner.layer_textures.get(layer_id)
        .and_then(|&tex| engine.inner.texture_pool.get_size(tex))
        .unwrap_or((0, 0));
    vec![x, y, w as i32, h as i32]
}

#[wasm_bindgen(js_name = "getLayerContentBounds")]
pub fn get_layer_content_bounds(engine: &Engine, layer_id: &str) -> Vec<i32> {
    // Read layer pixels and find content bounds
    if let Ok(pixels) = layer_manager::read_pixels(&engine.inner, layer_id) {
        if let Some(&tex) = engine.inner.layer_textures.get(layer_id) {
            if let Some((w, h)) = engine.inner.texture_pool.get_size(tex) {
                let (_, rect) = lopsy_core::pixel_buffer::crop_to_content_bounds(&pixels, w, h);
                return vec![rect.x, rect.y, rect.width as i32, rect.height as i32];
            }
        }
    }
    Vec::new()
}

#[wasm_bindgen(js_name = "rasterizeLayerEffects")]
pub fn rasterize_layer_effects(engine: &mut Engine, layer_id: &str) -> Vec<u8> {
    // Composite the single layer with effects using the GPU pipeline,
    // then return the document-sized pixel buffer. This ensures the
    // rasterized output exactly matches the live GPU rendering.
    compositor::composite_single_layer(&mut engine.inner, layer_id).unwrap_or_default()
}

// ============================================================
// GPU-only Layer Operations (Phase 2-4 of GPU migration)
// ============================================================

#[wasm_bindgen(js_name = "duplicateLayerTexture")]
pub fn duplicate_layer_texture(engine: &mut Engine, src_id: &str, dst_id: &str) -> Result<(), JsError> {
    layer_manager::duplicate_texture(&mut engine.inner, src_id, dst_id)
        .map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "mergeLayers")]
pub fn merge_layers(engine: &mut Engine, top_id: &str, bottom_id: &str) -> Result<(), JsError> {
    layer_manager::merge_layers(&mut engine.inner, top_id, bottom_id)
        .map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "flipLayer")]
pub fn flip_layer(engine: &mut Engine, layer_id: &str, horizontal: bool) -> Result<(), JsError> {
    layer_manager::flip_texture(&mut engine.inner, layer_id, horizontal)
        .map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "rotateLayer90")]
pub fn rotate_layer_90(engine: &mut Engine, layer_id: &str, clockwise: bool) -> Result<(), JsError> {
    layer_manager::rotate_texture_90(&mut engine.inner, layer_id, clockwise)
        .map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "scaleLayerTexture")]
pub fn scale_layer_texture(engine: &mut Engine, layer_id: &str, new_w: u32, new_h: u32) -> Result<(), JsError> {
    layer_manager::scale_texture(&mut engine.inner, layer_id, new_w, new_h)
        .map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "resizeCanvasTexture")]
pub fn resize_canvas_texture(
    engine: &mut Engine, layer_id: &str,
    old_layer_x: i32, old_layer_y: i32, old_w: u32, old_h: u32,
    new_w: u32, new_h: u32, offset_x: i32, offset_y: i32,
) -> Result<(), JsError> {
    layer_manager::resize_canvas_texture(
        &mut engine.inner, layer_id,
        old_layer_x, old_layer_y, old_w, old_h,
        new_w, new_h, offset_x, offset_y,
    ).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "cropLayerTexture")]
pub fn crop_layer_texture(
    engine: &mut Engine, layer_id: &str,
    layer_x: i32, layer_y: i32,
    crop_x: i32, crop_y: i32, crop_w: u32, crop_h: u32,
) -> Result<(), JsError> {
    layer_manager::crop_texture(
        &mut engine.inner, layer_id,
        layer_x, layer_y, crop_x, crop_y, crop_w, crop_h,
    ).map_err(|e| JsError::new(&e))
}

/// Expand a raster layer's GPU texture to cover at least the full document
/// area, preserving any content that extends beyond the document bounds.
/// Returns [x, y, w, h] of the resulting texture on success, or [] on error.
#[wasm_bindgen(js_name = "expandLayerToDocSize")]
pub fn expand_layer_to_doc_size(engine: &mut Engine, layer_id: &str) -> Vec<f64> {
    match layer_manager::expand_layer_to_doc_size(&mut engine.inner, layer_id) {
        Ok([x, y, w, h]) => vec![x as f64, y as f64, w as f64, h as f64],
        Err(_) => vec![],
    }
}

/// Crop a raster layer's GPU texture to the bounding box of its non-transparent
/// pixels. Returns [new_x, new_y, new_w, new_h] on success, or [] on error.
/// If fully transparent, returns [x, y, 0, 0].
#[wasm_bindgen(js_name = "cropLayerToContent")]
pub fn crop_layer_to_content(engine: &mut Engine, layer_id: &str) -> Vec<f64> {
    match layer_manager::crop_layer_to_content(&mut engine.inner, layer_id) {
        Ok([x, y, w, h]) => vec![x as f64, y as f64, w as f64, h as f64],
        Err(_) => vec![],
    }
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
    let (w, h, ox, oy) = layer_manager::clipboard_copy(
        &mut engine.inner, layer_id, has_selection, bounds_x, bounds_y, bounds_w, bounds_h,
    ).map_err(|e| JsError::new(&e))?;
    Ok(vec![w as i32, h as i32, ox, oy])
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
    // Copy first
    let (w, h, ox, oy) = layer_manager::clipboard_copy(
        &mut engine.inner, layer_id, has_selection, bounds_x, bounds_y, bounds_w, bounds_h,
    ).map_err(|e| JsError::new(&e))?;
    // Then clear selected pixels
    layer_manager::clipboard_clear_selected(&mut engine.inner, layer_id, has_selection)
        .map_err(|e| JsError::new(&e))?;
    Ok(vec![w as i32, h as i32, ox, oy])
}

#[wasm_bindgen(js_name = "clipboardPaste")]
pub fn clipboard_paste(
    engine: &mut Engine,
    dst_layer_id: &str,
) -> Result<(), JsError> {
    layer_manager::clipboard_paste(&mut engine.inner, dst_layer_id)
        .map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "readClipboardPixels")]
pub fn read_clipboard_pixels(engine: &Engine) -> Result<Vec<u8>, JsError> {
    layer_manager::read_clipboard_pixels(&engine.inner)
        .map_err(|e| JsError::new(&e))
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
    layer_manager::upload_clipboard_pixels(&mut engine.inner, data, width, height, offset_x, offset_y)
        .map_err(|e| JsError::new(&e))
}

// ============================================================
// Floating Selection (Phase 5)
// ============================================================

#[wasm_bindgen(js_name = "floatSelection")]
pub fn float_selection(engine: &mut Engine, layer_id: &str) -> Result<Vec<f64>, JsError> {
    layer_manager::float_selection(&mut engine.inner, layer_id)
        .map(|b| b.to_vec())
        .map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "restoreFloatBase")]
pub fn restore_float_base(engine: &mut Engine, src_id: &str) -> Result<(), JsError> {
    layer_manager::restore_float_base(&mut engine.inner, src_id)
        .map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "compositeFloat")]
pub fn composite_float(engine: &mut Engine, dx: i32, dy: i32) -> Result<(), JsError> {
    layer_manager::composite_float(&mut engine.inner, dx, dy)
        .map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "dropFloat")]
pub fn drop_float(engine: &mut Engine) {
    layer_manager::drop_float(&mut engine.inner);
}

#[wasm_bindgen(js_name = "hasFloat")]
pub fn has_float(engine: &Engine) -> bool {
    engine.inner.float_texture.is_some()
}

#[wasm_bindgen(js_name = "compositeFloatAffine")]
pub fn composite_float_affine(
    engine: &mut Engine,
    inv_matrix: &[f32],
    src_center_x: f32,
    src_center_y: f32,
    dst_center_x: f32,
    dst_center_y: f32,
) -> Result<(), JsError> {
    layer_manager::composite_float_affine(
        &mut engine.inner, inv_matrix, src_center_x, src_center_y, dst_center_x, dst_center_y,
    ).map_err(|e| JsError::new(&e))
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
    layer_manager::composite_float_perspective(&mut engine.inner, corners, orig_x, orig_y, orig_w, orig_h)
        .map_err(|e| JsError::new(&e))
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
    layer_manager::fill_with_color(&mut engine.inner, layer_id, r, g, b, a)
        .map_err(|e| JsError::new(&e))
}

// ============================================================
// Compressed Layer I/O
// ============================================================

#[wasm_bindgen(js_name = "uploadLayerPixelsCompressed")]
pub fn upload_layer_pixels_compressed(engine: &mut Engine, layer_id: &str, compressed: &[u8]) -> Result<(), JsError> {
    if compressed.len() < 24 {
        return Err(JsError::new("Compressed data too short (need at least 24-byte header)"));
    }

    // Read 24-byte header: crop_x, crop_y, crop_w, crop_h, full_w, full_h
    let crop_x = i32::from_le_bytes([compressed[0], compressed[1], compressed[2], compressed[3]]);
    let crop_y = i32::from_le_bytes([compressed[4], compressed[5], compressed[6], compressed[7]]);
    let crop_w = i32::from_le_bytes([compressed[8], compressed[9], compressed[10], compressed[11]]);
    let crop_h = i32::from_le_bytes([compressed[12], compressed[13], compressed[14], compressed[15]]);
    let full_w = i32::from_le_bytes([compressed[16], compressed[17], compressed[18], compressed[19]]);
    let full_h = i32::from_le_bytes([compressed[20], compressed[21], compressed[22], compressed[23]]);

    if crop_w <= 0 || crop_h <= 0 || full_w <= 0 || full_h <= 0 {
        return Err(JsError::new("Invalid dimensions in compressed header"));
    }

    let pixel_data = &compressed[24..];
    let expected_len = (crop_w as usize) * (crop_h as usize) * 4;
    if pixel_data.len() < expected_len {
        return Err(JsError::new("Snapshot pixel data shorter than header dimensions"));
    }

    // Reconstruct the full-size texture with the cropped content at its original
    // offset. This ensures the layer position from the document state (set by
    // syncLayers) renders content at the correct location.
    let fw = full_w as usize;
    let fh = full_h as usize;
    let mut full_pixels = vec![0u8; fw * fh * 4];
    let cw = crop_w as usize;
    let cx = crop_x as usize;
    let cy = crop_y as usize;
    let ch = crop_h as usize;
    for row in 0..ch {
        let src_start = row * cw * 4;
        let dst_start = ((cy + row) * fw + cx) * 4;
        let len = cw * 4;
        full_pixels[dst_start..dst_start + len]
            .copy_from_slice(&pixel_data[src_start..src_start + len]);
    }

    layer_manager::upload_pixels(
        &mut engine.inner,
        layer_id,
        &full_pixels,
        full_w as u32,
        full_h as u32,
        0, 0,
    ).map_err(|e| JsError::new(&e))?;

    Ok(())
}

#[wasm_bindgen(js_name = "readLayerPixelsCompressedU16")]
pub fn read_layer_pixels_compressed_u16(engine: &Engine, layer_id: &str) -> Vec<u8> {
    let tex = match engine.inner.layer_textures.get(layer_id) {
        Some(&t) => t,
        None => return Vec::new(),
    };
    let (w, h) = engine.inner.texture_pool.get_size(tex).unwrap_or((0, 0));
    if w == 0 || h == 0 {
        return Vec::new();
    }

    // Crop and convert to LE bytes in one pass, dropping the full-size
    // Vec<u16> before building the byte buffer. This keeps peak WASM
    // allocation at ~2× the cropped layer size instead of ~4×.
    let (raw_bytes, rect) = {
        let pixels = match layer_manager::read_pixels_u16(&engine.inner, layer_id) {
            Ok(p) => p,
            Err(_) => return Vec::new(),
        };
        let (cropped, rect) = lopsy_core::pixel_buffer::crop_to_content_bounds_u16(&pixels, w, h);
        drop(pixels);
        if cropped.is_empty() {
            return Vec::new();
        }
        let mut bytes = Vec::with_capacity(cropped.len() * 2);
        for &val in &cropped {
            bytes.extend_from_slice(&val.to_le_bytes());
        }
        (bytes, rect)
    };

    let mut result = Vec::with_capacity(32 + raw_bytes.len());
    result.extend_from_slice(&rect.x.to_le_bytes());
    result.extend_from_slice(&rect.y.to_le_bytes());
    result.extend_from_slice(&(rect.width as i32).to_le_bytes());
    result.extend_from_slice(&(rect.height as i32).to_le_bytes());
    result.extend_from_slice(&(w as i32).to_le_bytes());
    result.extend_from_slice(&(h as i32).to_le_bytes());
    result.extend_from_slice(&0i32.to_le_bytes()); // flags: 0 = raw (no compression)
    result.extend_from_slice(&(raw_bytes.len() as u32).to_le_bytes());
    result.extend_from_slice(&raw_bytes);
    result
}

#[wasm_bindgen(js_name = "uploadLayerPixelsCompressedU16")]
pub fn upload_layer_pixels_compressed_u16(engine: &mut Engine, layer_id: &str, compressed: &[u8]) -> Result<(), JsError> {
    if compressed.len() < 24 {
        return Err(JsError::new("Compressed data too short (need at least 24-byte header)"));
    }

    let crop_x = i32::from_le_bytes([compressed[0], compressed[1], compressed[2], compressed[3]]);
    let crop_y = i32::from_le_bytes([compressed[4], compressed[5], compressed[6], compressed[7]]);
    let crop_w = i32::from_le_bytes([compressed[8], compressed[9], compressed[10], compressed[11]]);
    let crop_h = i32::from_le_bytes([compressed[12], compressed[13], compressed[14], compressed[15]]);
    let full_w = i32::from_le_bytes([compressed[16], compressed[17], compressed[18], compressed[19]]);
    let full_h = i32::from_le_bytes([compressed[20], compressed[21], compressed[22], compressed[23]]);

    if crop_w <= 0 || crop_h <= 0 || full_w <= 0 || full_h <= 0 {
        return Err(JsError::new("Invalid dimensions in compressed header"));
    }

    let expected_u16_count = (crop_w as usize) * (crop_h as usize) * 4;
    let expected_raw_len = expected_u16_count * 2;

    // Detect format: 24-byte header + raw data (old) vs 28-byte header + RLE (new).
    // Old format: data.len() == 24 + expected_raw_len
    // New format: header[24..28] == flags, header[28..32] == uncompressed_size, then RLE
    let cropped_bytes: Vec<u8> = if compressed.len() == 24 + expected_raw_len {
        // Old format: raw u16 bytes after 24-byte header
        compressed[24..24 + expected_raw_len].to_vec()
    } else if compressed.len() >= 32 {
        let flags = i32::from_le_bytes([compressed[24], compressed[25], compressed[26], compressed[27]]);
        let uncompressed_size = u32::from_le_bytes([compressed[28], compressed[29], compressed[30], compressed[31]]) as usize;
        if flags == 2 {
            lopsy_core::compress::lz4_decompress(&compressed[32..], uncompressed_size)
        } else if flags == 1 {
            lopsy_core::compress::rle_decompress_u16(&compressed[32..], uncompressed_size)
        } else {
            compressed[32..].to_vec()
        }
    } else {
        return Err(JsError::new("Snapshot data too short for any known format"));
    };

    // Decode LE u16 values from the (decompressed) byte stream
    let cropped: Vec<u16> = cropped_bytes
        .chunks_exact(2)
        .map(|c| u16::from_le_bytes([c[0], c[1]]))
        .collect();

    // Reconstruct full-size u16 buffer
    let fw = full_w as usize;
    let fh = full_h as usize;
    let mut full_pixels = vec![0u16; fw * fh * 4];
    let cw = crop_w as usize;
    let cx = crop_x as usize;
    let cy = crop_y as usize;
    let ch = crop_h as usize;
    for row in 0..ch {
        let src_start = row * cw * 4;
        let dst_start = ((cy + row) * fw + cx) * 4;
        let len = cw * 4;
        full_pixels[dst_start..dst_start + len]
            .copy_from_slice(&cropped[src_start..src_start + len]);
    }

    layer_manager::upload_pixels_u16(
        &mut engine.inner,
        layer_id,
        &full_pixels,
        full_w as u32,
        full_h as u32,
    ).map_err(|e| JsError::new(&e))?;

    Ok(())
}

#[wasm_bindgen(js_name = "readLayerThumbnail")]
pub fn read_layer_thumbnail(engine: &Engine, layer_id: &str, max_size: u32) -> Vec<u8> {
    use web_sys::WebGl2RenderingContext;

    let tex_handle = match engine.inner.layer_textures.get(layer_id) {
        Some(&t) => t,
        None => return Vec::new(),
    };
    let src_tex = match engine.inner.texture_pool.get(tex_handle).cloned() {
        Some(t) => t,
        None => return Vec::new(),
    };
    let (w, h) = engine.inner.texture_pool.get_size(tex_handle).unwrap_or((0, 0));
    if w == 0 || h == 0 {
        return Vec::new();
    }

    let (tw, th) = if w <= max_size && h <= max_size {
        (w, h)
    } else {
        let scale = (max_size as f64) / (w.max(h) as f64);
        (((w as f64 * scale).round() as u32).max(1),
         ((h as f64 * scale).round() as u32).max(1))
    };

    let gl = &engine.inner.gl;

    // Create a small RGBA8 texture for the thumbnail
    let thumb_tex = match gl.create_texture() {
        Some(t) => t,
        None => return Vec::new(),
    };
    gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&thumb_tex));
    let _ = gl.tex_image_2d_with_i32_and_i32_and_i32_and_format_and_type_and_opt_u8_array(
        WebGl2RenderingContext::TEXTURE_2D, 0,
        WebGl2RenderingContext::RGBA8 as i32,
        tw as i32, th as i32, 0,
        WebGl2RenderingContext::RGBA,
        WebGl2RenderingContext::UNSIGNED_BYTE,
        None,
    );
    gl.tex_parameteri(WebGl2RenderingContext::TEXTURE_2D,
        WebGl2RenderingContext::TEXTURE_MIN_FILTER,
        WebGl2RenderingContext::LINEAR as i32);
    gl.tex_parameteri(WebGl2RenderingContext::TEXTURE_2D,
        WebGl2RenderingContext::TEXTURE_MAG_FILTER,
        WebGl2RenderingContext::LINEAR as i32);

    // Blit the full layer texture into the tiny thumbnail via the blit shader
    let fbo = match gl.create_framebuffer() {
        Some(f) => f,
        None => { gl.delete_texture(Some(&thumb_tex)); return Vec::new(); }
    };
    gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, Some(&fbo));
    gl.framebuffer_texture_2d(
        WebGl2RenderingContext::FRAMEBUFFER,
        WebGl2RenderingContext::COLOR_ATTACHMENT0,
        WebGl2RenderingContext::TEXTURE_2D,
        Some(&thumb_tex), 0,
    );
    gl.viewport(0, 0, tw as i32, th as i32);

    gl.use_program(Some(&engine.inner.shaders.blit.program));
    gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&src_tex));
    if let Some(loc) = engine.inner.shaders.blit.location(gl, "u_tex") {
        gl.uniform1i(Some(&loc), 0);
    }
    engine.inner.draw_fullscreen_quad();

    // Read back only the tiny thumbnail (tw*th*4 bytes)
    let count = (tw * th * 4) as usize;
    let mut thumb = vec![0u8; count];
    let _ = gl.read_pixels_with_opt_u8_array(
        0, 0, tw as i32, th as i32,
        WebGl2RenderingContext::RGBA,
        WebGl2RenderingContext::UNSIGNED_BYTE,
        Some(&mut thumb),
    );

    // Cleanup
    gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, None);
    gl.delete_framebuffer(Some(&fbo));
    gl.delete_texture(Some(&thumb_tex));

    let mut result = Vec::with_capacity(8 + thumb.len());
    result.extend_from_slice(&tw.to_le_bytes());
    result.extend_from_slice(&th.to_le_bytes());
    result.extend_from_slice(&thumb);
    result
}

/// Read the composited document (all layers flattened) as a thumbnail.
/// Reads the composite FBO which holds the document at native resolution
/// before viewport transform, then downscales to max_size.
/// Returns 8-byte header [width_u32_le, height_u32_le] + RGBA pixels.
#[wasm_bindgen(js_name = "readCompositeThumbnail")]
pub fn read_composite_thumbnail(engine: &Engine, max_size: u32) -> Vec<u8> {
    let w = engine.inner.doc_width;
    let h = engine.inner.doc_height;
    if w == 0 || h == 0 { return Vec::new(); }

    // Bind composite FBO and read its pixels
    engine.inner.fbo_pool.bind(&engine.inner.gl, engine.inner.composite_fbo);
    let pixels = match engine.inner.texture_pool.read_rgba(
        &engine.inner.gl, 0, 0, w, h,
    ) {
        Ok(p) => p,
        Err(_) => {
            engine.inner.fbo_pool.unbind(&engine.inner.gl);
            return Vec::new();
        }
    };
    engine.inner.fbo_pool.unbind(&engine.inner.gl);

    let (tw, th) = if w <= max_size && h <= max_size {
        (w, h)
    } else {
        let scale = (max_size as f64) / (w.max(h) as f64);
        (((w as f64 * scale).round() as u32).max(1), ((h as f64 * scale).round() as u32).max(1))
    };

    let thumb = if tw == w && th == h {
        pixels
    } else {
        lopsy_core::pixel_buffer::scale_pixel_data(&pixels, w, h, tw, th)
    };

    let mut result = Vec::with_capacity(8 + thumb.len());
    result.extend_from_slice(&tw.to_le_bytes());
    result.extend_from_slice(&th.to_le_bytes());
    result.extend_from_slice(&thumb);
    result
}

// ============================================================
// GPU Texture Snapshots — instant blit, no readback
// ============================================================

/// Snapshot a layer's GPU texture by blitting to a new texture (~1ms).
/// Returns an opaque u32 handle. No pixel readback, no compression.
#[wasm_bindgen(js_name = "snapshotLayerGpu")]
pub fn snapshot_layer_gpu(engine: &mut Engine, layer_id: &str) -> u32 {
    let src_handle = match engine.inner.layer_textures.get(layer_id) {
        Some(&h) => h,
        None => return u32::MAX,
    };
    let (w, h) = engine.inner.texture_pool.get_size(src_handle).unwrap_or((0, 0));
    if w == 0 || h == 0 {
        return u32::MAX;
    }

    let dst_handle = match engine.inner.texture_pool.acquire(&engine.inner.gl, w, h) {
        Ok(h) => h,
        Err(_) => return u32::MAX,
    };

    let (dst_tex, src_tex) = match (
        engine.inner.texture_pool.get(dst_handle).cloned(),
        engine.inner.texture_pool.get(src_handle).cloned(),
    ) {
        (Some(d), Some(s)) => (d, s),
        _ => return u32::MAX,
    };

    engine.inner.render_to_texture(&dst_tex, w as i32, h as i32, |eng| {
        eng.gl.use_program(Some(&eng.shaders.blit.program));
        eng.gl.active_texture(web_sys::WebGl2RenderingContext::TEXTURE0);
        eng.gl.bind_texture(web_sys::WebGl2RenderingContext::TEXTURE_2D, Some(&src_tex));
        if let Some(loc) = eng.shaders.blit.location(&eng.gl, "u_tex") {
            eng.gl.uniform1i(Some(&loc), 0);
        }
        eng.draw_fullscreen_quad();
    });

    let snap = crate::engine::SnapshotTexture { handle: dst_handle, width: w, height: h };
    let id = if let Some(free_id) = engine.inner.snapshot_free_list.pop() {
        engine.inner.snapshot_textures[free_id as usize] = Some(snap);
        free_id
    } else {
        let id = engine.inner.snapshot_textures.len() as u32;
        engine.inner.snapshot_textures.push(Some(snap));
        id
    };
    id
}

/// Restore a layer's GPU texture from a snapshot (GPU blit, ~1ms).
#[wasm_bindgen(js_name = "restoreFromGpuSnapshot")]
pub fn restore_from_gpu_snapshot(engine: &mut Engine, layer_id: &str, snap_id: u32) -> Result<(), JsError> {
    let snap = engine.inner.snapshot_textures.get(snap_id as usize)
        .and_then(|s| s.as_ref())
        .ok_or_else(|| JsError::new("Invalid snapshot handle"))?;

    let sw = snap.width;
    let sh = snap.height;
    let snap_handle = snap.handle;

    let dst_handle = if let Some(&existing) = engine.inner.layer_textures.get(layer_id) {
        let (dw, dh) = engine.inner.texture_pool.get_size(existing).unwrap_or((0, 0));
        if dw != sw || dh != sh {
            engine.inner.texture_pool.release(existing);
            let new_h = engine.inner.texture_pool.acquire(&engine.inner.gl, sw, sh)
                .map_err(|e| JsError::new(&e))?;
            engine.inner.layer_textures.insert(layer_id.to_string(), new_h);
            new_h
        } else {
            existing
        }
    } else {
        let new_h = engine.inner.texture_pool.acquire(&engine.inner.gl, sw, sh)
            .map_err(|e| JsError::new(&e))?;
        engine.inner.layer_textures.insert(layer_id.to_string(), new_h);
        new_h
    };

    let dst_tex = engine.inner.texture_pool.get(dst_handle).cloned()
        .ok_or_else(|| JsError::new("Dst texture not found"))?;
    let src_tex = engine.inner.texture_pool.get(snap_handle).cloned()
        .ok_or_else(|| JsError::new("Snapshot texture not found"))?;

    engine.inner.render_to_texture(&dst_tex, sw as i32, sh as i32, |eng| {
        eng.gl.use_program(Some(&eng.shaders.blit.program));
        eng.gl.active_texture(web_sys::WebGl2RenderingContext::TEXTURE0);
        eng.gl.bind_texture(web_sys::WebGl2RenderingContext::TEXTURE_2D, Some(&src_tex));
        if let Some(loc) = eng.shaders.blit.location(&eng.gl, "u_tex") {
            eng.gl.uniform1i(Some(&loc), 0);
        }
        eng.draw_fullscreen_quad();
    });

    engine.inner.mark_layer_dirty(layer_id);
    Ok(())
}

/// Release a snapshot texture, freeing GPU memory.
#[wasm_bindgen(js_name = "releaseGpuSnapshot")]
pub fn release_gpu_snapshot(engine: &mut Engine, snap_id: u32) {
    if let Some(slot) = engine.inner.snapshot_textures.get_mut(snap_id as usize) {
        if let Some(snap) = slot.take() {
            engine.inner.texture_pool.release(snap.handle);
            engine.inner.snapshot_free_list.push(snap_id);
        }
    }
}

/// Clear all snapshot textures (e.g. on new document).
#[wasm_bindgen(js_name = "clearGpuSnapshots")]
pub fn clear_gpu_snapshots(engine: &mut Engine) {
    for slot in &mut engine.inner.snapshot_textures {
        if let Some(snap) = slot.take() {
            engine.inner.texture_pool.release(snap.handle);
        }
    }
    engine.inner.snapshot_textures.clear();
    engine.inner.snapshot_free_list.clear();
}
