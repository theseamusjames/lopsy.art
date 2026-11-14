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


use lopsy_core::layer::LayerDesc;

use lopsy_core::geometry::Rect;

use crate::engine::EngineInner;
use crate::{compositor, layer_manager, layer_transform_gpu, thumbnail_gpu};

// ============================================================
// Layer Management
// ============================================================

pub fn add_layer(engine: &mut EngineInner, layer_desc_json: &str) -> Result<(), String> {
    let desc: LayerDesc = serde_json::from_str(layer_desc_json)
        .map_err(|e| format!("Invalid layer JSON: {e}"))?;
    layer_manager::add_layer(&mut *engine, desc)
}

pub fn remove_layer(engine: &mut EngineInner, layer_id: &str) {
    layer_manager::remove_layer(&mut *engine, layer_id);
}

pub fn update_layer(engine: &mut EngineInner, layer_desc_json: &str) -> Result<(), String> {
    let desc: LayerDesc = serde_json::from_str(layer_desc_json)
        .map_err(|e| format!("Invalid layer JSON: {e}"))?;
    layer_manager::update_layer(&mut *engine, desc);
    Ok(())
}

pub fn set_layer_order(engine: &mut EngineInner, order_json: &str) -> Result<(), String> {
    let order: Vec<String> = serde_json::from_str(order_json)
        .map_err(|e| format!("Invalid order JSON: {e}"))?;
    layer_manager::set_layer_order(&mut *engine, &order);
    Ok(())
}

pub fn upload_layer_pixels(
    engine: &mut EngineInner,
    layer_id: &str,
    data: &[u8],
    width: u32,
    height: u32,
    offset_x: i32,
    offset_y: i32,
) -> Result<(), String> {
    layer_manager::upload_pixels(&mut *engine, layer_id, data, width, height, offset_x, offset_y)
        
}

pub fn upload_layer_pixels_from_canvas(
    engine: &mut EngineInner,
    layer_id: &str,
    canvas: &crate::gpu::ExternalImage,
    width: u32,
    height: u32,
) -> Result<(), String> {
    layer_manager::upload_pixels_from_canvas(&mut *engine, layer_id, canvas, width, height)
        
}

pub fn read_layer_pixels(engine: &EngineInner, layer_id: &str) -> Result<Vec<u8>, String> {
    layer_manager::read_pixels(&*engine, layer_id)
        
}

/// Decode a PNG blob and upload pixels to a layer texture, preserving 16-bit precision.
/// Returns [width, height] on success, or an empty Vec if the format is not supported
/// (caller should fall back to the canvas 2D decode path).
pub fn decode_and_upload_image(
    engine: &mut EngineInner,
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
                &mut *engine, layer_id, pixels,
                decoded.width, decoded.height, 0, 0,
            )
        }
        lopsy_core::decode::DecodedPixels::RgbaF32(ref pixels) => {
            layer_manager::upload_pixels_f32(
                &mut *engine, layer_id, pixels,
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
pub fn decode_and_upload_dng(
    engine: &mut EngineInner,
    layer_id: &str,
    data: &[u8],
) -> Result<String, String> {
    let dng = lopsy_core::dng::read_dng(data)
        .map_err(|e| format!("DNG decode failed: {e}"))?;

    layer_manager::upload_pixels_f32(
        &mut *engine,
        layer_id,
        &dng.pixels,
        dng.width,
        dng.height,
    )?;

    for line in &dng.debug_log {
        crate::host::log(crate::host::LogLevel::Info, line);
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
        .map_err(|e| format!("JSON serialize: {e}"))
}

/// Upload an RGBA f32 rectangle into a layer whose texture is (re)allocated
/// at `texture_width`×`texture_height` if it isn't already that size. The
/// rest of the texture is left as is, so a large image can be filled in
/// pieces (the RAF import uploads each decoded band as it arrives).
#[allow(clippy::too_many_arguments)]
pub fn upload_layer_pixels_f32_rect(
    engine: &mut EngineInner,
    layer_id: &str,
    texture_width: u32,
    texture_height: u32,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    data: &[f32],
) -> Result<(), String> {
    layer_manager::upload_pixels_f32_rect(
        &mut *engine, layer_id, texture_width, texture_height, x, y, width, height, data,
    )
    
}

pub fn upload_layer_sparse_pixels(
    engine: &mut EngineInner,
    layer_id: &str,
    indices: &[u32],
    rgba: &[u8],
    sparse_width: u32,
    sparse_height: u32,
    offset_x: i32,
    offset_y: i32,
) -> Result<(), String> {
    let sparse = lopsy_core::sparse::SparsePixelData {
        indices: indices.to_vec(),
        rgba: rgba.to_vec(),
        width: sparse_width,
        height: sparse_height,
    };
    let dense = lopsy_core::sparse::from_sparse(&sparse, sparse_width, sparse_height, 0, 0);
    layer_manager::upload_pixels(&mut *engine, layer_id, &dense, sparse_width, sparse_height, offset_x, offset_y)
        
}

pub fn upload_layer_mask(
    engine: &mut EngineInner, layer_id: &str,
    mask_data: &[u8], width: u32, height: u32,
) {
    if let Ok(tex) = engine.upload_mask_texture(mask_data, width, height) {
        if let Some(old) = engine.layer_masks.insert(layer_id.to_string(), tex) {
            engine.texture_pool.release(old);
        }
    }
    engine.mark_layer_dirty(layer_id);
}

pub fn remove_layer_mask(engine: &mut EngineInner, layer_id: &str) {
    if let Some(mask) = engine.layer_masks.remove(layer_id) {
        engine.texture_pool.release(mask);
    }
    engine.mark_layer_dirty(layer_id);
}

pub fn get_layer_texture_dimensions(engine: &EngineInner, layer_id: &str) -> Vec<u32> {
    if let Some(&tex) = engine.layer_textures.get(layer_id) {
        if let Some((w, h)) = engine.texture_pool.get_size(tex) {
            return vec![w, h];
        }
    }
    vec![0, 0]
}

/// The layer's content generation: a value from an engine-wide counter,
/// replaced each time `mark_layer_dirty` reports a write to the layer's
/// pixels or mask, and 0 for a layer never written. The context-loss backup
/// compares it to skip re-reading layers unchanged since their last readback
/// (#1221). Returned as f64 so JS gets a number, not a BigInt.
pub fn layer_content_generation(engine: &EngineInner, layer_id: &str) -> f64 {
    engine.layer_content_gen(layer_id) as f64
}

pub fn get_layer_engine_bounds(engine: &EngineInner, layer_id: &str) -> Vec<i32> {
    let (x, y) = engine.layer_stack.iter()
        .find(|l| l.id == layer_id)
        .map(|l| (l.x, l.y))
        .unwrap_or((0, 0));
    let (w, h) = engine.layer_textures.get(layer_id)
        .and_then(|&tex| engine.texture_pool.get_size(tex))
        .unwrap_or((0, 0));
    vec![x, y, w as i32, h as i32]
}

pub fn get_layer_content_bounds(engine: &mut EngineInner, layer_id: &str) -> Vec<i32> {
    match layer_manager::layer_content_bounds(&mut *engine, layer_id) {
        Ok(rect) => vec![rect.x, rect.y, rect.width as i32, rect.height as i32],
        Err(_) => Vec::new(),
    }
}

pub fn rasterize_layer_effects(engine: &mut EngineInner, layer_id: &str, bake_mask: bool) -> Vec<u8> {
    // Composite the single layer with effects using the GPU pipeline,
    // then return the document-sized pixel buffer. This ensures the
    // rasterized output exactly matches the live GPU rendering.
    compositor::composite_single_layer(&mut *engine, layer_id, bake_mask).unwrap_or_default()
}

// ============================================================
// GPU-only Layer Operations (Phase 2-4 of GPU migration)
// ============================================================

pub fn duplicate_layer_texture(engine: &mut EngineInner, src_id: &str, dst_id: &str) -> Result<(), String> {
    layer_manager::duplicate_texture(&mut *engine, src_id, dst_id)
        
}

pub fn merge_layers(engine: &mut EngineInner, top_id: &str, bottom_id: &str, bake_bottom_opacity: bool) -> Result<Vec<i32>, String> {
    layer_manager::merge_layers(&mut *engine, top_id, bottom_id, bake_bottom_opacity)
        .map(|rect| rect.to_vec())
        
}

pub fn flip_layer(engine: &mut EngineInner, layer_id: &str, horizontal: bool) -> Result<(), String> {
    layer_manager::flip_texture(&mut *engine, layer_id, horizontal)
        
}

pub fn rotate_layer_90(engine: &mut EngineInner, layer_id: &str, clockwise: bool) -> Result<(), String> {
    layer_manager::rotate_texture_90(&mut *engine, layer_id, clockwise)
        
}

pub fn scale_layer_texture(engine: &mut EngineInner, layer_id: &str, new_w: u32, new_h: u32) -> Result<(), String> {
    layer_manager::scale_texture(&mut *engine, layer_id, new_w, new_h)
        
}

/// Resample a layer's mask to `dst_w` x `dst_h` through the inverse affine
/// map `src = [a c; b d] * dst + (e, f)`, in mask pixels.
pub fn remap_layer_mask(
    engine: &mut EngineInner, layer_id: &str, dst_w: u32, dst_h: u32,
    a: f32, b: f32, c: f32, d: f32, e: f32, f: f32,
) -> Result<(), String> {
    layer_manager::remap_layer_mask(&mut *engine, layer_id, dst_w, dst_h, [a, b, c, d, e, f])
        
}

pub fn resize_canvas_texture(
    engine: &mut EngineInner, layer_id: &str,
    old_layer_x: i32, old_layer_y: i32, old_w: u32, old_h: u32,
    new_w: u32, new_h: u32, offset_x: i32, offset_y: i32,
) -> Result<(), String> {
    layer_manager::resize_canvas_texture(
        &mut *engine, layer_id,
        old_layer_x, old_layer_y, old_w, old_h,
        new_w, new_h, offset_x, offset_y,
    )
}

pub fn crop_layer_texture(
    engine: &mut EngineInner, layer_id: &str,
    layer_x: i32, layer_y: i32,
    crop_x: i32, crop_y: i32, crop_w: u32, crop_h: u32,
) -> Result<(), String> {
    layer_manager::crop_texture(
        &mut *engine, layer_id,
        layer_x, layer_y, crop_x, crop_y, crop_w, crop_h,
    )
}

/// Expand a raster layer's GPU texture to cover at least the full document
/// area, preserving any content that extends beyond the document bounds.
/// Returns [x, y, w, h] of the resulting texture on success, or [] on error.
pub fn expand_layer_to_doc_size(engine: &mut EngineInner, layer_id: &str) -> Vec<f64> {
    match layer_manager::expand_layer_to_doc_size(&mut *engine, layer_id) {
        Ok([x, y, w, h]) => vec![x as f64, y as f64, w as f64, h as f64],
        Err(_) => vec![],
    }
}

/// Crop a raster layer's GPU texture to the bounding box of its non-transparent
/// pixels. Returns [new_x, new_y, new_w, new_h] on success, or [] on error.
/// If fully transparent, returns [x, y, 0, 0].
pub fn crop_layer_to_content(engine: &mut EngineInner, layer_id: &str) -> Vec<f64> {
    match layer_manager::crop_layer_to_content(&mut *engine, layer_id) {
        Ok([x, y, w, h]) => vec![x as f64, y as f64, w as f64, h as f64],
        Err(_) => vec![],
    }
}

pub fn clipboard_copy(
    engine: &mut EngineInner,
    layer_id: &str,
    has_selection: bool,
    bounds_x: i32,
    bounds_y: i32,
    bounds_w: u32,
    bounds_h: u32,
) -> Result<Vec<i32>, String> {
    let (w, h, ox, oy) = layer_manager::clipboard_copy(
        &mut *engine, layer_id, has_selection, bounds_x, bounds_y, bounds_w, bounds_h,
    )?;
    Ok(vec![w as i32, h as i32, ox, oy])
}

pub fn clipboard_cut(
    engine: &mut EngineInner,
    layer_id: &str,
    has_selection: bool,
    bounds_x: i32,
    bounds_y: i32,
    bounds_w: u32,
    bounds_h: u32,
) -> Result<Vec<i32>, String> {
    // Copy first
    let (w, h, ox, oy) = layer_manager::clipboard_copy(
        &mut *engine, layer_id, has_selection, bounds_x, bounds_y, bounds_w, bounds_h,
    )?;
    // Then clear selected pixels
    layer_manager::clipboard_clear_selected(&mut *engine, layer_id, has_selection)
        ?;
    Ok(vec![w as i32, h as i32, ox, oy])
}

/// Clear pixels in the selection (or whole layer) without touching the
/// retained internal clipboard. Delete/Backspace uses this instead of
/// `clipboardCut` — `clipboardCut` re-copies into `engine.clipboard_texture`
/// as a side effect, which clobbers a paste-in-place copy made earlier with
/// `clipboardCopy`/`clipboardCut` (see #870).
pub fn clear_selected_pixels(
    engine: &mut EngineInner,
    layer_id: &str,
    has_selection: bool,
) -> Result<(), String> {
    layer_manager::clipboard_clear_selected(&mut *engine, layer_id, has_selection)
        
}

pub fn clipboard_paste(
    engine: &mut EngineInner,
    dst_layer_id: &str,
) -> Result<(), String> {
    layer_manager::clipboard_paste(&mut *engine, dst_layer_id)
        
}

pub fn read_clipboard_pixels(engine: &EngineInner) -> Result<Vec<u8>, String> {
    layer_manager::read_clipboard_pixels(&*engine)
        
}

pub fn upload_clipboard_pixels(
    engine: &mut EngineInner,
    data: &[u8],
    width: u32,
    height: u32,
    offset_x: i32,
    offset_y: i32,
) -> Result<(), String> {
    layer_manager::upload_clipboard_pixels(&mut *engine, data, width, height, offset_x, offset_y)
        
}

// ============================================================
// Floating Selection (Phase 5)
// ============================================================

pub fn float_selection(engine: &mut EngineInner, layer_id: &str) -> Result<Vec<f64>, String> {
    layer_manager::float_selection(&mut *engine, layer_id)
        .map(|b| b.to_vec())
        
}

pub fn restore_float_base(engine: &mut EngineInner, src_id: &str) -> Result<(), String> {
    layer_manager::restore_float_base(&mut *engine, src_id)
        
}

pub fn composite_float(engine: &mut EngineInner, dx: i32, dy: i32) -> Result<(), String> {
    layer_manager::composite_float(&mut *engine, dx, dy)
        
}

pub fn drop_float(engine: &mut EngineInner) {
    layer_manager::drop_float(&mut *engine);
}

/// Grow the active float so it covers the document-space rect (x, y, w, h).
/// Returns the float layer's new [x, y, w, h], or [] when it already covered
/// the rect.
pub fn ensure_float_covers(engine: &mut EngineInner, x: i32, y: i32, w: u32, h: u32) -> Result<Vec<i32>, String> {
    layer_manager::ensure_float_covers(&mut *engine, x, y, w, h)
        .map(|grown| grown.map(|b| b.to_vec()).unwrap_or_default())
        
}

pub fn has_float(engine: &EngineInner) -> bool {
    engine.float_texture.is_some() || !engine.layer_transform.is_empty()
}

// ============================================================
// Multi-layer transform (see layer_transform_gpu)
// ============================================================

/// Lift a layer's content into the multi-layer transform session. Returns its
/// document rect [x, y, w, h], or [] for an empty layer (left out).
pub fn begin_layer_transform(engine: &mut EngineInner, layer_id: &str) -> Result<Vec<i32>, String> {
    layer_transform_gpu::begin_layer_transform(&mut *engine, layer_id)
        .map(|r| r.map(|r| vec![r.x, r.y, r.width as i32, r.height as i32]).unwrap_or_default())
        
}

/// Set the document rect the next render of `layer_id` writes, growing its
/// texture to hold it. Returns the layer's new [x, y, w, h], or [] when the
/// texture already covered it.
pub fn prepare_layer_transform_target(
    engine: &mut EngineInner,
    layer_id: &str,
    x: i32,
    y: i32,
    w: u32,
    h: u32,
) -> Result<Vec<i32>, String> {
    layer_transform_gpu::prepare_layer_transform_target(&mut *engine, layer_id, Rect::new(x, y, w, h))
        .map(|grown| grown.map(|b| b.to_vec()).unwrap_or_default())
        
}

pub fn composite_layer_transform_affine(
    engine: &mut EngineInner,
    inv_matrix: &[f32],
    src_center_x: f32,
    src_center_y: f32,
    dst_center_x: f32,
    dst_center_y: f32,
) -> Result<(), String> {
    let mut inv = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0];
    if inv_matrix.len() >= 9 {
        inv.copy_from_slice(&inv_matrix[..9]);
    }
    let params = layer_transform_gpu::TransformParams::Affine {
        inv_matrix: inv,
        src_center: [src_center_x, src_center_y],
        dst_center: [dst_center_x, dst_center_y],
    };
    layer_transform_gpu::composite_layer_transform(&mut *engine, &params)
        
}

pub fn composite_layer_transform_perspective(
    engine: &mut EngineInner,
    corners: &[f32],
    orig_x: f32,
    orig_y: f32,
    orig_w: f32,
    orig_h: f32,
) -> Result<(), String> {
    let mut c = [0.0; 8];
    if corners.len() >= 8 {
        c.copy_from_slice(&corners[..8]);
    }
    let params = layer_transform_gpu::TransformParams::Perspective {
        corners: c,
        orig_rect: [orig_x, orig_y, orig_w, orig_h],
    };
    layer_transform_gpu::composite_layer_transform(&mut *engine, &params)
        
}

/// Whether a multi-layer transform session is live.
pub fn has_layer_transform(engine: &EngineInner) -> bool {
    !engine.layer_transform.is_empty()
}

pub fn composite_float_affine(
    engine: &mut EngineInner,
    inv_matrix: &[f32],
    src_center_x: f32,
    src_center_y: f32,
    dst_center_x: f32,
    dst_center_y: f32,
    src_width: f32,
    src_height: f32,
) -> Result<(), String> {
    layer_manager::composite_float_affine(
        &mut *engine, inv_matrix, src_center_x, src_center_y, dst_center_x, dst_center_y,
        src_width, src_height,
    )
}

pub fn composite_float_perspective(
    engine: &mut EngineInner,
    corners: &[f32],
    orig_x: f32,
    orig_y: f32,
    orig_w: f32,
    orig_h: f32,
) -> Result<(), String> {
    layer_manager::composite_float_perspective(&mut *engine, corners, orig_x, orig_y, orig_w, orig_h)
        
}

pub fn fill_with_color(
    engine: &mut EngineInner,
    layer_id: &str,
    r: f32,
    g: f32,
    b: f32,
    a: f32,
) -> Result<(), String> {
    layer_manager::fill_with_color(&mut *engine, layer_id, r, g, b, a)
        
}

/// Solid-fill a layer except for the document-space rect `hole_*`, which is
/// left transparent. A zero-sized hole fills the whole layer.
#[allow(clippy::too_many_arguments)]
pub fn fill_layer_frame(
    engine: &mut EngineInner,
    layer_id: &str,
    r: f32,
    g: f32,
    b: f32,
    a: f32,
    hole_x: i32,
    hole_y: i32,
    hole_w: u32,
    hole_h: u32,
) -> Result<(), String> {
    let hole = (hole_w > 0 && hole_h > 0).then(|| Rect::new(hole_x, hole_y, hole_w, hole_h));
    layer_manager::fill_layer_frame(&mut *engine, layer_id, [r, g, b, a], hole)
        
}

pub fn fill_mask_with_value(
    engine: &mut EngineInner,
    layer_id: &str,
    value: f32,
) -> Result<(), String> {
    layer_manager::fill_mask_with_value(&mut *engine, layer_id, value)
        
}

// ============================================================
// Compressed Layer I/O
// ============================================================

pub fn upload_layer_pixels_compressed(engine: &mut EngineInner, layer_id: &str, compressed: &[u8]) -> Result<(), String> {
    if compressed.len() < 24 {
        return Err("Compressed data too short (need at least 24-byte header)".to_string());
    }

    // Read 24-byte header: crop_x, crop_y, crop_w, crop_h, full_w, full_h
    let crop_x = i32::from_le_bytes([compressed[0], compressed[1], compressed[2], compressed[3]]);
    let crop_y = i32::from_le_bytes([compressed[4], compressed[5], compressed[6], compressed[7]]);
    let crop_w = i32::from_le_bytes([compressed[8], compressed[9], compressed[10], compressed[11]]);
    let crop_h = i32::from_le_bytes([compressed[12], compressed[13], compressed[14], compressed[15]]);
    let full_w = i32::from_le_bytes([compressed[16], compressed[17], compressed[18], compressed[19]]);
    let full_h = i32::from_le_bytes([compressed[20], compressed[21], compressed[22], compressed[23]]);

    if crop_w <= 0 || crop_h <= 0 || full_w <= 0 || full_h <= 0 {
        return Err("Invalid dimensions in compressed header".to_string());
    }

    let pixel_data = &compressed[24..];
    let expected_len = (crop_w as usize) * (crop_h as usize) * 4;
    if pixel_data.len() < expected_len {
        return Err("Snapshot pixel data shorter than header dimensions".to_string());
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
        &mut *engine,
        layer_id,
        &full_pixels,
        full_w as u32,
        full_h as u32,
        0, 0,
    )?;

    Ok(())
}

pub fn read_layer_pixels_compressed_u16(engine: &EngineInner, layer_id: &str) -> Vec<u8> {
    read_layer_blob_u16(engine, layer_id, false)
}

/// Same blob as `readLayerPixelsCompressedU16`, LZ4-compressed (flags 2).
/// Used for the CPU-side backup taken when the tab loses focus, which
/// holds every raster layer at once (#973).
pub fn read_layer_pixels_lz4_u16(engine: &EngineInner, layer_id: &str) -> Vec<u8> {
    read_layer_blob_u16(engine, layer_id, true)
}

fn read_layer_blob_u16(engine: &EngineInner, layer_id: &str, is_lz4: bool) -> Vec<u8> {
    let tex = match engine.layer_textures.get(layer_id) {
        Some(&t) => t,
        None => return Vec::new(),
    };
    let (w, h) = engine.texture_pool.get_size(tex).unwrap_or((0, 0));
    if w == 0 || h == 0 {
        return Vec::new();
    }

    // Crop and convert to LE bytes in one pass, dropping the full-size
    // Vec<u16> before building the byte buffer. This keeps peak WASM
    // allocation at ~2× the cropped layer size instead of ~4×.
    let (raw_bytes, rect) = {
        let pixels = match layer_manager::read_pixels_u16(&*engine, layer_id) {
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
    let uncompressed_len = raw_bytes.len() as u32;
    let (flags, payload) = if is_lz4 {
        (2i32, lopsy_core::compress::lz4_compress(&raw_bytes))
    } else {
        (0i32, raw_bytes)
    };

    let mut result = Vec::with_capacity(32 + payload.len());
    result.extend_from_slice(&rect.x.to_le_bytes());
    result.extend_from_slice(&rect.y.to_le_bytes());
    result.extend_from_slice(&(rect.width as i32).to_le_bytes());
    result.extend_from_slice(&(rect.height as i32).to_le_bytes());
    result.extend_from_slice(&(w as i32).to_le_bytes());
    result.extend_from_slice(&(h as i32).to_le_bytes());
    result.extend_from_slice(&flags.to_le_bytes()); // 0 = raw, 2 = LZ4
    result.extend_from_slice(&uncompressed_len.to_le_bytes());
    result.extend_from_slice(&payload);
    result
}

pub fn upload_layer_pixels_compressed_u16(engine: &mut EngineInner, layer_id: &str, compressed: &[u8]) -> Result<(), String> {
    if compressed.len() < 24 {
        return Err("Compressed data too short (need at least 24-byte header)".to_string());
    }

    let crop_x = i32::from_le_bytes([compressed[0], compressed[1], compressed[2], compressed[3]]);
    let crop_y = i32::from_le_bytes([compressed[4], compressed[5], compressed[6], compressed[7]]);
    let crop_w = i32::from_le_bytes([compressed[8], compressed[9], compressed[10], compressed[11]]);
    let crop_h = i32::from_le_bytes([compressed[12], compressed[13], compressed[14], compressed[15]]);
    let full_w = i32::from_le_bytes([compressed[16], compressed[17], compressed[18], compressed[19]]);
    let full_h = i32::from_le_bytes([compressed[20], compressed[21], compressed[22], compressed[23]]);

    if crop_w <= 0 || crop_h <= 0 || full_w <= 0 || full_h <= 0 {
        return Err("Invalid dimensions in compressed header".to_string());
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
        return Err("Snapshot data too short for any known format".to_string());
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
        &mut *engine,
        layer_id,
        &full_pixels,
        full_w as u32,
        full_h as u32,
    )?;

    Ok(())
}

pub fn read_layer_thumbnail(engine: &EngineInner, layer_id: &str, max_size: u32) -> Vec<u8> {
    let tex_handle = match engine.layer_textures.get(layer_id) {
        Some(&t) => t,
        None => return Vec::new(),
    };
    if engine.texture_pool.get(tex_handle).is_none() {
        return Vec::new();
    }
    let (w, h) = engine.texture_pool.get_size(tex_handle).unwrap_or((0, 0));
    thumbnail_gpu::read_box_thumbnail(&*engine, tex_handle, w, h, max_size, thumbnail_gpu::COLOUR)
}

/// Read the composited document (all layers flattened) as a thumbnail.
///
/// Box-downscales on the GPU, then reads back only the thumbnail-sized
/// result. Previously this read back the full composite (`doc_w * doc_h * 4`
/// bytes — ~67 MB at 4K) and then ran a single-threaded CPU rescale over
/// every pixel to produce a fixed-size ~240 px minimap. The Navigator panel
/// calls this on a 200 ms interval whenever it's open, so the readback ran
/// five times a second even with the app idle. See issue #681.
///
/// Returns 8-byte header [width_u32_le, height_u32_le] + RGBA pixels.
pub fn read_composite_thumbnail(engine: &EngineInner, max_size: u32) -> Vec<u8> {
    let composite = engine.composite_texture;
    if engine.texture_pool.get(composite).is_none() {
        return Vec::new();
    }
    let (w, h) = (engine.doc_width, engine.doc_height);
    thumbnail_gpu::read_box_thumbnail(&*engine, composite, w, h, max_size, thumbnail_gpu::COLOUR)
}

// ============================================================
// GPU Texture Snapshots — instant blit, no readback
// ============================================================

/// Snapshot a layer's GPU texture by blitting to a new texture (~1ms).
/// Returns an opaque u32 handle. No pixel readback, no compression.
pub fn snapshot_layer_gpu(engine: &mut EngineInner, layer_id: &str) -> u32 {
    layer_manager::snapshot_layer(&mut *engine, layer_id)
}

/// Restore a layer's GPU texture from a snapshot (GPU blit, ~1ms).
pub fn restore_from_gpu_snapshot(engine: &mut EngineInner, layer_id: &str, snap_id: u32) -> Result<(), String> {
    layer_manager::restore_layer_from_snapshot(&mut *engine, layer_id, snap_id)
        
}

/// Snapshot a layer's mask texture by blitting to a new texture. Shares
/// the snapshot store (and handle space) with `snapshotLayerGpu`, so the
/// handle is freed with `releaseGpuSnapshot`. Returns `u32::MAX` when the
/// layer has no mask on the engine.
pub fn snapshot_mask_gpu(engine: &mut EngineInner, layer_id: &str) -> u32 {
    layer_manager::snapshot_mask(&mut *engine, layer_id)
}

/// Restore a layer's mask texture from a snapshot taken by
/// `snapshotMaskGpu` (GPU blit, no upload).
pub fn restore_mask_from_gpu_snapshot(engine: &mut EngineInner, layer_id: &str, snap_id: u32) -> Result<(), String> {
    layer_manager::restore_mask_from_snapshot(&mut *engine, layer_id, snap_id)
        
}

/// Release a snapshot texture, freeing GPU memory.
pub fn release_gpu_snapshot(engine: &mut EngineInner, snap_id: u32) {
    if let Some(slot) = engine.snapshot_textures.get_mut(snap_id as usize) {
        if let Some(snap) = slot.take() {
            engine.texture_pool.release(snap.handle);
            engine.snapshot_free_list.push(snap_id);
        }
    }
}

/// Clear all snapshot textures (e.g. on new document).
pub fn clear_gpu_snapshots(engine: &mut EngineInner) {
    for slot in &mut engine.snapshot_textures {
        if let Some(snap) = slot.take() {
            engine.texture_pool.release(snap.handle);
        }
    }
    engine.snapshot_textures.clear();
    engine.snapshot_free_list.clear();
}

/// Number of snapshot textures currently allocated. Released slots are
/// reused, so this — not the largest handle ever returned — is the live
/// GPU cost of the undo history (#1005).
pub fn live_gpu_snapshot_count(engine: &EngineInner) -> u32 {
    engine.snapshot_textures.iter().filter(|s| s.is_some()).count() as u32
}

/// The live compositor's effect cache: `[entries, images, bytes, budget
/// bytes, hits, misses]`. `bytes` is the VRAM its cached images hold;
/// hits and misses count per-layer lookups since the engine started.
pub fn effect_cache_stats(engine: &EngineInner) -> Vec<f64> {
    let stats = crate::effect_cache_gpu::stats(&*engine);
    vec![
        f64::from(stats.entries),
        f64::from(stats.images),
        stats.bytes as f64,
        engine.effect_cache.budget_bytes() as f64,
        stats.hits as f64,
        stats.misses as f64,
    ]
}
