//! Paint-tool API: brush, eraser, pencil, and the custom brush tip state.
//! Plus dab-based tools that share the paint pipeline — dodge/burn, smudge,
//! and clone stamp.
//!
//! Each function is a thin `#[wasm_bindgen]` wrapper around one of the
//! `*_gpu` modules. Moving them out of lib.rs doesn't change any call
//! site — it just groups the paint surface in one place.


use crate::engine::EngineInner;
use crate::gpu::texture_pool::TextureHandle;
use crate::{brush_gpu, clone_stamp_gpu, dodge_burn_gpu, healing_brush_gpu, mask_paint_gpu, smudge_gpu, sponge_gpu};

// ============================================================
// Brush / Paint Operations
// ============================================================

pub fn begin_stroke(engine: &mut EngineInner, layer_id: &str) -> Result<(), String> {
    brush_gpu::begin_stroke(&mut *engine, layer_id)
}

pub fn prewarm_stroke(engine: &mut EngineInner, layer_id: &str) -> Result<(), String> {
    brush_gpu::prewarm_stroke(&mut *engine, layer_id)
}

/// Composite a straight-alpha RGBA patch over a layer at document position
/// (`x`, `y`) — Stroke Path's GPU write (#1292).
pub fn composite_patch_onto_layer(
    engine: &mut EngineInner, layer_id: &str,
    data: &[u8], x: i32, y: i32, width: u32, height: u32,
) -> Result<(), String> {
    brush_gpu::composite_patch_onto_layer(&mut *engine, layer_id, data, x, y, width, height)
        
}

pub fn apply_brush_dab(
    engine: &mut EngineInner, layer_id: &str,
    cx: f64, cy: f64,
    stamp_size: f32, hardness: f32,
    r: f32, g: f32, b: f32, a: f32,
    opacity: f32, flow: f32,
    size_jitter: f32, angle_jitter: f32, opacity_jitter: f32,
) {
    brush_gpu::apply_dab(&mut *engine, layer_id, cx, cy, stamp_size, hardness, r, g, b, a, opacity, flow, size_jitter, angle_jitter, opacity_jitter);
}

pub fn apply_brush_dab_batch(
    engine: &mut EngineInner, layer_id: &str,
    points: &[f64],
    stamp_size: f32, hardness: f32,
    r: f32, g: f32, b: f32, a: f32,
    opacity: f32, flow: f32,
    size_jitter: f32, angle_jitter: f32, opacity_jitter: f32,
) {
    brush_gpu::apply_dab_batch(&mut *engine, layer_id, points, stamp_size, hardness, r, g, b, a, opacity, flow, size_jitter, angle_jitter, opacity_jitter);
}

pub fn apply_eraser_dab(
    engine: &mut EngineInner, layer_id: &str,
    cx: f64, cy: f64, stamp_size: f32, hardness: f32, opacity: f32,
) {
    brush_gpu::apply_eraser_dab(&mut *engine, layer_id, cx, cy, stamp_size, hardness, opacity);
}

pub fn apply_eraser_dab_batch(
    engine: &mut EngineInner, layer_id: &str,
    points: &[f64], stamp_size: f32, hardness: f32, opacity: f32,
) {
    brush_gpu::apply_eraser_dab_batch(&mut *engine, layer_id, points, stamp_size, hardness, opacity);
}

pub fn draw_pencil_line(
    engine: &mut EngineInner, layer_id: &str,
    x0: f64, y0: f64, x1: f64, y1: f64,
    r: f32, g: f32, b: f32, a: f32, size: f32,
) {
    brush_gpu::draw_pencil_line(&mut *engine, layer_id, x0, y0, x1, y1, r, g, b, a, size);
}

pub fn end_stroke(engine: &mut EngineInner, layer_id: &str) {
    brush_gpu::end_stroke(&mut *engine, layer_id);
}

pub fn upload_brush_tip(engine: &mut EngineInner, data: &[u8], width: u32, height: u32) -> Result<(), String> {
    let pixel_count = (width * height) as usize;
    let mut sharp = vec![0u8; pixel_count];
    for i in 0..pixel_count {
        sharp[i] = if i < data.len() { data[i] } else { 0 };
    }
    // Inner-glow approach: invert alpha → blur → normalize → store.
    let blur_radius = (width.min(height) / 2).max(1);
    let mut inverted = vec![0u8; pixel_count];
    for i in 0..pixel_count {
        inverted[i] = 255 - sharp[i];
    }
    lopsy_core::filters::blur::gaussian_blur_gray(&mut inverted, width, height, blur_radius);
    // Normalize glow within the shape to use the full [0,255] range,
    // so there's always a strong gradient from edge (255) to center (0).
    let mut min_val = 255u8;
    let mut max_val = 0u8;
    for i in 0..pixel_count {
        if sharp[i] > 5 {
            min_val = min_val.min(inverted[i]);
            max_val = max_val.max(inverted[i]);
        }
    }
    if max_val > min_val {
        for i in 0..pixel_count {
            if sharp[i] > 5 {
                let t = (inverted[i] as f32 - min_val as f32) / (max_val as f32 - min_val as f32);
                inverted[i] = (t.sqrt() * 255.0).round() as u8;
            } else {
                inverted[i] = 255;
            }
        }
    }
    let mut rgba = vec![0u8; pixel_count * 4];
    for i in 0..pixel_count {
        rgba[i * 4] = sharp[i];
        rgba[i * 4 + 1] = inverted[i];
        rgba[i * 4 + 2] = 0;
        rgba[i * 4 + 3] = 255;
    }
    if let Some(old) = engine.brush_tip_texture.take() {
        engine.texture_pool.release(old);
    }
    let tex = engine.texture_pool.acquire(width, height)
        ?;
    engine.texture_pool.upload_rgba(tex, 0, 0, width, height, &rgba)
        ?;
    engine.brush_tip_texture = Some(tex);
    engine.brush_tip_width = width;
    engine.brush_tip_height = height;
    Ok(())
}

pub fn upload_brush_tip_rgba(engine: &mut EngineInner, data: &[u8], width: u32, height: u32) -> Result<(), String> {
    let pixel_count = (width * height) as usize;
    let expected_len = pixel_count * 4;
    if data.len() < expected_len {
        return Err("RGBA brush tip data too short".to_string());
    }
    // Premultiply alpha
    let mut rgba = vec![0u8; expected_len];
    for i in 0..pixel_count {
        let off = i * 4;
        let a = data[off + 3] as f32 / 255.0;
        rgba[off] = (data[off] as f32 * a + 0.5) as u8;
        rgba[off + 1] = (data[off + 1] as f32 * a + 0.5) as u8;
        rgba[off + 2] = (data[off + 2] as f32 * a + 0.5) as u8;
        rgba[off + 3] = data[off + 3];
    }
    if let Some(old) = engine.brush_tip_texture.take() {
        engine.texture_pool.release(old);
    }
    let tex = engine.texture_pool.acquire(width, height)
        ?;
    engine.texture_pool.upload_rgba(tex, 0, 0, width, height, &rgba)
        ?;
    engine.brush_tip_texture = Some(tex);
    engine.brush_tip_width = width;
    engine.brush_tip_height = height;
    engine.brush_tip_is_color = true;
    Ok(())
}

pub fn clear_brush_tip(engine: &mut EngineInner) {
    if let Some(tex) = engine.brush_tip_texture.take() {
        engine.texture_pool.release(tex);
    }
    engine.brush_tip_width = 0;
    engine.brush_tip_height = 0;
    engine.brush_has_tip = false;
    engine.brush_tip_is_color = false;
}

pub fn set_brush_tip_state(engine: &mut EngineInner, has_tip: bool, angle: f32, is_color: bool) {
    engine.brush_has_tip = has_tip;
    engine.brush_angle = angle;
    engine.brush_tip_is_color = is_color;
}

/// Set the per-dab sample transform used by the brush dab shaders (row-major
/// `[[m00, m01], [m10, m11]]`). Identity for the primary stroke; a symmetry
/// copy passes the inverse of its linear map so the tip is reflected or
/// rotated along with the dab position.
pub fn set_brush_dab_transform(engine: &mut EngineInner, m00: f32, m01: f32, m10: f32, m11: f32) {
    engine.brush_dab_transform = [m00, m01, m10, m11];
}

pub fn cache_sub_brush_tip(engine: &mut EngineInner, index: u32, data: &[u8], width: u32, height: u32) -> Result<(), String> {
    let idx = index as usize;
    while engine.sub_brush_tips.len() <= idx {
        engine.sub_brush_tips.push(None);
    }
    if let Some((old_handle, _, _, _)) = engine.sub_brush_tips[idx].take() {
        engine.texture_pool.release(old_handle);
    }
    let pixel_count = (width * height) as usize;
    let mut sharp = vec![0u8; pixel_count];
    for i in 0..pixel_count {
        sharp[i] = if i < data.len() { data[i] } else { 0 };
    }
    let blur_radius = (width.min(height) / 2).max(1);
    let mut inverted = vec![0u8; pixel_count];
    for i in 0..pixel_count {
        inverted[i] = 255 - sharp[i];
    }
    lopsy_core::filters::blur::gaussian_blur_gray(&mut inverted, width, height, blur_radius);
    let mut min_val = 255u8;
    let mut max_val = 0u8;
    for i in 0..pixel_count {
        if sharp[i] > 5 {
            min_val = min_val.min(inverted[i]);
            max_val = max_val.max(inverted[i]);
        }
    }
    if max_val > min_val {
        for i in 0..pixel_count {
            if sharp[i] > 5 {
                let t = (inverted[i] as f32 - min_val as f32) / (max_val as f32 - min_val as f32);
                inverted[i] = (t.sqrt() * 255.0).round() as u8;
            } else {
                inverted[i] = 255;
            }
        }
    }
    let mut rgba = vec![0u8; pixel_count * 4];
    for i in 0..pixel_count {
        rgba[i * 4] = sharp[i];
        rgba[i * 4 + 1] = inverted[i];
        rgba[i * 4 + 2] = 0;
        rgba[i * 4 + 3] = 255;
    }
    let tex = engine.texture_pool.acquire(width, height)
        ?;
    engine.texture_pool.upload_rgba(tex, 0, 0, width, height, &rgba)
        ?;
    engine.sub_brush_tips[idx] = Some((tex, width, height, false));
    Ok(())
}

pub fn cache_sub_brush_tip_rgba(engine: &mut EngineInner, index: u32, data: &[u8], width: u32, height: u32) -> Result<(), String> {
    let idx = index as usize;
    while engine.sub_brush_tips.len() <= idx {
        engine.sub_brush_tips.push(None);
    }
    if let Some((old_handle, _, _, _)) = engine.sub_brush_tips[idx].take() {
        engine.texture_pool.release(old_handle);
    }
    let pixel_count = (width * height) as usize;
    let expected_len = pixel_count * 4;
    if data.len() < expected_len {
        return Err("RGBA sub-brush tip data too short".to_string());
    }
    let mut rgba = vec![0u8; expected_len];
    for i in 0..pixel_count {
        let off = i * 4;
        let a = data[off + 3] as f32 / 255.0;
        rgba[off] = (data[off] as f32 * a + 0.5) as u8;
        rgba[off + 1] = (data[off + 1] as f32 * a + 0.5) as u8;
        rgba[off + 2] = (data[off + 2] as f32 * a + 0.5) as u8;
        rgba[off + 3] = data[off + 3];
    }
    let tex = engine.texture_pool.acquire(width, height)
        ?;
    engine.texture_pool.upload_rgba(tex, 0, 0, width, height, &rgba)
        ?;
    engine.sub_brush_tips[idx] = Some((tex, width, height, true));
    Ok(())
}

pub fn activate_sub_brush_tip(engine: &mut EngineInner, index: u32, angle: f32, is_color: bool) {
    if engine.saved_primary_tip.is_none() {
        engine.saved_primary_tip = Some((
            engine.brush_tip_texture.unwrap_or(TextureHandle(usize::MAX)),
            engine.brush_tip_width,
            engine.brush_tip_height,
            engine.brush_tip_is_color,
        ));
    }
    let idx = index as usize;
    if let Some(Some((tex, w, h, cached_is_color))) = engine.sub_brush_tips.get(idx) {
        engine.brush_tip_texture = Some(*tex);
        engine.brush_tip_width = *w;
        engine.brush_tip_height = *h;
        engine.brush_has_tip = true;
        engine.brush_angle = angle;
        engine.brush_tip_is_color = if is_color { true } else { *cached_is_color };
    } else {
        engine.brush_has_tip = false;
        engine.brush_angle = angle;
        engine.brush_tip_is_color = false;
    }
}

pub fn deactivate_sub_brush_tip(engine: &mut EngineInner) {
    if let Some((tex, w, h, is_color)) = engine.saved_primary_tip.take() {
        if tex.0 == usize::MAX {
            engine.brush_tip_texture = None;
        } else {
            engine.brush_tip_texture = Some(tex);
        }
        engine.brush_tip_width = w;
        engine.brush_tip_height = h;
        engine.brush_tip_is_color = is_color;
    }
}

pub fn clear_sub_brush_tip_cache(engine: &mut EngineInner) {
    for entry in engine.sub_brush_tips.drain(..) {
        if let Some((handle, _, _, _)) = entry {
            engine.texture_pool.release(handle);
        }
    }
    engine.saved_primary_tip = None;
}

pub fn upload_brush_texture(engine: &mut EngineInner, data: &[u8], width: u32, height: u32) -> Result<(), String> {
    let mut rgba = vec![0u8; (width * height * 4) as usize];
    for i in 0..(width * height) as usize {
        let v = if i < data.len() { data[i] } else { 0 };
        rgba[i * 4] = v;
        rgba[i * 4 + 1] = v;
        rgba[i * 4 + 2] = v;
        rgba[i * 4 + 3] = 255;
    }
    if let Some(old) = engine.brush_texture.take() {
        engine.texture_pool.release(old);
    }
    let tex = engine.texture_pool.acquire(width, height)
        ?;
    engine.texture_pool.upload_rgba(tex, 0, 0, width, height, &rgba)
        ?;
    engine.texture_pool.set_repeat_wrap(tex);
    engine.brush_texture = Some(tex);
    engine.brush_texture_width = width;
    engine.brush_texture_height = height;
    Ok(())
}

pub fn clear_brush_texture(engine: &mut EngineInner) {
    if let Some(tex) = engine.brush_texture.take() {
        engine.texture_pool.release(tex);
    }
    engine.brush_texture_width = 0;
    engine.brush_texture_height = 0;
    engine.brush_has_texture = false;
}

pub fn set_brush_texture_state(engine: &mut EngineInner, has_texture: bool, scale: f32, blend_mode: u32) {
    engine.brush_has_texture = has_texture;
    engine.brush_texture_scale = scale;
    engine.brush_texture_blend_mode = blend_mode;
}

// Built-in brush tip bitmaps — auto-generated from engine-rs/brushes/*.png
include!(concat!(env!("OUT_DIR"), "/builtin_brushes.rs"));

pub fn get_builtin_brush_tip(name: &str) -> Option<Vec<u8>> {
    get_builtin_brush_tip_generated(name)
}

pub fn list_builtin_brush_tips_js() -> String {
    list_builtin_brush_tips()
}

pub fn generate_brush_stamp(size: u32, hardness: f32) -> Vec<f32> {
    lopsy_core::brush::generate_brush_stamp(size, hardness)
}

pub fn interpolate_points(from_x: f64, from_y: f64, to_x: f64, to_y: f64, spacing: f64) -> Vec<f64> {
    lopsy_core::brush::interpolate_points(from_x, from_y, to_x, to_y, spacing)
}

// ============================================================
// Dodge/Burn
// ============================================================

pub fn begin_dodge_burn_stroke(
    engine: &mut EngineInner, layer_id: &str, mode: u32,
) -> Result<(), String> {
    dodge_burn_gpu::begin_dodge_burn_stroke(&mut *engine, layer_id, mode)
        
}

pub fn apply_dodge_burn_dab_batch(
    engine: &mut EngineInner, layer_id: &str,
    points: &[f64], size: f32, hardness: f32, exposure: f32,
) {
    dodge_burn_gpu::apply_dodge_burn_dab_batch(&mut *engine, layer_id, points, size, hardness, exposure);
}

pub fn end_dodge_burn_stroke(engine: &mut EngineInner, layer_id: &str) {
    dodge_burn_gpu::end_dodge_burn_stroke(&mut *engine, layer_id);
}

// ============================================================
// Sponge
// ============================================================

pub fn begin_sponge_stroke(
    engine: &mut EngineInner, layer_id: &str, mode: u32,
) -> Result<(), String> {
    sponge_gpu::begin_sponge_stroke(&mut *engine, layer_id, mode)
        
}

pub fn apply_sponge_dab_batch(
    engine: &mut EngineInner, layer_id: &str,
    points: &[f64], size: f32, hardness: f32, strength: f32,
) {
    sponge_gpu::apply_sponge_dab_batch(&mut *engine, layer_id, points, size, hardness, strength);
}

pub fn end_sponge_stroke(engine: &mut EngineInner, layer_id: &str) {
    sponge_gpu::end_sponge_stroke(&mut *engine, layer_id);
}

// ============================================================
// Smudge
// ============================================================

pub fn apply_smudge_dab(
    engine: &mut EngineInner, layer_id: &str,
    cx: f64, cy: f64, prev_x: f64, prev_y: f64,
    size: f32, strength: f32,
) {
    smudge_gpu::apply_smudge_dab(&mut *engine, layer_id, cx, cy, prev_x, prev_y, size, strength);
}

pub fn apply_smudge_dab_batch(
    engine: &mut EngineInner, layer_id: &str,
    points: &[f64], size: f32, strength: f32,
) {
    smudge_gpu::apply_smudge_dab_batch(&mut *engine, layer_id, points, size, strength);
}

// ============================================================
// Clone Stamp
// ============================================================

pub fn apply_stamp_dab(
    engine: &mut EngineInner, layer_id: &str,
    dest_x: f64, dest_y: f64,
    source_offset_x: f64, source_offset_y: f64, size: f32,
) {
    clone_stamp_gpu::apply_clone_stamp_dab(&mut *engine, layer_id, dest_x, dest_y, source_offset_x, source_offset_y, size);
}

pub fn apply_stamp_dab_batch(
    engine: &mut EngineInner, layer_id: &str,
    points: &[f64], source_offset_x: f64, source_offset_y: f64, size: f32,
) {
    clone_stamp_gpu::apply_clone_stamp_dab_batch(&mut *engine, layer_id, points, source_offset_x, source_offset_y, size);
}

// ============================================================
// Healing Brush
// ============================================================

pub fn apply_healing_dab(
    engine: &mut EngineInner, layer_id: &str,
    dest_x: f64, dest_y: f64,
    source_offset_x: f64, source_offset_y: f64,
    size: f32, opacity: f32,
) {
    healing_brush_gpu::apply_healing_dab(&mut *engine, layer_id, dest_x, dest_y, source_offset_x, source_offset_y, size, opacity);
}

pub fn apply_healing_dab_batch(
    engine: &mut EngineInner, layer_id: &str,
    points: &[f64], source_offset_x: f64, source_offset_y: f64,
    size: f32, opacity: f32,
) {
    healing_brush_gpu::apply_healing_dab_batch(&mut *engine, layer_id, points, source_offset_x, source_offset_y, size, opacity);
}

// ============================================================
// Layer Mask GPU Painting
// ============================================================
// All coordinates are document space; see `mask_paint_gpu`.

pub fn paint_mask_dab(
    engine: &mut EngineInner, layer_id: &str,
    cx: f64, cy: f64,
    size: f32, hardness: f32, opacity: f32, mode: u32,
) {
    mask_paint_gpu::paint_mask_dab(&mut *engine, layer_id, cx, cy, size, hardness, opacity, mode);
}

pub fn paint_mask_dab_batch(
    engine: &mut EngineInner, layer_id: &str,
    points: &[f64],
    size: f32, hardness: f32, opacity: f32, mode: u32,
) {
    mask_paint_gpu::paint_mask_dab_batch(&mut *engine, layer_id, points, size, hardness, opacity, mode);
}

pub fn draw_mask_pencil_line(
    engine: &mut EngineInner, layer_id: &str,
    x0: f64, y0: f64, x1: f64, y1: f64,
    a: f32, size: f32, mode: u32,
) {
    mask_paint_gpu::draw_mask_pencil_line(&mut *engine, layer_id, x0, y0, x1, y1, a, size, mode);
}

pub fn fill_mask(
    engine: &mut EngineInner, layer_id: &str,
    doc_x: i32, doc_y: i32,
    tolerance: u32, contiguous: bool, mode: u32,
) {
    mask_paint_gpu::fill_mask(&mut *engine, layer_id, doc_x, doc_y, tolerance, contiguous, mode);
}

pub fn render_mask_linear_gradient(
    engine: &mut EngineInner, layer_id: &str,
    start_x: f64, start_y: f64, end_x: f64, end_y: f64, stops_json: &str,
) {
    mask_paint_gpu::render_mask_linear_gradient(&mut *engine, layer_id, start_x, start_y, end_x, end_y, stops_json);
}

pub fn render_mask_radial_gradient(
    engine: &mut EngineInner, layer_id: &str,
    cx: f64, cy: f64, radius: f64, stops_json: &str,
) {
    mask_paint_gpu::render_mask_radial_gradient(&mut *engine, layer_id, cx, cy, radius, stops_json);
}

pub fn read_mask_texture(engine: &mut EngineInner, layer_id: &str) -> Option<Vec<u8>> {
    mask_paint_gpu::read_mask_texture(&mut *engine, layer_id)
}
