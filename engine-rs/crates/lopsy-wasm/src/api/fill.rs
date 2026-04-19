//! Flood-fill API — the paint-bucket tool. Kept together because
//! `applyFillToLayer` and `readLayerPixelsForFill` share the same bounds /
//! selection-mask machinery that only `floodFill` and its callers need.

use wasm_bindgen::prelude::*;
use web_sys::WebGl2RenderingContext;

use crate::{Engine, layer_manager};

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
    // Ensure the layer texture covers at least the document area. This also
    // re-positions the texture so the layer's own x/y snap to (min(0,x), min(0,y)),
    // which is what we use below to align the doc-space mask with the layer
    // texture coordinate system.
    let _ = engine.inner.ensure_layer_full_size(layer_id);

    let gl = &engine.inner.gl;
    let tex_handle = match engine.inner.layer_textures.get(layer_id) {
        Some(&h) => h,
        None => return,
    };
    let (w, h) = engine.inner.texture_pool.get_size(tex_handle).unwrap_or((1, 1));

    // After ensure_layer_full_size, layer.x and layer.y are <= 0 and
    // layer.width/height cover at least the document. Doc-space (dx, dy) maps
    // to layer-local (dx - layer.x, dy - layer.y).
    let (layer_x, layer_y) = engine.inner.layer_stack.iter()
        .find(|l| l.id == layer_id)
        .map(|l| (l.x, l.y))
        .unwrap_or((0, 0));

    let layer_tex = match engine.inner.texture_pool.get(tex_handle) {
        Some(t) => t.clone(),
        None => return,
    };

    // Build a layer-sized mask with the doc-space mask placed at
    // (-layer_x, -layer_y). Sampling both the layer tex and the mask with the
    // same v_uv (the shader's design) only aligns them when the textures are
    // the same size.
    let mask_tex = match engine.inner.texture_pool.acquire(gl, w, h) {
        Ok(h) => h,
        Err(_) => return,
    };
    let mut mask_rgba = vec![0u8; (w * h * 4) as usize];
    let offset_x = -layer_x;
    let offset_y = -layer_y;
    let doc_w = width as i32;
    let doc_h = height as i32;
    let tex_w = w as i32;
    let tex_h = h as i32;
    for dy in 0..doc_h {
        let ly = dy + offset_y;
        if ly < 0 || ly >= tex_h { continue; }
        for dx in 0..doc_w {
            let lx = dx + offset_x;
            if lx < 0 || lx >= tex_w { continue; }
            let si = (dy * doc_w + dx) as usize;
            let v = if si < mask.len() { mask[si] } else { 0 };
            let di = ((ly * tex_w + lx) * 4) as usize;
            mask_rgba[di] = v;
            mask_rgba[di + 1] = 0;
            mask_rgba[di + 2] = 0;
            mask_rgba[di + 3] = 255;
        }
    }
    let _ = engine.inner.texture_pool.upload_rgba(
        gl, mask_tex, 0, 0, w, h, &mask_rgba,
    );

    // Allocate an output texture the same size as the layer tex. We render the
    // fill shader into it (sampling the old layer tex), then swap it in as the
    // new layer tex. Using a layer-sized output avoids the scratch textures,
    // which are only doc-sized and would clip writes when the layer extends
    // past the document bounds (e.g. after ensure_layer_full_size expanded it).
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
        if let Some(loc) = shader.location(gl, "u_layerTex") {
            gl.uniform1i(Some(&loc), 0);
        }
        gl.active_texture(WebGl2RenderingContext::TEXTURE1);
        if let Some(t) = &mask_tex_gl {
            gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(t));
        }
        if let Some(loc) = shader.location(gl, "u_maskTex") {
            gl.uniform1i(Some(&loc), 1);
        }
        if let Some(loc) = shader.location(gl, "u_fillColor") {
            gl.uniform4f(Some(&loc), fill_r, fill_g, fill_b, fill_a);
        }
        eng.draw_fullscreen_quad();
    });

    // Swap: the new output texture becomes the layer's texture.
    if let Some(old) = engine.inner.layer_textures.insert(layer_id.to_string(), out_tex_h) {
        engine.inner.texture_pool.release(old);
    }
    engine.inner.texture_pool.release(mask_tex);
    engine.inner.mark_layer_dirty(layer_id);
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
