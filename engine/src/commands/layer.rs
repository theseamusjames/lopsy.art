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
use crate::gpu::read::Read;
use crate::task::Cx;
use crate::{document::compositor, document::layer_manager, document::layer_transform_gpu, document::thumbnail_gpu};

// ============================================================
// Layer Management
// ============================================================

pub fn add_layer(engine: &mut EngineInner, layer_desc_json: &str) -> Result<(), String> {
    let desc: LayerDesc = serde_json::from_str(layer_desc_json)
        .map_err(|e| format!("Invalid layer JSON: {e}"))?;
    layer_manager::add_layer(&mut *engine, desc)
}

/// The largest width and height of a texture this engine's GPU accepts:
/// what a layer, the document and every texture of the develop chain may
/// be at most. On wgpu the adapter's limit (the device is asked for it);
/// on WebGL `MAX_TEXTURE_SIZE`, or `u32::MAX` where the context does not
/// say.
pub fn max_texture_size(engine: &EngineInner) -> u32 {
    engine.texture_pool.max_size()
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

/// Flatten the document into `layer_id` without reading it back: see
/// `compositor::flatten_into_layer`.
pub async fn flatten_into_layer(cx: Cx, layer_id: String) -> Result<(), String> {
    compositor::flatten_into_layer(&cx, &layer_id).await
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

pub fn read_layer_pixels(engine: &EngineInner, layer_id: &str) -> Read<Vec<u8>> {
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

/// Decode a Sony ARW and upload it to a layer texture as f32 RGBA, as
/// `decode_and_upload_dng` does a DNG (`lopsy_core::arw::read_arw`: sRGB,
/// upright, cropped). Returns JSON: `{ width, height, baselineExposure,
/// toneCurve, cameraModel, colorApproximate, colorNote, notApplied,
/// previewExposureEv }`, the first four as for a DNG (`baselineExposure`
/// 0, `toneCurve` empty), `colorApproximate` false for a body with measured
/// colour (`lopsy_core::arw::colour`), else true with `colorNote` the
/// sentence to show (absent when there is none), `notApplied` the
/// corrections the file records that the decode does not apply,
/// `previewExposureEv` the exposure in stops applied to match the camera's
/// embedded preview (`lopsy_core::arw::exposure`; 0 without one). An error
/// is a sentence a person can read (an unsupported Sony format or
/// variant, a damaged file).
pub fn decode_and_upload_arw(
    engine: &mut EngineInner,
    layer_id: &str,
    data: &[u8],
) -> Result<String, String> {
    let arw = lopsy_core::arw::read_arw(data)?;
    let img = &arw.image;
    layer_manager::upload_pixels_f32(&mut *engine, layer_id, &img.pixels, img.width, img.height)?;
    for line in &img.debug_log {
        crate::host::log(crate::host::LogLevel::Info, line);
    }

    #[derive(serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct ArwMeta<'a> {
        width: u32,
        height: u32,
        baseline_exposure: f64,
        tone_curve: Vec<[f64; 2]>,
        camera_model: &'a str,
        color_approximate: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        color_note: Option<&'a str>,
        not_applied: &'a [String],
        preview_exposure_ev: f32,
    }

    let meta = ArwMeta {
        width: img.width,
        height: img.height,
        baseline_exposure: img.baseline_exposure,
        tone_curve: img.tone_curve.iter().map(|&(x, y)| [x, y]).collect(),
        camera_model: &arw.camera_model,
        color_approximate: arw.colour.is_approximate(),
        color_note: arw.colour.note(),
        not_applied: &arw.not_applied,
        preview_exposure_ev: arw.exposure_ev,
    };
    serde_json::to_string(&meta).map_err(|e| format!("JSON serialize: {e}"))
}

/// Decode any RAW the RAW interface knows (`lopsy_core::raw::sniff`) to its
/// finished look, whole-frame, into a layer: a DNG as
/// `decode_and_upload_dng`, an ARW as `decode_and_upload_arw`, a RAF with
/// `raf::read_raf`. Returns that decode's JSON with `format` added (a RAF's
/// is `{ format, width, height }`). For the hosts' legacy path and for DNG
/// versions edited before DNG took the RAW develop path.
pub fn decode_and_upload_raw_baked(engine: &mut EngineInner, layer_id: &str, data: &[u8]) -> Result<String, String> {
    use lopsy_core::raw::RawFormatId;
    let format = lopsy_core::raw::sniff(data).ok_or("This file is not a RAW format this app reads")?;
    let json = match format {
        RawFormatId::Dng => decode_and_upload_dng(engine, layer_id, data)?,
        RawFormatId::Arw => decode_and_upload_arw(engine, layer_id, data)?,
        RawFormatId::Raf => {
            let img = lopsy_core::raf::read_raf(data).map_err(|e| format!("RAF decode failed: {e}"))?;
            layer_manager::upload_pixels_f32(&mut *engine, layer_id, &img.pixels, img.width, img.height)?;
            for line in &img.debug_log {
                crate::host::log(crate::host::LogLevel::Info, line);
            }
            serde_json::json!({ "width": img.width, "height": img.height }).to_string()
        }
    };
    let mut meta: serde_json::Value = serde_json::from_str(&json).map_err(|e| format!("JSON: {e}"))?;
    if let Some(obj) = meta.as_object_mut() {
        obj.insert("format".into(), serde_json::Value::String(format.as_str().into()));
    }
    Ok(meta.to_string())
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

pub async fn get_layer_content_bounds(cx: Cx, layer_id: String) -> Vec<i32> {
    match layer_manager::layer_content_bounds(&cx, &layer_id).await {
        Ok(rect) => vec![rect.x, rect.y, rect.width as i32, rect.height as i32],
        Err(_) => Vec::new(),
    }
}

/// Bake a layer's effects (and, with `bake_mask`, its mask) into its own
/// texture without reading it back: see `compositor::bake_layer_effects`.
pub fn bake_layer_effects(engine: &mut EngineInner, layer_id: &str, bake_mask: bool) -> Result<(), String> {
    compositor::bake_layer_effects(engine, layer_id, bake_mask)
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

/// Resample a layer texture into `new_w` x `new_h` through
/// `src_uv = dst_uv * (scale_x, scale_y) + (offset_x, offset_y)`; transparent
/// outside the source.
#[allow(clippy::too_many_arguments)]
pub fn resample_layer_texture(
    engine: &mut EngineInner, layer_id: &str, new_w: u32, new_h: u32,
    scale_x: f32, scale_y: f32, offset_x: f32, offset_y: f32,
) -> Result<(), String> {
    layer_manager::resample_texture_region(&mut *engine, layer_id, new_w, new_h, [scale_x, scale_y], [offset_x, offset_y])
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

/// Crop a raster layer's GPU texture to its content bounds, given
/// texture-local as the host read them with `get_layer_content_bounds`.
/// Returns [new_x, new_y, new_w, new_h] on success, or [] on error.
/// If fully transparent, returns [x, y, 0, 0].
pub fn crop_layer_to_content(
    engine: &mut EngineInner,
    layer_id: &str,
    content_x: i32,
    content_y: i32,
    content_width: u32,
    content_height: u32,
) -> Vec<f64> {
    let content = lopsy_core::geometry::Rect::new(content_x, content_y, content_width, content_height);
    match layer_manager::crop_layer_to_content(&mut *engine, layer_id, content) {
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

/// Copy Merged: the flattened document through the selection, into the
/// clipboard texture, without reading it back. Returns
/// `[width, height, offset_x, offset_y]`.
pub async fn clipboard_copy_merged(
    cx: Cx,
    has_selection: bool,
    bounds_x: i32,
    bounds_y: i32,
    bounds_w: u32,
    bounds_h: u32,
) -> Result<Vec<i32>, String> {
    let (w, h, ox, oy) =
        compositor::copy_merged_to_clipboard(&cx, has_selection, bounds_x, bounds_y, bounds_w, bounds_h).await?;
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
/// `clipboardCut` — `clipboardCut` re-copies into `engine.clipboard.texture`
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

pub fn read_clipboard_pixels(engine: &EngineInner) -> Read<Vec<u8>> {
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
    engine.float.texture.is_some() || !engine.layer_transform.is_empty()
}

// ============================================================
// Multi-layer transform (see layer_transform_gpu)
// ============================================================

/// Lift a layer's content into the multi-layer transform session. The
/// content bounds are given texture-local, as the host read them with
/// `get_layer_content_bounds`. Returns the content's document rect
/// [x, y, w, h], or [] for an empty layer (left out).
pub fn begin_layer_transform(
    engine: &mut EngineInner,
    layer_id: &str,
    content_x: i32,
    content_y: i32,
    content_width: u32,
    content_height: u32,
) -> Result<Vec<i32>, String> {
    let content = lopsy_core::geometry::Rect::new(content_x, content_y, content_width, content_height);
    layer_transform_gpu::begin_layer_transform(&mut *engine, layer_id, content)
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
/// left transparent. A zero-sized hole fills the whole layer. The radii
/// round the document's corners and the hole's (0 keeps them square).
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
    outer_radius: f32,
    inner_radius: f32,
) -> Result<(), String> {
    let hole = (hole_w > 0 && hole_h > 0).then(|| Rect::new(hole_x, hole_y, hole_w, hole_h));
    layer_manager::fill_layer_frame(&mut *engine, layer_id, [r, g, b, a], hole, outer_radius, inner_radius)
        
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
    let (full_w, full_h, full_pixels) = decode_blob_u8(compressed, engine.texture_pool.max_size())?;
    layer_manager::upload_pixels(&mut *engine, layer_id, &full_pixels, full_w, full_h, 0, 0)?;
    Ok(())
}

/// Where a compressed blob's cropped pixels sit in its full-size layer.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct BlobRect {
    x: usize,
    y: usize,
    w: usize,
    h: usize,
    full_w: usize,
    full_h: usize,
}

/// Read and check a blob's 24-byte geometry header. Blobs come from `.lopsy`
/// files as well as the in-session backup, so nothing in the header is
/// trusted: the crop must lie inside the full size, and neither side may
/// exceed `max_side` (the GPU's texture limit), which also bounds what is
/// allocated from it.
fn parse_blob_rect(compressed: &[u8], max_side: u32) -> Result<BlobRect, String> {
    if compressed.len() < 24 {
        return Err("Compressed data too short (need at least 24-byte header)".to_string());
    }
    let field = |i: usize| i32::from_le_bytes([compressed[i], compressed[i + 1], compressed[i + 2], compressed[i + 3]]);
    let (x, y, w, h, full_w, full_h) = (field(0), field(4), field(8), field(12), field(16), field(20));
    if w <= 0 || h <= 0 || full_w <= 0 || full_h <= 0 || x < 0 || y < 0 {
        return Err("Invalid dimensions in compressed header".to_string());
    }
    if full_w as u32 > max_side || full_h as u32 > max_side {
        return Err(format!("Layer of {full_w}x{full_h} exceeds the {max_side}px texture limit"));
    }
    if x as i64 + w as i64 > full_w as i64 || y as i64 + h as i64 > full_h as i64 {
        return Err("Compressed crop lies outside the layer".to_string());
    }
    Ok(BlobRect { x: x as usize, y: y as usize, w: w as usize, h: h as usize, full_w: full_w as usize, full_h: full_h as usize })
}

/// Paste `cropped` (`rect.w`×`rect.h` pixels of `T` × 4 channels) into a
/// zeroed full-size buffer.
fn place_crop<T: Copy + Default>(rect: BlobRect, cropped: &[T]) -> Vec<T> {
    let mut full = vec![T::default(); rect.full_w * rect.full_h * 4];
    let len = rect.w * 4;
    for row in 0..rect.h {
        let dst = ((rect.y + row) * rect.full_w + rect.x) * 4;
        full[dst..dst + len].copy_from_slice(&cropped[row * len..row * len + len]);
    }
    full
}

/// An 8-bit blob (24-byte header, then RGBA8 crop) as (width, height,
/// full-size RGBA8).
fn decode_blob_u8(compressed: &[u8], max_side: u32) -> Result<(u32, u32, Vec<u8>), String> {
    let rect = parse_blob_rect(compressed, max_side)?;
    let pixel_data = &compressed[24..];
    if pixel_data.len() < rect.w * rect.h * 4 {
        return Err("Snapshot pixel data shorter than header dimensions".to_string());
    }
    Ok((rect.full_w as u32, rect.full_h as u32, place_crop(rect, pixel_data)))
}

/// A layer's content-cropped pixels as a 16-bit blob, LZ4-compressed
/// (flags 2), that `uploadLayerPixelsCompressedU16` takes back. Used for
/// the CPU-side backup taken when the tab loses focus, which holds every
/// raster layer at once (#973).
pub fn read_layer_pixels_lz4_u16(engine: &EngineInner, layer_id: &str) -> Read<Vec<u8>> {
    let tex = match engine.layer_textures.get(layer_id) {
        Some(&t) => t,
        None => return Read::ready(Ok(Vec::new())),
    };
    let (w, h) = engine.texture_pool.get_size(tex).unwrap_or((0, 0));
    if w == 0 || h == 0 {
        return Read::ready(Ok(Vec::new()));
    }
    layer_manager::read_pixels_u16(engine, layer_id).map(move |pixels| lz4_u16_blob(pixels, w, h)).or(Vec::new())
}

/// A `w` by `h` layer's 16-bit pixels cropped to their content and packed
/// as the backup blob; empty for a layer with no content.
fn lz4_u16_blob(pixels: Vec<u16>, w: u32, h: u32) -> Vec<u8> {

    // Crop and convert to LE bytes in one pass, dropping the full-size
    // Vec<u16> before building the byte buffer. This keeps peak WASM
    // allocation at ~2× the cropped layer size instead of ~4×.
    let (raw_bytes, rect) = {
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
    let flags = 2i32;
    let payload = lopsy_core::compress::lz4_compress(&raw_bytes);

    let mut result = Vec::with_capacity(32 + payload.len());
    result.extend_from_slice(&rect.x.to_le_bytes());
    result.extend_from_slice(&rect.y.to_le_bytes());
    result.extend_from_slice(&(rect.width as i32).to_le_bytes());
    result.extend_from_slice(&(rect.height as i32).to_le_bytes());
    result.extend_from_slice(&(w as i32).to_le_bytes());
    result.extend_from_slice(&(h as i32).to_le_bytes());
    result.extend_from_slice(&flags.to_le_bytes()); // 2 = LZ4
    result.extend_from_slice(&uncompressed_len.to_le_bytes());
    result.extend_from_slice(&payload);
    result
}

pub fn upload_layer_pixels_compressed_u16(engine: &mut EngineInner, layer_id: &str, compressed: &[u8]) -> Result<(), String> {
    let (full_w, full_h, full_pixels) = decode_blob_u16(compressed, engine.texture_pool.max_size())?;
    layer_manager::upload_pixels_u16(&mut *engine, layer_id, &full_pixels, full_w, full_h)?;
    Ok(())
}

/// A 16-bit blob as (width, height, full-size RGBA u16). Two layouts: the
/// 24-byte header then raw LE u16 (old), or a 32-byte header adding
/// `flags` (0 raw, 1 RLE, 2 LZ4) and the uncompressed size. Every length is
/// checked against the header's crop before anything is sliced.
fn decode_blob_u16(compressed: &[u8], max_side: u32) -> Result<(u32, u32, Vec<u16>), String> {
    let rect = parse_blob_rect(compressed, max_side)?;
    let expected_raw_len = rect.w * rect.h * 4 * 2;

    let cropped_bytes: Vec<u8> = if compressed.len() == 24 + expected_raw_len {
        compressed[24..].to_vec()
    } else if compressed.len() >= 32 {
        let flags = i32::from_le_bytes([compressed[24], compressed[25], compressed[26], compressed[27]]);
        let uncompressed_size = u32::from_le_bytes([compressed[28], compressed[29], compressed[30], compressed[31]]) as usize;
        if uncompressed_size != expected_raw_len {
            return Err("Snapshot size does not match its header dimensions".to_string());
        }
        let payload = &compressed[32..];
        match flags {
            2 => lopsy_core::compress::lz4_decompress(payload, expected_raw_len)?,
            1 => lopsy_core::compress::rle_decompress_u16(payload, expected_raw_len)?,
            0 => payload.get(..expected_raw_len).ok_or("Snapshot pixel data shorter than header dimensions")?.to_vec(),
            other => return Err(format!("Unknown snapshot compression {other}")),
        }
    } else {
        return Err("Snapshot data too short for any known format".to_string());
    };
    if cropped_bytes.len() != expected_raw_len {
        return Err("Snapshot pixel data does not match its header dimensions".to_string());
    }

    let cropped: Vec<u16> = cropped_bytes.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
    drop(cropped_bytes);
    Ok((rect.full_w as u32, rect.full_h as u32, place_crop(rect, &cropped)))
}

pub fn read_layer_thumbnail(engine: &EngineInner, layer_id: &str, max_size: u32) -> Read<Vec<u8>> {
    let tex_handle = match engine.layer_textures.get(layer_id) {
        Some(&t) => t,
        None => return Read::ready(Ok(Vec::new())),
    };
    if engine.texture_pool.get(tex_handle).is_none() {
        return Read::ready(Ok(Vec::new()));
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
pub fn read_composite_thumbnail(engine: &EngineInner, max_size: u32) -> Read<Vec<u8>> {
    let composite = engine.composite_texture;
    if engine.texture_pool.get(composite).is_none() {
        return Read::ready(Ok(Vec::new()));
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

/// The engine's id, which the host's lost-device announcement names it by.
pub fn engine_id(engine: &EngineInner) -> u32 {
    engine.gpu_ctx.engine_id()
}

/// Lose the GPU device on purpose, to rehearse recovery. Returns `false`
/// on a backend that cannot: WebGL, where the page uses the
/// `WEBGL_lose_context` extension instead.
pub fn lose_gpu_device(engine: &EngineInner) -> bool {
    engine.gpu_ctx.lose_device()
}

/// The live compositor's effect cache: `[entries, images, bytes, budget
/// bytes, hits, misses]`. `bytes` is the VRAM its cached images hold;
/// hits and misses count per-layer lookups since the engine started.
pub fn effect_cache_stats(engine: &EngineInner) -> Vec<f64> {
    let stats = crate::document::effect_cache_gpu::stats(&*engine);
    vec![
        f64::from(stats.entries),
        f64::from(stats.images),
        stats.bytes as f64,
        engine.effect_cache.budget_bytes() as f64,
        stats.hits as f64,
        stats.misses as f64,
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn header(x: i32, y: i32, w: i32, h: i32, fw: i32, fh: i32) -> Vec<u8> {
        [x, y, w, h, fw, fh].iter().flat_map(|v| v.to_le_bytes()).collect()
    }

    fn u16_blob(flags: i32, payload: &[u8], uncompressed: usize, geom: [i32; 6]) -> Vec<u8> {
        let mut b = header(geom[0], geom[1], geom[2], geom[3], geom[4], geom[5]);
        b.extend_from_slice(&flags.to_le_bytes());
        b.extend_from_slice(&(uncompressed as u32).to_le_bytes());
        b.extend_from_slice(payload);
        b
    }

    #[test]
    fn a_valid_lz4_blob_lands_at_its_crop() {
        let raw: Vec<u8> = (0..2 * 2 * 8).map(|i| i as u8).collect();
        let blob = u16_blob(2, &lopsy_core::compress::lz4_compress(&raw), raw.len(), [1, 1, 2, 2, 4, 3]);
        let (w, h, px) = decode_blob_u16(&blob, 4096).unwrap();
        assert_eq!((w, h, px.len()), (4, 3, 4 * 3 * 4));
        assert_eq!(px[(4 + 1) * 4], u16::from_le_bytes([0, 1]));
        assert_eq!(px[0], 0);
    }

    #[test]
    fn corrupt_blobs_are_errors_not_panics() {
        let raw = vec![7u8; 2 * 2 * 8];
        let lz4 = lopsy_core::compress::lz4_compress(&raw);
        let cases: Vec<(&str, Vec<u8>)> = vec![
            ("short header", vec![0; 10]),
            ("crop past the right edge", u16_blob(2, &lz4, raw.len(), [3, 0, 2, 2, 4, 4])),
            ("crop past the bottom", u16_blob(2, &lz4, raw.len(), [0, 3, 2, 2, 4, 4])),
            ("negative crop origin", u16_blob(2, &lz4, raw.len(), [-1, 0, 2, 2, 4, 4])),
            ("huge layer", u16_blob(2, &lz4, raw.len(), [0, 0, 2, 2, 1 << 30, 4])),
            ("size disagrees with the header", u16_blob(2, &lz4, raw.len() + 8, [0, 0, 2, 2, 4, 4])),
            ("truncated LZ4", u16_blob(2, &lz4[..lz4.len() / 2], raw.len(), [0, 0, 2, 2, 4, 4])),
            ("garbage RLE", u16_blob(1, &[0x80, 1, 2], raw.len(), [0, 0, 2, 2, 4, 4])),
            ("short raw payload", u16_blob(0, &raw[..10], raw.len(), [0, 0, 2, 2, 4, 4])),
            ("unknown flags", u16_blob(9, &raw, raw.len(), [0, 0, 2, 2, 4, 4])),
        ];
        for (name, blob) in cases {
            assert!(decode_blob_u16(&blob, 4096).is_err(), "{name}");
        }
        let mut u8_blob = header(3, 3, 2, 2, 4, 4);
        u8_blob.extend_from_slice(&[1; 16]);
        assert!(decode_blob_u8(&u8_blob, 4096).is_err(), "8-bit crop outside the layer");
        let mut short = header(0, 0, 2, 2, 4, 4);
        short.extend_from_slice(&[1; 15]);
        assert!(decode_blob_u8(&short, 4096).is_err(), "8-bit data cut short");
        let mut ok = header(2, 2, 2, 2, 4, 4);
        ok.extend_from_slice(&[1; 16]);
        assert_eq!(decode_blob_u8(&ok, 4096).unwrap().2[(2 * 4 + 2) * 4], 1);
    }
}
