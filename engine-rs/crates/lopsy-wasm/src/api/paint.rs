//! Paint-tool API: brush, eraser, pencil, and the custom brush tip state.
//! Plus dab-based tools that share the paint pipeline — dodge/burn, smudge,
//! and clone stamp.
//!
//! Each function is a thin `#[wasm_bindgen]` wrapper around one of the
//! `*_gpu` modules. Moving them out of lib.rs doesn't change any call
//! site — it just groups the paint surface in one place.

use wasm_bindgen::prelude::*;
use web_sys::WebGl2RenderingContext;

use crate::Engine;
use crate::{brush_gpu, clone_stamp_gpu, dodge_burn_gpu, smudge_gpu};

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

    // Read selection mask from GPU if present
    let selection_mask: Option<(Vec<u8>, u32, u32)> = eng.selection_mask_texture.and_then(|mask_handle| {
        let (mw, mh) = eng.texture_pool.get_size(mask_handle)?;
        if let Some(mask_tex) = eng.texture_pool.get(mask_handle) {
            let fbo = eng.gl.create_framebuffer()?;
            eng.gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, Some(&fbo));
            eng.gl.framebuffer_texture_2d(
                WebGl2RenderingContext::FRAMEBUFFER,
                WebGl2RenderingContext::COLOR_ATTACHMENT0,
                WebGl2RenderingContext::TEXTURE_2D,
                Some(mask_tex),
                0,
            );
            let data = eng.texture_pool.read_rgba(&eng.gl, 0, 0, mw, mh).ok();
            eng.gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, None);
            eng.gl.delete_framebuffer(Some(&fbo));
            data.map(|d| (d, mw, mh))
        } else {
            None
        }
    });

    // Get layer offset for selection coordinate mapping
    let (layer_ox, layer_oy) = eng.layer_stack.iter()
        .find(|l| l.id == layer_id)
        .map(|l| (l.x, l.y))
        .unwrap_or((0, 0));

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
                let px = bx + (j as i32 % bw);
                let py = by + (j as i32 / bw);

                // Check selection mask
                let mut pixel_a = a8;
                if let Some((ref mask_data, mw, mh)) = selection_mask {
                    let doc_x = px + layer_ox as i32;
                    let doc_y = py + layer_oy as i32;
                    if doc_x >= 0 && doc_x < mw as i32 && doc_y >= 0 && doc_y < mh as i32 {
                        let mask_val = mask_data[(doc_y as u32 * mw + doc_x as u32) as usize * 4];
                        pixel_a = ((pixel_a as u32 * mask_val as u32) / 255) as u8;
                    } else {
                        pixel_a = 0;
                    }
                }

                rgba[j * 4] = r8;
                rgba[j * 4 + 1] = g8;
                rgba[j * 4 + 2] = b8;
                rgba[j * 4 + 3] = pixel_a;
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

#[wasm_bindgen(js_name = "uploadBrushTip")]
pub fn upload_brush_tip(engine: &mut Engine, data: &[u8], width: u32, height: u32) -> Result<(), JsError> {
    let mut rgba = vec![0u8; (width * height * 4) as usize];
    for i in 0..(width * height) as usize {
        let v = if i < data.len() { data[i] } else { 0 };
        rgba[i * 4] = v;
        rgba[i * 4 + 1] = v;
        rgba[i * 4 + 2] = v;
        rgba[i * 4 + 3] = 255;
    }
    if let Some(old) = engine.inner.brush_tip_texture.take() {
        engine.inner.texture_pool.release(old);
    }
    let tex = engine.inner.texture_pool.acquire(&engine.inner.gl, width, height)
        .map_err(|e| JsError::new(&e))?;
    engine.inner.texture_pool.upload_rgba(&engine.inner.gl, tex, 0, 0, width, height, &rgba)
        .map_err(|e| JsError::new(&e))?;
    engine.inner.brush_tip_texture = Some(tex);
    engine.inner.brush_tip_width = width;
    engine.inner.brush_tip_height = height;
    Ok(())
}

#[wasm_bindgen(js_name = "clearBrushTip")]
pub fn clear_brush_tip(engine: &mut Engine) {
    if let Some(tex) = engine.inner.brush_tip_texture.take() {
        engine.inner.texture_pool.release(tex);
    }
    engine.inner.brush_tip_width = 0;
    engine.inner.brush_tip_height = 0;
    engine.inner.brush_has_tip = false;
}

#[wasm_bindgen(js_name = "setBrushTipState")]
pub fn set_brush_tip_state(engine: &mut Engine, has_tip: bool, angle: f32) {
    engine.inner.brush_has_tip = has_tip;
    engine.inner.brush_angle = angle;
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
// Smudge
// ============================================================

#[wasm_bindgen(js_name = "applySmudgeDab")]
pub fn apply_smudge_dab(
    engine: &mut Engine, layer_id: &str,
    cx: f64, cy: f64, prev_x: f64, prev_y: f64,
    size: f32, strength: f32,
) {
    smudge_gpu::apply_smudge_dab(&mut engine.inner, layer_id, cx, cy, prev_x, prev_y, size, strength);
}

#[wasm_bindgen(js_name = "applySmudgeDabBatch")]
pub fn apply_smudge_dab_batch(
    engine: &mut Engine, layer_id: &str,
    points: &[f64], size: f32, strength: f32,
) {
    smudge_gpu::apply_smudge_dab_batch(&mut engine.inner, layer_id, points, size, strength);
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
