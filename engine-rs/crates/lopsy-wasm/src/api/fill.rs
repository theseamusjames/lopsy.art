//! Flood-fill API — the paint-bucket tool. Kept together because
//! `applyFillToLayer` and `readLayerPixelsForFill` share the same bounds /
//! selection-mask machinery that only `floodFill` and its callers need.

use wasm_bindgen::prelude::*;
use web_sys::WebGl2RenderingContext;

use crate::{Engine, layer_manager};

/// #667 — Fast path: fill an entire layer with a solid color, optionally
/// restricted to a doc-space selection mask, without ever touching the CPU
/// flood-fill machinery. Used by the bucket tool when we can prove the fill
/// covers everything (empty layer + no color match needed) so the caller
/// avoids the pixel-readback + CPU flood + mask-upload roundtrip.
///
/// Runs `flood_fill_apply` with an all-1 pseudo-mask synthesized on the fly
/// from either the selection mask or a full-coverage upload.
#[wasm_bindgen(js_name = "bucketFillSolid")]
pub fn bucket_fill_solid(
    engine: &mut Engine, layer_id: &str,
    fill_r: f32, fill_g: f32, fill_b: f32, fill_a: f32,
    selection_mask: Option<Vec<u8>>, sel_w: u32, sel_h: u32,
) {
    let _ = engine.inner.ensure_layer_full_size(layer_id);

    let (w, h, mask_bytes) = if let Some(mask) = selection_mask {
        (sel_w, sel_h, mask)
    } else {
        // No selection — synthesize an all-255 mask sized to the doc.
        let dw = engine.inner.doc_width;
        let dh = engine.inner.doc_height;
        (dw, dh, vec![255u8; (dw as usize) * (dh as usize)])
    };

    apply_fill_impl(engine, layer_id, fill_r, fill_g, fill_b, fill_a, &mask_bytes, w, h);
}

/// #667 — Non-contiguous ("fill by color") bucket fill entirely on the GPU.
/// Compares each layer texel against a reference sampled at the click point;
/// fills where `channel_delta <= tolerance`. Skips CPU readback + flood fill
/// so a click on a 5000x4000 layer becomes one shader pass instead of two
/// full-buffer WASM<->JS round trips.
///
/// `doc_x/doc_y` are the click's doc-space coordinates. The selection mask,
/// when provided, is a doc-sized single-channel buffer (0..255).
#[wasm_bindgen(js_name = "bucketFillByColorGpu")]
pub fn bucket_fill_by_color_gpu(
    engine: &mut Engine, layer_id: &str,
    doc_x: i32, doc_y: i32,
    fill_r: f32, fill_g: f32, fill_b: f32, fill_a: f32,
    tolerance: f32,
    selection_mask: Option<Vec<u8>>, sel_w: u32, sel_h: u32,
) {
    let _ = engine.inner.ensure_layer_full_size(layer_id);

    let tex_handle = match engine.inner.layer_textures.get(layer_id) {
        Some(&h) => h,
        None => return,
    };
    let (tw, th) = engine.inner.texture_pool.get_size(tex_handle).unwrap_or((1, 1));

    // Convert doc-space click into layer-local, then UV space [0..1].
    let (layer_x, layer_y) = engine.inner.layer_stack.iter()
        .find(|l| l.id == layer_id)
        .map(|l| (l.x, l.y))
        .unwrap_or((0, 0));
    let sample_lx = doc_x - layer_x;
    let sample_ly = doc_y - layer_y;
    if sample_lx < 0 || sample_ly < 0 || sample_lx >= tw as i32 || sample_ly >= th as i32 {
        // Click landed outside the layer texture — nothing to sample from.
        return;
    }
    let sample_u = (sample_lx as f32 + 0.5) / tw as f32;
    let sample_v = (sample_ly as f32 + 0.5) / th as f32;

    let layer_tex = match engine.inner.texture_pool.get(tex_handle) {
        Some(t) => t.clone(),
        None => return,
    };

    // Selection mask (if any) is uploaded into a layer-sized RGBA texture
    // with the doc mask placed at (-layer_x, -layer_y) — same alignment
    // machinery as apply_fill_impl.
    let sel_tex_handle_gl = if let Some(mask) = selection_mask {
        upload_doc_mask_to_layer_tex(engine, layer_x, layer_y, tw, th, &mask, sel_w, sel_h)
    } else {
        None
    };
    let sel_tex_gl = sel_tex_handle_gl.and_then(|h| {
        engine.inner.texture_pool.get(h).cloned().map(|t| (h, t))
    });

    let gl = &engine.inner.gl;
    let out_tex_h = match engine.inner.texture_pool.acquire(gl, tw, th) {
        Ok(h) => h,
        Err(_) => {
            if let Some((h, _)) = sel_tex_gl { engine.inner.texture_pool.release(h); }
            return;
        }
    };
    let out_tex = match engine.inner.texture_pool.get(out_tex_h) {
        Some(t) => t.clone(),
        None => {
            engine.inner.texture_pool.release(out_tex_h);
            if let Some((h, _)) = sel_tex_gl { engine.inner.texture_pool.release(h); }
            return;
        }
    };

    let has_sel = sel_tex_gl.is_some();
    let sel_tex_gl_ref = sel_tex_gl.as_ref().map(|(_, t)| t.clone());

    engine.inner.render_to_texture(&out_tex, tw as i32, th as i32, |eng| {
        let gl = &eng.gl;
        let shader = &eng.shaders.bucket_fill_color_match;
        gl.use_program(Some(&shader.program));

        gl.active_texture(WebGl2RenderingContext::TEXTURE0);
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&layer_tex));
        if let Some(loc) = shader.location(gl, "u_layerTex") { gl.uniform1i(Some(&loc), 0); }

        gl.active_texture(WebGl2RenderingContext::TEXTURE1);
        if let Some(t) = &sel_tex_gl_ref {
            gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(t));
        }
        if let Some(loc) = shader.location(gl, "u_selMaskTex") { gl.uniform1i(Some(&loc), 1); }
        if let Some(loc) = shader.location(gl, "u_hasSelMask") { gl.uniform1i(Some(&loc), if has_sel { 1 } else { 0 }); }
        if let Some(loc) = shader.location(gl, "u_sampleUv") { gl.uniform2f(Some(&loc), sample_u, sample_v); }
        if let Some(loc) = shader.location(gl, "u_fillColor") { gl.uniform4f(Some(&loc), fill_r, fill_g, fill_b, fill_a); }
        if let Some(loc) = shader.location(gl, "u_tolerance") { gl.uniform1f(Some(&loc), tolerance); }

        eng.draw_fullscreen_quad();
    });

    if let Some(old) = engine.inner.layer_textures.insert(layer_id.to_string(), out_tex_h) {
        engine.inner.texture_pool.release(old);
    }
    if let Some((h, _)) = sel_tex_gl {
        engine.inner.texture_pool.release(h);
    }
    engine.inner.mark_layer_dirty(layer_id);
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

#[wasm_bindgen(js_name = "floodFillGraduated")]
pub fn flood_fill_graduated(
    pixel_data: &[u8], width: u32, height: u32,
    start_x: u32, start_y: u32,
    tolerance: u32, contiguous: bool,
) -> Vec<u8> {
    lopsy_core::flood_fill::flood_fill_graduated(pixel_data, width, height, start_x, start_y, tolerance, contiguous)
}

#[wasm_bindgen(js_name = "applyFillToLayer")]
pub fn apply_fill_to_layer(
    engine: &mut Engine, layer_id: &str,
    fill_r: f32, fill_g: f32, fill_b: f32, fill_a: f32,
    mask: &[u8], width: u32, height: u32,
) {
    apply_fill_impl(engine, layer_id, fill_r, fill_g, fill_b, fill_a, mask, width, height);
}

/// Shared implementation used by `applyFillToLayer` (with a caller-supplied
/// flood-fill mask) and `bucketFillSolid` (with a synthesized full-coverage
/// mask). Uploads a layer-sized mask texture, runs `flood_fill_apply`, and
/// swaps in the resulting texture as the layer's new texture.
fn apply_fill_impl(
    engine: &mut Engine, layer_id: &str,
    fill_r: f32, fill_g: f32, fill_b: f32, fill_a: f32,
    mask: &[u8], width: u32, height: u32,
) {
    let _ = engine.inner.ensure_layer_full_size(layer_id);

    let tex_handle = match engine.inner.layer_textures.get(layer_id) {
        Some(&h) => h,
        None => return,
    };
    let (w, h) = engine.inner.texture_pool.get_size(tex_handle).unwrap_or((1, 1));
    let (layer_x, layer_y) = engine.inner.layer_stack.iter()
        .find(|l| l.id == layer_id)
        .map(|l| (l.x, l.y))
        .unwrap_or((0, 0));

    let layer_tex = match engine.inner.texture_pool.get(tex_handle) {
        Some(t) => t.clone(),
        None => return,
    };

    let mask_tex = match upload_doc_mask_to_layer_tex(engine, layer_x, layer_y, w, h, mask, width, height) {
        Some(h) => h,
        None => return,
    };

    let gl = &engine.inner.gl;
    let out_tex_h = match engine.inner.texture_pool.acquire(gl, w, h) {
        Ok(h) => h,
        Err(_) => {
            engine.inner.texture_pool.release(mask_tex);
            return;
        }
    };
    let out_tex = match engine.inner.texture_pool.get(out_tex_h) {
        Some(t) => t.clone(),
        None => {
            engine.inner.texture_pool.release(mask_tex);
            engine.inner.texture_pool.release(out_tex_h);
            return;
        }
    };

    let mask_tex_gl = engine.inner.texture_pool.get(mask_tex).cloned();
    engine.inner.render_to_texture(&out_tex, w as i32, h as i32, |eng| {
        let gl = &eng.gl;
        let shader = &eng.shaders.flood_fill_apply;
        gl.use_program(Some(&shader.program));
        gl.active_texture(WebGl2RenderingContext::TEXTURE0);
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&layer_tex));
        if let Some(loc) = shader.location(gl, "u_layerTex") { gl.uniform1i(Some(&loc), 0); }
        gl.active_texture(WebGl2RenderingContext::TEXTURE1);
        if let Some(t) = &mask_tex_gl {
            gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(t));
        }
        if let Some(loc) = shader.location(gl, "u_maskTex") { gl.uniform1i(Some(&loc), 1); }
        if let Some(loc) = shader.location(gl, "u_fillColor") { gl.uniform4f(Some(&loc), fill_r, fill_g, fill_b, fill_a); }
        eng.draw_fullscreen_quad();
    });

    if let Some(old) = engine.inner.layer_textures.insert(layer_id.to_string(), out_tex_h) {
        engine.inner.texture_pool.release(old);
    }
    engine.inner.texture_pool.release(mask_tex);
    engine.inner.mark_layer_dirty(layer_id);
}

/// Convert a doc-space single-channel mask into a layer-sized RGBA texture,
/// placing it at (-layer_x, -layer_y) so the shader can sample the mask with
/// the same UVs as the layer texture. Returns the texture handle, or None on
/// allocation failure.
fn upload_doc_mask_to_layer_tex(
    engine: &mut Engine,
    layer_x: i32, layer_y: i32,
    tex_w: u32, tex_h: u32,
    doc_mask: &[u8], doc_w: u32, doc_h: u32,
) -> Option<crate::gpu::texture_pool::TextureHandle> {
    let gl = &engine.inner.gl;
    let mask_tex = engine.inner.texture_pool.acquire(gl, tex_w, tex_h).ok()?;

    let mut mask_rgba = vec![0u8; (tex_w as usize) * (tex_h as usize) * 4];
    let offset_x = -layer_x;
    let offset_y = -layer_y;
    let doc_wi = doc_w as i32;
    let doc_hi = doc_h as i32;
    let tex_wi = tex_w as i32;
    let tex_hi = tex_h as i32;
    for dy in 0..doc_hi {
        let ly = dy + offset_y;
        if ly < 0 || ly >= tex_hi { continue; }
        for dx in 0..doc_wi {
            let lx = dx + offset_x;
            if lx < 0 || lx >= tex_wi { continue; }
            let si = (dy * doc_wi + dx) as usize;
            let v = if si < doc_mask.len() { doc_mask[si] } else { 0 };
            let di = ((ly * tex_wi + lx) * 4) as usize;
            mask_rgba[di] = v;
            mask_rgba[di + 1] = 0;
            mask_rgba[di + 2] = 0;
            mask_rgba[di + 3] = 255;
        }
    }
    let _ = engine.inner.texture_pool.upload_rgba(gl, mask_tex, 0, 0, tex_w, tex_h, &mask_rgba);
    Some(mask_tex)
}

#[wasm_bindgen(js_name = "readLayerPixelsForFill")]
pub fn read_layer_pixels_for_fill(engine: &Engine, layer_id: &str) -> Result<Vec<u8>, JsError> {
    // Return a doc-space pixel buffer. The layer texture is in layer-local
    // coordinates and may be offset from the document origin (e.g. after
    // align-bottom layer.y = doc_h - layer_h), so we always place it at
    // (layer.x, layer.y) within a transparent doc-size buffer. Negative
    // offsets (layer extending off-canvas) are clipped.
    let eng = &engine.inner;
    let doc_w = eng.doc_width as i32;
    let doc_h = eng.doc_height as i32;
    if doc_w <= 0 || doc_h <= 0 {
        return Ok(Vec::new());
    }

    let tex_handle = eng.layer_textures.get(layer_id)
        .ok_or_else(|| JsError::new(&format!("Layer {layer_id} not found")))?;
    let (tw, th) = eng.texture_pool.get_size(*tex_handle).unwrap_or((0, 0));

    let layer = eng.layer_stack.iter().find(|l| l.id == layer_id);
    let lx = layer.map_or(0, |l| l.x);
    let ly = layer.map_or(0, |l| l.y);

    let small = layer_manager::read_pixels(eng, layer_id).map_err(|e| JsError::new(&e))?;
    let mut result = vec![0u8; (doc_w as usize) * (doc_h as usize) * 4];

    let tw_i = tw as i32;
    let th_i = th as i32;
    for sy in 0..th_i {
        let dy = ly + sy;
        if dy < 0 { continue; }
        if dy >= doc_h { break; }
        for sx in 0..tw_i {
            let dx = lx + sx;
            if dx < 0 { continue; }
            if dx >= doc_w { break; }
            let si = ((sy * tw_i + sx) * 4) as usize;
            let di = ((dy * doc_w + dx) * 4) as usize;
            result[di..di + 4].copy_from_slice(&small[si..si + 4]);
        }
    }

    Ok(result)
}
