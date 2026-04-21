//! Layer API: add/remove/update, pixel upload (dense + sparse + compressed),
//! mask upload, and the GPU-only operations (duplicate, merge, flip, rotate,
//! scale, resize canvas, crop, fill, clipboard copy/cut/paste, floating
//! selection, thumbnail readback).
//!
//! Each function is a thin `#[wasm_bindgen]` wrapper over `layer_manager`
//! (or specific helpers like `clone_pixel_data`/`crop_pixel_data` in
//! `lopsy_core`). The grouping matches the "layers" mental model: anything
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

#[wasm_bindgen(js_name = "clipboardGetInfo")]
pub fn clipboard_get_info(engine: &Engine) -> Vec<i32> {
    if engine.inner.clipboard_texture.is_some() {
        vec![
            engine.inner.clipboard_width as i32,
            engine.inner.clipboard_height as i32,
            engine.inner.clipboard_offset_x,
            engine.inner.clipboard_offset_y,
        ]
    } else {
        Vec::new()
    }
}

// ============================================================
// Floating Selection (Phase 5)
// ============================================================

#[wasm_bindgen(js_name = "floatSelection")]
pub fn float_selection(engine: &mut Engine, layer_id: &str) -> Result<(), JsError> {
    layer_manager::float_selection(&mut engine.inner, layer_id)
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

#[wasm_bindgen(js_name = "flipFloat")]
pub fn flip_float(engine: &mut Engine, horizontal: bool) -> Result<(), JsError> {
    layer_manager::flip_float(&mut engine.inner, horizontal)
        .map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "rotateFloat90")]
pub fn rotate_float_90(engine: &mut Engine, clockwise: bool) -> Result<(), JsError> {
    layer_manager::rotate_float_90(&mut engine.inner, clockwise)
        .map_err(|e| JsError::new(&e))
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

#[wasm_bindgen(js_name = "readLayerPixelsCompressed")]
pub fn read_layer_pixels_compressed(engine: &Engine, layer_id: &str) -> Vec<u8> {
    // Get content bounds
    let pixels = match layer_manager::read_pixels(&engine.inner, layer_id) {
        Ok(p) => p,
        Err(_) => return Vec::new(),
    };
    let tex = match engine.inner.layer_textures.get(layer_id) {
        Some(&t) => t,
        None => return Vec::new(),
    };
    let (w, h) = engine.inner.texture_pool.get_size(tex).unwrap_or((0, 0));
    if w == 0 || h == 0 {
        return Vec::new();
    }

    let (cropped, rect) = lopsy_core::pixel_buffer::crop_to_content_bounds(&pixels, w, h);
    if cropped.is_empty() {
        return Vec::new();
    }

    // Build result: 24-byte header (6 x i32 LE) + raw cropped pixel data
    // Header stores LOCAL crop offsets within the texture and the full texture size.
    // On restore, we recreate the full-size texture and place the cropped content
    // at the correct offset so that the layer position from the document state
    // (set by syncLayers) renders everything correctly.
    let mut result = Vec::with_capacity(24 + cropped.len());
    result.extend_from_slice(&rect.x.to_le_bytes());        // crop_x (local to texture)
    result.extend_from_slice(&rect.y.to_le_bytes());        // crop_y (local to texture)
    result.extend_from_slice(&(rect.width as i32).to_le_bytes());  // crop_w
    result.extend_from_slice(&(rect.height as i32).to_le_bytes()); // crop_h
    result.extend_from_slice(&(w as i32).to_le_bytes());    // full texture width
    result.extend_from_slice(&(h as i32).to_le_bytes());    // full texture height
    result.extend_from_slice(&cropped);
    result
}

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
    let pixels = match layer_manager::read_pixels_u16(&engine.inner, layer_id) {
        Ok(p) => p,
        Err(_) => return Vec::new(),
    };
    let tex = match engine.inner.layer_textures.get(layer_id) {
        Some(&t) => t,
        None => return Vec::new(),
    };
    let (w, h) = engine.inner.texture_pool.get_size(tex).unwrap_or((0, 0));
    if w == 0 || h == 0 {
        return Vec::new();
    }

    let (cropped, rect) = lopsy_core::pixel_buffer::crop_to_content_bounds_u16(&pixels, w, h);
    if cropped.is_empty() {
        return Vec::new();
    }

    // 24-byte header (same layout as u8 variant) + u16 pixel data as LE bytes
    let pixel_bytes = cropped.len() * 2;
    let mut result = Vec::with_capacity(24 + pixel_bytes);
    result.extend_from_slice(&rect.x.to_le_bytes());
    result.extend_from_slice(&rect.y.to_le_bytes());
    result.extend_from_slice(&(rect.width as i32).to_le_bytes());
    result.extend_from_slice(&(rect.height as i32).to_le_bytes());
    result.extend_from_slice(&(w as i32).to_le_bytes());
    result.extend_from_slice(&(h as i32).to_le_bytes());
    for &val in &cropped {
        result.extend_from_slice(&val.to_le_bytes());
    }
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

    let pixel_bytes = &compressed[24..];
    let expected_u16_count = (crop_w as usize) * (crop_h as usize) * 4;
    let expected_byte_len = expected_u16_count * 2;
    if pixel_bytes.len() < expected_byte_len {
        return Err(JsError::new("Snapshot pixel data shorter than header dimensions"));
    }

    // Decode LE u16 values
    let cropped: Vec<u16> = pixel_bytes[..expected_byte_len]
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
    let pixels = match layer_manager::read_pixels(&engine.inner, layer_id) {
        Ok(p) => p,
        Err(_) => return Vec::new(),
    };
    let tex = match engine.inner.layer_textures.get(layer_id) {
        Some(&t) => t,
        None => return Vec::new(),
    };
    let (w, h) = engine.inner.texture_pool.get_size(tex).unwrap_or((0, 0));
    if w == 0 || h == 0 {
        return Vec::new();
    }

    if w <= max_size && h <= max_size {
        return pixels;
    }

    // Compute thumbnail dimensions maintaining aspect ratio
    let scale = (max_size as f64) / (w.max(h) as f64);
    let tw = ((w as f64 * scale).round() as u32).max(1);
    let th = ((h as f64 * scale).round() as u32).max(1);

    // Bilinear downscale
    let mut thumb = vec![0u8; (tw * th * 4) as usize];
    for ty in 0..th {
        for tx in 0..tw {
            let sx = (tx as f64 + 0.5) * (w as f64) / (tw as f64) - 0.5;
            let sy = (ty as f64 + 0.5) * (h as f64) / (th as f64) - 0.5;

            let x0 = (sx.floor() as i32).max(0) as u32;
            let y0 = (sy.floor() as i32).max(0) as u32;
            let x1 = (x0 + 1).min(w - 1);
            let y1 = (y0 + 1).min(h - 1);

            let fx = sx - sx.floor();
            let fy = sy - sy.floor();

            let dst = (ty * tw + tx) as usize * 4;
            for c in 0..4 {
                let c00 = pixels[(y0 * w + x0) as usize * 4 + c] as f64;
                let c10 = pixels[(y0 * w + x1) as usize * 4 + c] as f64;
                let c01 = pixels[(y1 * w + x0) as usize * 4 + c] as f64;
                let c11 = pixels[(y1 * w + x1) as usize * 4 + c] as f64;
                let val = c00 * (1.0 - fx) * (1.0 - fy)
                    + c10 * fx * (1.0 - fy)
                    + c01 * (1.0 - fx) * fy
                    + c11 * fx * fy;
                thumb[dst + c] = val.round().min(255.0).max(0.0) as u8;
            }
        }
    }

    // Prepend 8-byte header with thumbnail dimensions so JS knows the size
    let mut result = Vec::with_capacity(8 + thumb.len());
    result.extend_from_slice(&tw.to_le_bytes());
    result.extend_from_slice(&th.to_le_bytes());
    result.extend_from_slice(&thumb);
    result
}
