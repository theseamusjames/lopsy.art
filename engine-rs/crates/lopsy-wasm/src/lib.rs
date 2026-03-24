pub mod gpu;
pub mod engine;
pub mod compositor;
pub mod layer_manager;
pub mod brush_gpu;
pub mod filter_gpu;
pub mod gradient_gpu;
pub mod shape_gpu;
pub mod selection_gpu;
pub mod dodge_burn_gpu;
pub mod clone_stamp_gpu;
pub mod overlay_renderer;
pub mod color_mgmt;

use wasm_bindgen::prelude::*;
use web_sys::{HtmlCanvasElement, WebGl2RenderingContext};

use lopsy_core::color::{BlendMode, ColorSpace};
use lopsy_core::geometry;
use lopsy_core::layer::LayerDesc;

use crate::engine::EngineInner;
use crate::gpu::context::GpuContext;
use crate::gpu::shader::ShaderPrograms;

// ============================================================
// Engine wrapper for wasm_bindgen
// ============================================================

#[wasm_bindgen]
pub struct Engine {
    inner: EngineInner,
}

// ============================================================
// Engine Lifecycle
// ============================================================

#[wasm_bindgen(js_name = "createEngine")]
pub fn create_engine(canvas: HtmlCanvasElement) -> Result<Engine, JsError> {
    let gpu_ctx = GpuContext::new(&canvas).map_err(|e| JsError::new(&e))?;
    let shaders = ShaderPrograms::compile_all(&gpu_ctx.gl).map_err(|e| JsError::new(&e))?;
    let inner = EngineInner::new(gpu_ctx, shaders).map_err(|e| JsError::new(&e))?;
    Ok(Engine { inner })
}

#[wasm_bindgen(js_name = "setDocumentSize")]
pub fn set_document_size(engine: &mut Engine, width: u32, height: u32) -> Result<(), JsError> {
    engine.inner.set_document_size(width, height).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "setViewport")]
pub fn set_viewport(engine: &mut Engine, zoom: f64, pan_x: f64, pan_y: f64, screen_w: f64, screen_h: f64) {
    engine.inner.set_viewport(zoom, pan_x, pan_y, screen_w, screen_h);
}

#[wasm_bindgen(js_name = "setBackgroundColor")]
pub fn set_background_color(engine: &mut Engine, r: f32, g: f32, b: f32, a: f32) {
    engine.inner.set_background_color(r, g, b, a);
}

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

#[wasm_bindgen(js_name = "readLayerPixels")]
pub fn read_layer_pixels(engine: &Engine, layer_id: &str) -> Result<Vec<u8>, JsError> {
    layer_manager::read_pixels(&engine.inner, layer_id)
        .map_err(|e| JsError::new(&e))
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

    // Compute the content's DOCUMENT position: layer offset + crop offset.
    // This ensures the header position is always in document space,
    // regardless of whether the texture is full-size or already cropped.
    let layer_x = engine.inner.layer_stack.iter()
        .find(|l| l.id == layer_id)
        .map(|l| l.x)
        .unwrap_or(0);
    let layer_y = engine.inner.layer_stack.iter()
        .find(|l| l.id == layer_id)
        .map(|l| l.y)
        .unwrap_or(0);

    // Build result: 16-byte header (4 x i32 LE) + raw cropped pixel data
    // Header position = layer document position + crop offset within texture
    let mut result = Vec::with_capacity(16 + cropped.len());
    result.extend_from_slice(&(layer_x + rect.x).to_le_bytes());
    result.extend_from_slice(&(layer_y + rect.y).to_le_bytes());
    result.extend_from_slice(&(rect.width as i32).to_le_bytes());
    result.extend_from_slice(&(rect.height as i32).to_le_bytes());
    result.extend_from_slice(&cropped);
    result
}

#[wasm_bindgen(js_name = "uploadLayerPixelsCompressed")]
pub fn upload_layer_pixels_compressed(engine: &mut Engine, layer_id: &str, compressed: &[u8]) -> Result<(), JsError> {
    if compressed.len() < 16 {
        return Err(JsError::new("Compressed data too short (need at least 16-byte header)"));
    }

    // Read 16-byte header
    let x = i32::from_le_bytes([compressed[0], compressed[1], compressed[2], compressed[3]]);
    let y = i32::from_le_bytes([compressed[4], compressed[5], compressed[6], compressed[7]]);
    let w = i32::from_le_bytes([compressed[8], compressed[9], compressed[10], compressed[11]]);
    let h = i32::from_le_bytes([compressed[12], compressed[13], compressed[14], compressed[15]]);

    if w <= 0 || h <= 0 {
        return Err(JsError::new("Invalid dimensions in compressed header"));
    }

    let pixel_data = &compressed[16..];
    let expected_len = (w as usize) * (h as usize) * 4;
    if pixel_data.len() < expected_len {
        return Err(JsError::new("Snapshot pixel data shorter than header dimensions"));
    }

    // Upload the cropped pixels directly as a cropped texture at the header
    // position. This avoids expanding to full document size and prevents the
    // double-offset bug: if we expanded to full-size at (0,0), then syncLayers
    // would apply the layer's document position as an additional offset.
    layer_manager::upload_pixels(
        &mut engine.inner,
        layer_id,
        &pixel_data[..expected_len],
        w as u32,
        h as u32,
        x, y,
    ).map_err(|e| JsError::new(&e))?;

    // Set the engine layer to match the snapshot's position and size
    if let Some(desc) = engine.inner.layer_stack.iter_mut().find(|l| l.id == layer_id) {
        desc.x = x;
        desc.y = y;
        desc.width = w as u32;
        desc.height = h as u32;
    }

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

// ============================================================
// Brush / Paint Operations
// ============================================================

#[wasm_bindgen(js_name = "beginStroke")]
pub fn begin_stroke(engine: &mut Engine, layer_id: &str) -> Result<(), JsError> {
    brush_gpu::begin_stroke(&mut engine.inner, layer_id).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "applyBrushDab")]
pub fn apply_brush_dab(
    engine: &mut Engine, layer_id: &str,
    cx: f64, cy: f64,
    stamp_size: f32, hardness: f32,
    r: f32, g: f32, b: f32, a: f32,
    opacity: f32, flow: f32,
) {
    brush_gpu::apply_dab(&mut engine.inner, layer_id, cx, cy, stamp_size, hardness, r, g, b, a, opacity, flow);
}

#[wasm_bindgen(js_name = "applyBrushDabBatch")]
pub fn apply_brush_dab_batch(
    engine: &mut Engine, layer_id: &str,
    points: &[f64],
    stamp_size: f32, hardness: f32,
    r: f32, g: f32, b: f32, a: f32,
    opacity: f32, flow: f32,
) {
    brush_gpu::apply_dab_batch(&mut engine.inner, layer_id, points, stamp_size, hardness, r, g, b, a, opacity, flow);
}

#[wasm_bindgen(js_name = "applyEraserDab")]
pub fn apply_eraser_dab(
    engine: &mut Engine, layer_id: &str,
    cx: f64, cy: f64, stamp_size: f32, hardness: f32, opacity: f32,
) {
    brush_gpu::apply_eraser_dab(&mut engine.inner, layer_id, cx, cy, stamp_size, hardness, opacity);
}

#[wasm_bindgen(js_name = "applyEraserDabBatch")]
pub fn apply_eraser_dab_batch(
    engine: &mut Engine, layer_id: &str,
    points: &[f64], stamp_size: f32, hardness: f32, opacity: f32,
) {
    brush_gpu::apply_eraser_dab_batch(&mut engine.inner, layer_id, points, stamp_size, hardness, opacity);
}

#[wasm_bindgen(js_name = "drawPencilLine")]
pub fn draw_pencil_line(
    engine: &mut Engine, layer_id: &str,
    x0: f64, y0: f64, x1: f64, y1: f64,
    r: f32, g: f32, b: f32, a: f32, size: f32,
) {
    // Pencil renders hard square pixel blocks — NOT circular brush dabs.
    // Interpolate at 1px spacing, write square blocks via texSubImage2D.
    let points = lopsy_core::brush::interpolate_points(x0, y0, x1, y1, 1.0);
    let half = (size / 2.0).floor() as i32;
    let block_size = size.ceil() as i32;
    let r8 = (r * 255.0 + 0.5) as u8;
    let g8 = (g * 255.0 + 0.5) as u8;
    let b8 = (b * 255.0 + 0.5) as u8;
    let a8 = (a * 255.0 + 0.5) as u8;

    let eng = &mut engine.inner;
    if !eng.stroke_textures.contains_key(layer_id) {
        let _ = brush_gpu::begin_stroke(eng, layer_id);
    }
    if let Some(&stroke_handle) = eng.stroke_textures.get(layer_id) {
        let (tex_w, tex_h) = eng.texture_pool.get_size(stroke_handle).unwrap_or((1, 1));
        for i in (0..points.len()).step_by(2) {
            let cx = points[i] as i32;
            let cy = points[i + 1] as i32;
            let bx = (cx - half).max(0);
            let by = (cy - half).max(0);
            let bw = (block_size).min(tex_w as i32 - bx);
            let bh = (block_size).min(tex_h as i32 - by);
            if bw <= 0 || bh <= 0 { continue; }
            let count = (bw * bh) as usize;
            let mut rgba = vec![0u8; count * 4];
            for j in 0..count {
                rgba[j * 4] = r8;
                rgba[j * 4 + 1] = g8;
                rgba[j * 4 + 2] = b8;
                rgba[j * 4 + 3] = a8;
            }
            let _ = eng.texture_pool.upload_rgba(
                &eng.gl, stroke_handle, bx, by, bw as u32, bh as u32, &rgba,
            );
        }
        eng.gl.bind_texture(web_sys::WebGl2RenderingContext::TEXTURE_2D, None);
    }
    eng.needs_recomposite = true;
}

#[wasm_bindgen(js_name = "endStroke")]
pub fn end_stroke(engine: &mut Engine, layer_id: &str) {
    brush_gpu::end_stroke(&mut engine.inner, layer_id);
}

#[wasm_bindgen(js_name = "generateBrushStamp")]
pub fn generate_brush_stamp(size: u32, hardness: f32) -> Vec<f32> {
    lopsy_core::brush::generate_brush_stamp(size, hardness)
}

#[wasm_bindgen(js_name = "interpolatePoints")]
pub fn interpolate_points(from_x: f64, from_y: f64, to_x: f64, to_y: f64, spacing: f64) -> Vec<f64> {
    lopsy_core::brush::interpolate_points(from_x, from_y, to_x, to_y, spacing)
}

#[wasm_bindgen(js_name = "computeShiftClickLine")]
pub fn compute_shift_click_line(from_x: f64, from_y: f64, to_x: f64, to_y: f64) -> Vec<f64> {
    lopsy_core::brush::compute_shift_click_line(from_x, from_y, to_x, to_y).to_vec()
}

// ============================================================
// Dodge/Burn
// ============================================================

#[wasm_bindgen(js_name = "applyDodgeBurnDab")]
pub fn apply_dodge_burn_dab(
    engine: &mut Engine, layer_id: &str,
    cx: f64, cy: f64, size: f32, mode: u32, exposure: f32,
) {
    dodge_burn_gpu::apply_dodge_burn_dab(&mut engine.inner, layer_id, cx, cy, size, mode, exposure);
}

#[wasm_bindgen(js_name = "applyDodgeBurnDabBatch")]
pub fn apply_dodge_burn_dab_batch(
    engine: &mut Engine, layer_id: &str,
    points: &[f64], size: f32, mode: u32, exposure: f32,
) {
    dodge_burn_gpu::apply_dodge_burn_dab_batch(&mut engine.inner, layer_id, points, size, mode, exposure);
}

// ============================================================
// Clone Stamp
// ============================================================

#[wasm_bindgen(js_name = "applyStampDab")]
pub fn apply_stamp_dab(
    engine: &mut Engine, layer_id: &str,
    dest_x: f64, dest_y: f64,
    source_offset_x: f64, source_offset_y: f64, size: f32,
) {
    clone_stamp_gpu::apply_clone_stamp_dab(&mut engine.inner, layer_id, dest_x, dest_y, source_offset_x, source_offset_y, size);
}

#[wasm_bindgen(js_name = "applyStampDabBatch")]
pub fn apply_stamp_dab_batch(
    engine: &mut Engine, layer_id: &str,
    points: &[f64], source_offset_x: f64, source_offset_y: f64, size: f32,
) {
    clone_stamp_gpu::apply_clone_stamp_dab_batch(&mut engine.inner, layer_id, points, source_offset_x, source_offset_y, size);
}

// ============================================================
// Gradient
// ============================================================

#[wasm_bindgen(js_name = "renderLinearGradient")]
pub fn render_linear_gradient(
    engine: &mut Engine, layer_id: &str,
    start_x: f64, start_y: f64, end_x: f64, end_y: f64, stops_json: &str,
) {
    gradient_gpu::render_linear_gradient(&mut engine.inner, layer_id, start_x, start_y, end_x, end_y, stops_json);
}

#[wasm_bindgen(js_name = "renderRadialGradient")]
pub fn render_radial_gradient(
    engine: &mut Engine, layer_id: &str,
    cx: f64, cy: f64, radius: f64, stops_json: &str,
) {
    gradient_gpu::render_radial_gradient(&mut engine.inner, layer_id, cx, cy, radius, stops_json);
}

#[wasm_bindgen(js_name = "interpolateGradient")]
pub fn interpolate_gradient(stops_json: &str, t: f64) -> Vec<u8> {
    gradient_gpu::interpolate_gradient(stops_json, t)
}

#[wasm_bindgen(js_name = "computeLinearGradientT")]
pub fn compute_linear_gradient_t(px: f64, py: f64, sx: f64, sy: f64, ex: f64, ey: f64) -> f64 {
    let dx = ex - sx;
    let dy = ey - sy;
    let len_sq = dx * dx + dy * dy;
    if len_sq < 1e-10 { return 0.0; }
    ((px - sx) * dx + (py - sy) * dy) / len_sq
}

#[wasm_bindgen(js_name = "computeRadialGradientT")]
pub fn compute_radial_gradient_t(px: f64, py: f64, cx: f64, cy: f64, radius: f64) -> f64 {
    let dx = px - cx;
    let dy = py - cy;
    (dx * dx + dy * dy).sqrt() / radius
}

// ============================================================
// Eyedropper
// ============================================================

#[wasm_bindgen(js_name = "sampleColor")]
pub fn sample_color(engine: &Engine, x: f64, y: f64, sample_size: u32) -> Vec<u8> {
    let gl = &engine.inner.gl;
    let ix = x as i32;
    let iy = y as i32;
    let half = (sample_size / 2) as i32;

    // Read from composite FBO
    engine.inner.fbo_pool.bind(gl, engine.inner.composite_fbo);

    let pixels = engine.inner.texture_pool.read_rgba(
        gl, ix - half, iy - half, sample_size, sample_size,
    ).unwrap_or_else(|_| vec![0u8; (sample_size * sample_size * 4) as usize]);

    engine.inner.fbo_pool.unbind(gl);

    // Average the sampled pixels
    let count = (sample_size * sample_size) as usize;
    if count == 0 {
        return vec![0, 0, 0, 255];
    }
    let mut r_sum = 0u64;
    let mut g_sum = 0u64;
    let mut b_sum = 0u64;
    let mut a_sum = 0u64;
    for i in 0..count {
        r_sum += pixels[i * 4] as u64;
        g_sum += pixels[i * 4 + 1] as u64;
        b_sum += pixels[i * 4 + 2] as u64;
        a_sum += pixels[i * 4 + 3] as u64;
    }
    vec![
        (r_sum / count as u64) as u8,
        (g_sum / count as u64) as u8,
        (b_sum / count as u64) as u8,
        (a_sum / count as u64) as u8,
    ]
}

// ============================================================
// Shape Rendering
// ============================================================

#[wasm_bindgen(js_name = "renderShape")]
pub fn render_shape(
    engine: &mut Engine, layer_id: &str,
    shape_type: u32, cx: f64, cy: f64, width: f64, height: f64,
    fill_r: f32, fill_g: f32, fill_b: f32, fill_a: f32,
    stroke_r: f32, stroke_g: f32, stroke_b: f32, stroke_a: f32,
    stroke_width: f32, _sides: u32, corner_radius: f32,
) {
    shape_gpu::render_shape(
        &mut engine.inner, layer_id, shape_type, cx, cy, width, height,
        fill_r, fill_g, fill_b, fill_a,
        stroke_r, stroke_g, stroke_b, stroke_a,
        stroke_width, corner_radius,
    );
}

// ============================================================
// Path Rendering
// ============================================================

#[wasm_bindgen(js_name = "uploadPathTexture")]
pub fn upload_path_texture(
    engine: &mut Engine, layer_id: &str,
    data: &[u8], width: u32, height: u32,
) {
    // Upload path rasterization as the layer's texture data
    let _ = layer_manager::upload_pixels(&mut engine.inner, layer_id, data, width, height, 0, 0);
}

// ============================================================
// Compositing / Rendering
// ============================================================

#[wasm_bindgen(js_name = "render")]
pub fn render(engine: &mut Engine) {
    compositor::composite(&mut engine.inner);
}

#[wasm_bindgen(js_name = "markLayerDirty")]
pub fn mark_layer_dirty(engine: &mut Engine, layer_id: &str) {
    engine.inner.mark_layer_dirty(layer_id);
}

#[wasm_bindgen(js_name = "markAllDirty")]
pub fn mark_all_dirty(engine: &mut Engine) {
    engine.inner.mark_all_dirty();
}

#[wasm_bindgen(js_name = "setImageExposure")]
pub fn set_image_exposure(engine: &mut Engine, value: f32) {
    engine.inner.image_exposure = value;
    engine.inner.needs_recomposite = true;
}

#[wasm_bindgen(js_name = "setImageContrast")]
pub fn set_image_contrast(engine: &mut Engine, value: f32) {
    engine.inner.image_contrast = value;
    engine.inner.needs_recomposite = true;
}

#[wasm_bindgen(js_name = "setImageHighlights")]
pub fn set_image_highlights(engine: &mut Engine, value: f32) {
    engine.inner.image_highlights = value;
    engine.inner.needs_recomposite = true;
}

#[wasm_bindgen(js_name = "setImageShadows")]
pub fn set_image_shadows(engine: &mut Engine, value: f32) {
    engine.inner.image_shadows = value;
    engine.inner.needs_recomposite = true;
}

#[wasm_bindgen(js_name = "setImageWhites")]
pub fn set_image_whites(engine: &mut Engine, value: f32) {
    engine.inner.image_whites = value;
    engine.inner.needs_recomposite = true;
}

#[wasm_bindgen(js_name = "setImageBlacks")]
pub fn set_image_blacks(engine: &mut Engine, value: f32) {
    engine.inner.image_blacks = value;
    engine.inner.needs_recomposite = true;
}

#[wasm_bindgen(js_name = "setImageVignette")]
pub fn set_image_vignette(engine: &mut Engine, value: f32) {
    engine.inner.image_vignette = value;
    engine.inner.needs_recomposite = true;
}

#[wasm_bindgen(js_name = "clearImageAdjustments")]
pub fn clear_image_adjustments(engine: &mut Engine) {
    engine.inner.image_exposure = 0.0;
    engine.inner.image_contrast = 0.0;
    engine.inner.image_highlights = 0.0;
    engine.inner.image_shadows = 0.0;
    engine.inner.image_whites = 0.0;
    engine.inner.image_blacks = 0.0;
    engine.inner.image_vignette = 0.0;
    engine.inner.needs_recomposite = true;
}

// ============================================================
// Blending (CPU fallback)
// ============================================================

#[wasm_bindgen(js_name = "blendColors")]
pub fn blend_colors(
    src_r: f32, src_g: f32, src_b: f32, src_a: f32,
    dst_r: f32, dst_g: f32, dst_b: f32, dst_a: f32,
    mode: u32,
) -> Vec<u8> {
    let src = lopsy_core::color::Color::new(src_r, src_g, src_b, src_a);
    let dst = lopsy_core::color::Color::new(dst_r, dst_g, dst_b, dst_a);
    let blend_mode = BlendMode::from_u8(mode as u8).unwrap_or(BlendMode::Normal);
    let result = lopsy_core::blend::blend_colors(src, dst, blend_mode);
    let c8 = result.to_srgb8();
    vec![c8.r, c8.g, c8.b, c8.a]
}

// ============================================================
// Filters (GPU-accelerated)
// ============================================================

#[wasm_bindgen(js_name = "filterGaussianBlur")]
pub fn filter_gaussian_blur(engine: &mut Engine, layer_id: &str, radius: u32) {
    if radius == 0 { return; }
    let kernel = lopsy_core::filters::blur::gaussian_kernel(radius);
    let prog = &engine.inner.shaders.gaussian_blur.program;
    let prog_clone = prog.clone();
    filter_gpu::apply_separable_blur(
        &mut engine.inner,
        layer_id,
        &prog_clone,
        |gl, prog| {
            if let Some(loc) = gl.get_uniform_location(prog, "u_radius") {
                gl.uniform1i(Some(&loc), radius as i32);
            }
            // Upload kernel weights
            for (i, &w) in kernel.iter().enumerate().take(64) {
                let name = format!("u_weights[{i}]");
                if let Some(loc) = gl.get_uniform_location(prog, &name) {
                    gl.uniform1f(Some(&loc), w);
                }
            }
        },
    );
}

#[wasm_bindgen(js_name = "filterBoxBlur")]
pub fn filter_box_blur(engine: &mut Engine, layer_id: &str, radius: u32) {
    if radius == 0 { return; }
    let prog = &engine.inner.shaders.box_blur.program;
    let prog_clone = prog.clone();
    filter_gpu::apply_separable_blur(
        &mut engine.inner,
        layer_id,
        &prog_clone,
        |gl, prog| {
            if let Some(loc) = gl.get_uniform_location(prog, "u_radius") {
                gl.uniform1i(Some(&loc), radius as i32);
            }
        },
    );
}

#[wasm_bindgen(js_name = "filterUnsharpMask")]
pub fn filter_unsharp_mask(
    engine: &mut Engine, layer_id: &str,
    radius: u32, amount: f32, threshold: u32,
) {
    // Step 1: blur a copy into scratch B
    // Step 2: sharpen shader with original + blurred
    if radius == 0 { return; }

    // First do a gaussian blur pass (layer -> scratch B via scratch A)
    let kernel = lopsy_core::filters::blur::gaussian_kernel(radius);
    let gl = &engine.inner.gl;
    let tex_handle = match engine.inner.layer_textures.get(layer_id) {
        Some(&h) => h,
        None => return,
    };
    let (w, h) = engine.inner.texture_pool.get_size(tex_handle).unwrap_or((1, 1));
    let layer_tex = match engine.inner.texture_pool.get(tex_handle) {
        Some(t) => t.clone(),
        None => return,
    };

    let blur_prog = &engine.inner.shaders.gaussian_blur.program;
    gl.use_program(Some(blur_prog));

    // Horizontal pass: layer -> scratch A
    engine.inner.fbo_pool.bind(gl, engine.inner.scratch_fbo_a);
    gl.viewport(0, 0, w as i32, h as i32);
    gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&layer_tex));
    if let Some(loc) = gl.get_uniform_location(blur_prog, "u_tex") {
        gl.uniform1i(Some(&loc), 0);
    }
    if let Some(loc) = gl.get_uniform_location(blur_prog, "u_direction") {
        gl.uniform2f(Some(&loc), 1.0, 0.0);
    }
    if let Some(loc) = gl.get_uniform_location(blur_prog, "u_radius") {
        gl.uniform1i(Some(&loc), radius as i32);
    }
    for (i, &wt) in kernel.iter().enumerate().take(64) {
        let name = format!("u_weights[{i}]");
        if let Some(loc) = gl.get_uniform_location(blur_prog, &name) {
            gl.uniform1f(Some(&loc), wt);
        }
    }
    engine.inner.draw_fullscreen_quad();

    // Vertical pass: scratch A -> scratch B
    engine.inner.fbo_pool.bind(gl, engine.inner.scratch_fbo_b);
    gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    if let Some(scratch_a) = engine.inner.texture_pool.get(engine.inner.scratch_texture_a) {
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(scratch_a));
    }
    if let Some(loc) = gl.get_uniform_location(blur_prog, "u_direction") {
        gl.uniform2f(Some(&loc), 0.0, 1.0);
    }
    engine.inner.draw_fullscreen_quad();

    // Now apply sharpen shader: original (layer) + blurred (scratch B) -> scratch A
    let sharpen_prog = &engine.inner.shaders.sharpen.program;
    gl.use_program(Some(sharpen_prog));
    engine.inner.fbo_pool.bind(gl, engine.inner.scratch_fbo_a);

    gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&layer_tex));
    if let Some(loc) = gl.get_uniform_location(sharpen_prog, "u_tex") {
        gl.uniform1i(Some(&loc), 0);
    }
    gl.active_texture(WebGl2RenderingContext::TEXTURE1);
    if let Some(scratch_b) = engine.inner.texture_pool.get(engine.inner.scratch_texture_b) {
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(scratch_b));
    }
    if let Some(loc) = gl.get_uniform_location(sharpen_prog, "u_blurredTex") {
        gl.uniform1i(Some(&loc), 1);
    }
    if let Some(loc) = gl.get_uniform_location(sharpen_prog, "u_amount") {
        gl.uniform1f(Some(&loc), amount);
    }
    if let Some(loc) = gl.get_uniform_location(sharpen_prog, "u_threshold") {
        gl.uniform1f(Some(&loc), threshold as f32);
    }
    engine.inner.draw_fullscreen_quad();

    // Copy scratch A -> layer texture
    let temp_fbo = gl.create_framebuffer();
    gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, temp_fbo.as_ref());
    gl.framebuffer_texture_2d(
        WebGl2RenderingContext::FRAMEBUFFER,
        WebGl2RenderingContext::COLOR_ATTACHMENT0,
        WebGl2RenderingContext::TEXTURE_2D,
        Some(&layer_tex),
        0,
    );
    gl.use_program(Some(&engine.inner.shaders.blit.program));
    gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    if let Some(scratch_a) = engine.inner.texture_pool.get(engine.inner.scratch_texture_a) {
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(scratch_a));
    }
    if let Some(loc) = gl.get_uniform_location(&engine.inner.shaders.blit.program, "u_tex") {
        gl.uniform1i(Some(&loc), 0);
    }
    engine.inner.draw_fullscreen_quad();
    gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, None);
    gl.delete_framebuffer(temp_fbo.as_ref());

    engine.inner.mark_layer_dirty(layer_id);
}

#[wasm_bindgen(js_name = "filterBrightnessContrast")]
pub fn filter_brightness_contrast(
    engine: &mut Engine, layer_id: &str, brightness: f32, contrast: f32,
) {
    let prog = engine.inner.shaders.adjustments.program.clone();
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        &prog,
        |gl, prog| {
            if let Some(loc) = gl.get_uniform_location(prog, "u_brightness") {
                gl.uniform1f(Some(&loc), brightness / 100.0);
            }
            if let Some(loc) = gl.get_uniform_location(prog, "u_contrast") {
                gl.uniform1f(Some(&loc), contrast / 100.0);
            }
            if let Some(loc) = gl.get_uniform_location(prog, "u_exposure") {
                gl.uniform1f(Some(&loc), 0.0);
            }
            if let Some(loc) = gl.get_uniform_location(prog, "u_highlights") {
                gl.uniform1f(Some(&loc), 0.0);
            }
            if let Some(loc) = gl.get_uniform_location(prog, "u_shadows") {
                gl.uniform1f(Some(&loc), 0.0);
            }
            if let Some(loc) = gl.get_uniform_location(prog, "u_whites") {
                gl.uniform1f(Some(&loc), 0.0);
            }
            if let Some(loc) = gl.get_uniform_location(prog, "u_blacks") {
                gl.uniform1f(Some(&loc), 0.0);
            }
        },
    );
}

#[wasm_bindgen(js_name = "filterHueSaturation")]
pub fn filter_hue_saturation(
    engine: &mut Engine, layer_id: &str,
    hue: f32, saturation: f32, lightness: f32,
) {
    let prog = engine.inner.shaders.hue_sat.program.clone();
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        &prog,
        |gl, prog| {
            if let Some(loc) = gl.get_uniform_location(prog, "u_hue") {
                gl.uniform1f(Some(&loc), hue);
            }
            if let Some(loc) = gl.get_uniform_location(prog, "u_saturation") {
                gl.uniform1f(Some(&loc), saturation);
            }
            if let Some(loc) = gl.get_uniform_location(prog, "u_lightness") {
                gl.uniform1f(Some(&loc), lightness);
            }
        },
    );
}

#[wasm_bindgen(js_name = "filterInvert")]
pub fn filter_invert(engine: &mut Engine, layer_id: &str) {
    let prog = engine.inner.shaders.invert.program.clone();
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        &prog,
        |_gl, _prog| {},
    );
}

#[wasm_bindgen(js_name = "filterDesaturate")]
pub fn filter_desaturate(engine: &mut Engine, layer_id: &str) {
    // Desaturate = hue_sat with saturation = -100
    let prog = engine.inner.shaders.hue_sat.program.clone();
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        &prog,
        |gl, prog| {
            if let Some(loc) = gl.get_uniform_location(prog, "u_hue") {
                gl.uniform1f(Some(&loc), 0.0);
            }
            if let Some(loc) = gl.get_uniform_location(prog, "u_saturation") {
                gl.uniform1f(Some(&loc), -100.0);
            }
            if let Some(loc) = gl.get_uniform_location(prog, "u_lightness") {
                gl.uniform1f(Some(&loc), 0.0);
            }
        },
    );
}

#[wasm_bindgen(js_name = "filterPosterize")]
pub fn filter_posterize(engine: &mut Engine, layer_id: &str, levels: u32) {
    let prog = engine.inner.shaders.posterize.program.clone();
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        &prog,
        |gl, prog| {
            if let Some(loc) = gl.get_uniform_location(prog, "u_levels") {
                gl.uniform1f(Some(&loc), levels as f32);
            }
        },
    );
}

#[wasm_bindgen(js_name = "filterThreshold")]
pub fn filter_threshold(engine: &mut Engine, layer_id: &str, level: u32) {
    let prog = engine.inner.shaders.threshold.program.clone();
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        &prog,
        |gl, prog| {
            if let Some(loc) = gl.get_uniform_location(prog, "u_level") {
                gl.uniform1f(Some(&loc), level as f32 / 255.0);
            }
        },
    );
}

#[wasm_bindgen(js_name = "filterAddNoise")]
pub fn filter_add_noise(
    engine: &mut Engine, layer_id: &str,
    amount: f32, monochrome: bool,
) {
    let prog = engine.inner.shaders.noise.program.clone();
    let seed = engine.inner.selection_time as f32; // Use time as seed for randomness
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        &prog,
        |gl, prog| {
            if let Some(loc) = gl.get_uniform_location(prog, "u_amount") {
                gl.uniform1f(Some(&loc), amount / 255.0);
            }
            if let Some(loc) = gl.get_uniform_location(prog, "u_monochrome") {
                gl.uniform1i(Some(&loc), if monochrome { 1 } else { 0 });
            }
            if let Some(loc) = gl.get_uniform_location(prog, "u_seed") {
                gl.uniform1f(Some(&loc), seed);
            }
        },
    );
}

#[wasm_bindgen(js_name = "filterFillWithNoise")]
pub fn filter_fill_with_noise(engine: &mut Engine, layer_id: &str, monochrome: bool) {
    // Fill with noise = add noise at maximum amount to a cleared layer
    filter_add_noise(engine, layer_id, 255.0, monochrome);
}

// ============================================================
// Selection
// ============================================================

#[wasm_bindgen(js_name = "setSelectionMask")]
pub fn set_selection_mask(
    engine: &mut Engine, mask_data: &[u8], width: u32, height: u32,
) {
    selection_gpu::set_selection_mask(&mut engine.inner, mask_data, width, height);
}

#[wasm_bindgen(js_name = "clearSelection")]
pub fn clear_selection(engine: &mut Engine) {
    if let Some(tex) = engine.inner.selection_mask_texture.take() {
        engine.inner.texture_pool.release(tex);
    }
    engine.inner.needs_recomposite = true;
}

#[wasm_bindgen(js_name = "createRectSelection")]
pub fn create_rect_selection(width: u32, height: u32, x: i32, y: i32, w: u32, h: u32) -> Vec<u8> {
    lopsy_core::selection::create_rect_selection(width, height, x, y, w, h)
}

#[wasm_bindgen(js_name = "createEllipseSelection")]
pub fn create_ellipse_selection(width: u32, height: u32, x: i32, y: i32, w: u32, h: u32) -> Vec<u8> {
    lopsy_core::selection::create_ellipse_selection(width, height, x, y, w, h)
}

#[wasm_bindgen(js_name = "invertSelection")]
pub fn invert_selection(mask: &[u8]) -> Vec<u8> {
    lopsy_core::selection::invert_selection(mask)
}

#[wasm_bindgen(js_name = "combineSelections")]
pub fn combine_selections(a: &[u8], b: &[u8], mode: u32) -> Vec<u8> {
    lopsy_core::selection::combine_selections(a, b, mode)
}

#[wasm_bindgen(js_name = "selectionBounds")]
pub fn selection_bounds(mask: &[u8], width: u32, height: u32) -> Vec<i32> {
    match lopsy_core::selection::selection_bounds(mask, width, height) {
        Some(r) => vec![r.x, r.y, r.width as i32, r.height as i32],
        None => Vec::new(),
    }
}

#[wasm_bindgen(js_name = "isEmptySelection")]
pub fn is_empty_selection(mask: &[u8]) -> bool {
    lopsy_core::selection::is_empty_selection(mask)
}

#[wasm_bindgen(js_name = "traceSelectionContours")]
pub fn trace_selection_contours(mask: &[u8], width: u32, height: u32) -> Vec<f64> {
    lopsy_core::selection::trace_selection_contours(mask, width, height)
}

#[wasm_bindgen(js_name = "getSelectionEdges")]
pub fn get_selection_edges(mask: &[u8], width: u32, height: u32) -> Vec<f64> {
    lopsy_core::selection::get_selection_edges(mask, width, height)
}

#[wasm_bindgen(js_name = "createPolygonMask")]
pub fn create_polygon_mask(points_flat: &[f64], width: u32, height: u32) -> Vec<u8> {
    lopsy_core::selection::create_polygon_mask(points_flat, width, height)
}

// ============================================================
// Coordinate Transforms
// ============================================================

#[wasm_bindgen(js_name = "screenToCanvas")]
pub fn screen_to_canvas(
    screen_x: f64, screen_y: f64,
    zoom: f64, pan_x: f64, pan_y: f64,
    view_width: f64, view_height: f64,
) -> Vec<f64> {
    let (cx, cy) = geometry::screen_to_canvas(screen_x, screen_y, zoom, pan_x, pan_y, view_width, view_height);
    vec![cx, cy]
}

#[wasm_bindgen(js_name = "canvasToScreen")]
pub fn canvas_to_screen(
    canvas_x: f64, canvas_y: f64,
    zoom: f64, pan_x: f64, pan_y: f64,
    view_width: f64, view_height: f64,
) -> Vec<f64> {
    let (sx, sy) = geometry::canvas_to_screen(canvas_x, canvas_y, zoom, pan_x, pan_y, view_width, view_height);
    vec![sx, sy]
}

#[wasm_bindgen(js_name = "getVisibleRegion")]
pub fn get_visible_region(
    zoom: f64, pan_x: f64, pan_y: f64,
    view_width: f64, view_height: f64,
) -> Vec<f64> {
    let (x, y, w, h) = geometry::get_visible_region(zoom, pan_x, pan_y, view_width, view_height);
    vec![x, y, w, h]
}

#[wasm_bindgen(js_name = "screenDeltaToCanvas")]
pub fn screen_delta_to_canvas(dx: f64, dy: f64, zoom: f64) -> Vec<f64> {
    let (cx, cy) = geometry::screen_delta_to_canvas(dx, dy, zoom);
    vec![cx, cy]
}

// ============================================================
// Pixel Operations (CPU-side via WASM)
// ============================================================

#[wasm_bindgen(js_name = "clonePixelData")]
pub fn clone_pixel_data(data: &[u8]) -> Vec<u8> {
    lopsy_core::pixel_buffer::clone_pixel_data(data)
}

#[wasm_bindgen(js_name = "cropToContentBounds")]
pub fn crop_to_content_bounds(data: &[u8], width: u32, height: u32) -> Vec<u8> {
    let (cropped, _rect) = lopsy_core::pixel_buffer::crop_to_content_bounds(data, width, height);
    cropped
}

#[wasm_bindgen(js_name = "expandFromCrop")]
pub fn expand_from_crop(
    cropped: &[u8], cw: u32, ch: u32,
    ox: i32, oy: i32, fw: u32, fh: u32,
) -> Vec<u8> {
    lopsy_core::pixel_buffer::expand_from_crop(cropped, cw, ch, ox, oy, fw, fh)
}

#[wasm_bindgen(js_name = "toSparsePixelData")]
pub fn to_sparse_pixel_data(data: &[u8], width: u32, height: u32) -> Option<Vec<u8>> {
    let sparse = lopsy_core::sparse::to_sparse(data, width, height)?;
    let mut packed = Vec::new();
    let count = sparse.indices.len() as u32;
    packed.extend_from_slice(&count.to_le_bytes());
    for &idx in &sparse.indices {
        packed.extend_from_slice(&idx.to_le_bytes());
    }
    packed.extend_from_slice(&sparse.rgba);
    Some(packed)
}

#[wasm_bindgen(js_name = "scalePixelData")]
pub fn scale_pixel_data(data: &[u8], src_w: u32, src_h: u32, dst_w: u32, dst_h: u32) -> Vec<u8> {
    lopsy_core::pixel_buffer::scale_pixel_data(data, src_w, src_h, dst_w, dst_h)
}

#[wasm_bindgen(js_name = "resizeCanvasPixelData")]
pub fn resize_canvas_pixel_data(
    data: &[u8], src_w: u32, src_h: u32,
    layer_x: i32, layer_y: i32,
    dst_w: u32, dst_h: u32,
    offset_x: i32, offset_y: i32,
) -> Vec<u8> {
    lopsy_core::pixel_buffer::resize_canvas_pixel_data(data, src_w, src_h, layer_x, layer_y, dst_w, dst_h, offset_x, offset_y)
}

#[wasm_bindgen(js_name = "cropLayerPixelData")]
pub fn crop_layer_pixel_data(
    data: &[u8], src_w: u32, src_h: u32,
    layer_x: i32, layer_y: i32,
    crop_x: i32, crop_y: i32, crop_w: u32, crop_h: u32,
) -> Vec<u8> {
    lopsy_core::pixel_buffer::crop_layer_pixel_data(data, src_w, src_h, layer_x, layer_y, crop_x, crop_y, crop_w, crop_h)
}

#[wasm_bindgen(js_name = "createMaskSurface")]
pub fn create_mask_surface(mask_data: &[u8], width: u32, height: u32) -> Vec<u8> {
    lopsy_core::pixel_buffer::create_mask_surface(mask_data, width, height)
}

#[wasm_bindgen(js_name = "extractMaskFromSurface")]
pub fn extract_mask_from_surface(surface_data: &[u8], width: u32, height: u32) -> Vec<u8> {
    lopsy_core::pixel_buffer::extract_mask_from_surface(surface_data, width, height)
}

// ============================================================
// Flood Fill
// ============================================================

#[wasm_bindgen(js_name = "floodFill")]
pub fn flood_fill(
    pixel_data: &[u8], width: u32, height: u32,
    start_x: u32, start_y: u32,
    _fill_r: u8, _fill_g: u8, _fill_b: u8, _fill_a: u8,
    tolerance: u32, contiguous: bool,
) -> Vec<u8> {
    lopsy_core::flood_fill::flood_fill(pixel_data, width, height, start_x, start_y, tolerance, contiguous)
}

#[wasm_bindgen(js_name = "applyFillToLayer")]
pub fn apply_fill_to_layer(
    engine: &mut Engine, layer_id: &str,
    fill_r: f32, fill_g: f32, fill_b: f32, fill_a: f32,
    mask: &[u8], width: u32, height: u32,
) {
    let gl = &engine.inner.gl;
    let tex_handle = match engine.inner.layer_textures.get(layer_id) {
        Some(&h) => h,
        None => return,
    };
    let (mut w, mut h) = engine.inner.texture_pool.get_size(tex_handle).unwrap_or((1, 1));

    // Resize layer texture to fill dimensions if needed (lazy 1x1 allocation)
    if w < width || h < height {
        engine.inner.texture_pool.release(tex_handle);
        match engine.inner.texture_pool.acquire(gl, width, height) {
            Ok(new_tex) => {
                engine.inner.layer_textures.insert(layer_id.to_string(), new_tex);
                w = width;
                h = height;
            }
            Err(_) => return,
        }
    }
    let tex_handle = match engine.inner.layer_textures.get(layer_id) {
        Some(&h) => h,
        None => return,
    };
    let layer_tex = match engine.inner.texture_pool.get(tex_handle) {
        Some(t) => t.clone(),
        None => return,
    };

    // Upload mask as texture
    let mask_tex = match engine.inner.texture_pool.acquire(gl, width, height) {
        Ok(h) => h,
        Err(_) => return,
    };
    let mut mask_rgba = vec![0u8; (width * height * 4) as usize];
    for i in 0..(width * height) as usize {
        let v = if i < mask.len() { mask[i] } else { 0 };
        mask_rgba[i * 4] = v;
        mask_rgba[i * 4 + 1] = 0;
        mask_rgba[i * 4 + 2] = 0;
        mask_rgba[i * 4 + 3] = 255;
    }
    let _ = engine.inner.texture_pool.upload_rgba(
        gl, mask_tex, 0, 0, width, height, &mask_rgba,
    );

    // Use flood_fill_apply shader
    let prog = &engine.inner.shaders.flood_fill_apply.program;
    gl.use_program(Some(prog));

    engine.inner.fbo_pool.bind(gl, engine.inner.scratch_fbo_a);
    gl.viewport(0, 0, w as i32, h as i32);

    gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&layer_tex));
    if let Some(loc) = gl.get_uniform_location(prog, "u_layerTex") {
        gl.uniform1i(Some(&loc), 0);
    }
    gl.active_texture(WebGl2RenderingContext::TEXTURE1);
    if let Some(tex) = engine.inner.texture_pool.get(mask_tex) {
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(tex));
    }
    if let Some(loc) = gl.get_uniform_location(prog, "u_maskTex") {
        gl.uniform1i(Some(&loc), 1);
    }
    if let Some(loc) = gl.get_uniform_location(prog, "u_fillColor") {
        gl.uniform4f(Some(&loc), fill_r, fill_g, fill_b, fill_a);
    }

    engine.inner.draw_fullscreen_quad();

    // Copy scratch A -> layer texture
    let temp_fbo = gl.create_framebuffer();
    gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, temp_fbo.as_ref());
    gl.framebuffer_texture_2d(
        WebGl2RenderingContext::FRAMEBUFFER,
        WebGl2RenderingContext::COLOR_ATTACHMENT0,
        WebGl2RenderingContext::TEXTURE_2D,
        Some(&layer_tex),
        0,
    );
    gl.use_program(Some(&engine.inner.shaders.blit.program));
    gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    if let Some(scratch) = engine.inner.texture_pool.get(engine.inner.scratch_texture_a) {
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(scratch));
    }
    if let Some(loc) = gl.get_uniform_location(&engine.inner.shaders.blit.program, "u_tex") {
        gl.uniform1i(Some(&loc), 0);
    }
    engine.inner.draw_fullscreen_quad();
    gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, None);
    gl.delete_framebuffer(temp_fbo.as_ref());

    engine.inner.texture_pool.release(mask_tex);
    engine.inner.mark_layer_dirty(layer_id);
}

#[wasm_bindgen(js_name = "readLayerPixelsForFill")]
pub fn read_layer_pixels_for_fill(engine: &Engine, layer_id: &str) -> Result<Vec<u8>, JsError> {
    // Read layer texture and expand to document dimensions for flood fill.
    // The texture may be smaller than the document (lazy allocation),
    // so we place it at the layer's offset within a transparent doc-size buffer.
    let eng = &engine.inner;
    let doc_w = eng.doc_width as usize;
    let doc_h = eng.doc_height as usize;

    let tex_handle = eng.layer_textures.get(layer_id)
        .ok_or_else(|| JsError::new(&format!("Layer {layer_id} not found")))?;
    let (tw, th) = eng.texture_pool.get_size(*tex_handle).unwrap_or((0, 0));

    // If texture matches doc size, read directly
    if tw as usize == doc_w && th as usize == doc_h {
        return layer_manager::read_pixels(eng, layer_id).map_err(|e| JsError::new(&e));
    }

    // Read small texture and expand into doc-size buffer
    let layer = eng.layer_stack.iter().find(|l| l.id == layer_id);
    let lx = layer.map_or(0, |l| l.x as usize);
    let ly = layer.map_or(0, |l| l.y as usize);

    let small = layer_manager::read_pixels(eng, layer_id).map_err(|e| JsError::new(&e))?;
    let mut result = vec![0u8; doc_w * doc_h * 4];

    for sy in 0..th as usize {
        let dy = ly + sy;
        if dy >= doc_h { break; }
        for sx in 0..tw as usize {
            let dx = lx + sx;
            if dx >= doc_w { break; }
            let si = (sy * tw as usize + sx) * 4;
            let di = (dy * doc_w + dx) * 4;
            result[di..di + 4].copy_from_slice(&small[si..si + 4]);
        }
    }

    Ok(result)
}

// ============================================================
// Color Management
// ============================================================

#[wasm_bindgen(js_name = "detectColorSpace")]
pub fn detect_color_space() -> u32 {
    // Check via matchMedia for Display P3 support
    if let Ok(result) = js_sys::eval("window.matchMedia('(color-gamut: p3)').matches") {
        if result.as_bool() == Some(true) {
            return 1; // DisplayP3
        }
    }
    0 // sRGB default
}

#[wasm_bindgen(js_name = "convertColorSpace")]
pub fn convert_color_space(
    data: &[u8], width: u32, height: u32,
    from_space: u32, to_space: u32,
) -> Vec<u8> {
    color_mgmt::convert_color_space(data, width, height, from_space, to_space)
}

#[wasm_bindgen(js_name = "buildIccProfile")]
pub fn build_icc_profile(color_space: u32) -> Vec<u8> {
    let cs = match color_space {
        1 => ColorSpace::DisplayP3,
        2 => ColorSpace::Rec2020,
        _ => ColorSpace::Srgb,
    };
    lopsy_core::export::build_icc_profile(cs)
}

// ============================================================
// Export
// ============================================================

#[wasm_bindgen(js_name = "compositeForExport")]
pub fn composite_for_export(engine: &mut Engine) -> Result<Vec<u8>, JsError> {
    compositor::composite_for_export(&mut engine.inner).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "getCompositeSize")]
pub fn get_composite_size(engine: &Engine) -> Vec<u32> {
    vec![engine.inner.doc_width, engine.inner.doc_height]
}

// ============================================================
// Tool UI Overlays
// ============================================================

#[wasm_bindgen(js_name = "setGridVisible")]
pub fn set_grid_visible(engine: &mut Engine, visible: bool) {
    engine.inner.grid_visible = visible;
    engine.inner.needs_recomposite = true;
}

#[wasm_bindgen(js_name = "setGridSize")]
pub fn set_grid_size(engine: &mut Engine, size: f32) {
    engine.inner.grid_size = size;
    engine.inner.needs_recomposite = true;
}

#[wasm_bindgen(js_name = "setTransformOverlay")]
pub fn set_transform_overlay(engine: &mut Engine, bounds_json: Option<String>) {
    overlay_renderer::set_transform_overlay(&mut engine.inner, bounds_json);
}

#[wasm_bindgen(js_name = "setGradientGuide")]
pub fn set_gradient_guide(
    engine: &mut Engine,
    start_x: f64, start_y: f64, end_x: f64, end_y: f64,
) {
    overlay_renderer::set_gradient_guide(&mut engine.inner, start_x, start_y, end_x, end_y);
}

#[wasm_bindgen(js_name = "clearGradientGuide")]
pub fn clear_gradient_guide(engine: &mut Engine) {
    overlay_renderer::clear_gradient_guide(&mut engine.inner);
}

#[wasm_bindgen(js_name = "setPathOverlay")]
pub fn set_path_overlay(engine: &mut Engine, anchors_json: Option<String>) {
    overlay_renderer::set_path_overlay(&mut engine.inner, anchors_json);
}

#[wasm_bindgen(js_name = "setLassoPreview")]
pub fn set_lasso_preview(engine: &mut Engine, points_flat: Option<Vec<f64>>) {
    overlay_renderer::set_lasso_preview(&mut engine.inner, points_flat);
}

#[wasm_bindgen(js_name = "setCropPreview")]
pub fn set_crop_preview(engine: &mut Engine, x: f64, y: f64, w: f64, h: f64) {
    overlay_renderer::set_crop_preview(&mut engine.inner, x, y, w, h);
}

#[wasm_bindgen(js_name = "clearCropPreview")]
pub fn clear_crop_preview(engine: &mut Engine) {
    overlay_renderer::clear_crop_preview(&mut engine.inner);
}

#[wasm_bindgen(js_name = "setBrushCursor")]
pub fn set_brush_cursor(engine: &mut Engine, x: f64, y: f64, radius: f64) {
    overlay_renderer::set_brush_cursor(&mut engine.inner, x, y, radius);
}

#[wasm_bindgen(js_name = "clearBrushCursor")]
pub fn clear_brush_cursor(engine: &mut Engine) {
    overlay_renderer::clear_brush_cursor(&mut engine.inner);
}

#[wasm_bindgen(js_name = "setRulersVisible")]
pub fn set_rulers_visible(engine: &mut Engine, visible: bool) {
    engine.inner.rulers_visible = visible;
    engine.inner.needs_recomposite = true;
}

// ============================================================
// ImageBitmap upload
// ============================================================

#[wasm_bindgen(js_name = "uploadLayerFromImageBitmap")]
pub fn upload_layer_from_image_bitmap(
    engine: &mut Engine, layer_id: &str, bitmap: web_sys::ImageBitmap,
) {
    let gl = &engine.inner.gl;
    let width = bitmap.width();
    let height = bitmap.height();

    // Ensure texture exists and is correct size
    if let Some(&tex_handle) = engine.inner.layer_textures.get(layer_id) {
        let (tw, th) = engine.inner.texture_pool.get_size(tex_handle).unwrap_or((0, 0));
        if tw != width || th != height {
            engine.inner.texture_pool.release(tex_handle);
            if let Ok(new_tex) = engine.inner.texture_pool.acquire(gl, width, height) {
                engine.inner.layer_textures.insert(layer_id.to_string(), new_tex);
            }
        }
    }

    if let Some(&tex_handle) = engine.inner.layer_textures.get(layer_id) {
        if engine.inner.texture_pool.use_float() {
            // RGBA16F textures can't accept ImageBitmap directly.
            // Upload to a temp RGBA8 texture, then blit to the float texture.
            let temp_tex = match gl.create_texture() {
                Some(t) => t,
                None => { engine.inner.mark_layer_dirty(layer_id); return; }
            };
            gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&temp_tex));
            let _ = gl.tex_image_2d_with_u32_and_u32_and_image_bitmap(
                WebGl2RenderingContext::TEXTURE_2D,
                0,
                WebGl2RenderingContext::RGBA as i32,
                WebGl2RenderingContext::RGBA,
                WebGl2RenderingContext::UNSIGNED_BYTE,
                &bitmap,
            );
            gl.tex_parameteri(WebGl2RenderingContext::TEXTURE_2D, WebGl2RenderingContext::TEXTURE_MIN_FILTER, WebGl2RenderingContext::LINEAR as i32);
            gl.tex_parameteri(WebGl2RenderingContext::TEXTURE_2D, WebGl2RenderingContext::TEXTURE_MAG_FILTER, WebGl2RenderingContext::LINEAR as i32);

            // Blit from temp to float texture via the blit shader
            if let Some(dest_tex) = engine.inner.texture_pool.get(tex_handle) {
                let fbo = gl.create_framebuffer();
                gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, fbo.as_ref());
                gl.framebuffer_texture_2d(
                    WebGl2RenderingContext::FRAMEBUFFER,
                    WebGl2RenderingContext::COLOR_ATTACHMENT0,
                    WebGl2RenderingContext::TEXTURE_2D,
                    Some(dest_tex),
                    0,
                );
                gl.viewport(0, 0, width as i32, height as i32);

                gl.use_program(Some(&engine.inner.shaders.blit.program));
                gl.active_texture(WebGl2RenderingContext::TEXTURE0);
                gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&temp_tex));
                if let Some(loc) = gl.get_uniform_location(&engine.inner.shaders.blit.program, "u_tex") {
                    gl.uniform1i(Some(&loc), 0);
                }
                engine.inner.draw_fullscreen_quad();

                gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, None);
                gl.delete_framebuffer(fbo.as_ref());
            }

            gl.delete_texture(Some(&temp_tex));
        } else {
            if let Some(texture) = engine.inner.texture_pool.get(tex_handle) {
                gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(texture));
                let _ = gl.tex_image_2d_with_u32_and_u32_and_image_bitmap(
                    WebGl2RenderingContext::TEXTURE_2D,
                    0,
                    WebGl2RenderingContext::RGBA as i32,
                    WebGl2RenderingContext::RGBA,
                    WebGl2RenderingContext::UNSIGNED_BYTE,
                    &bitmap,
                );
            }
        }
    }

    engine.inner.mark_layer_dirty(layer_id);
}
