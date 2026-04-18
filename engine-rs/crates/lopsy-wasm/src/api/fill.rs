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
    let shader = &engine.inner.shaders.flood_fill_apply;
    gl.use_program(Some(&shader.program));

    engine.inner.fbo_pool.bind(gl, engine.inner.scratch_fbo_a);
    gl.viewport(0, 0, w as i32, h as i32);

    gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&layer_tex));
    if let Some(loc) = shader.location(gl, "u_layerTex") {
        gl.uniform1i(Some(&loc), 0);
    }
    gl.active_texture(WebGl2RenderingContext::TEXTURE1);
    if let Some(tex) = engine.inner.texture_pool.get(mask_tex) {
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(tex));
    }
    if let Some(loc) = shader.location(gl, "u_maskTex") {
        gl.uniform1i(Some(&loc), 1);
    }
    if let Some(loc) = shader.location(gl, "u_fillColor") {
        gl.uniform4f(Some(&loc), fill_r, fill_g, fill_b, fill_a);
    }

    engine.inner.draw_fullscreen_quad();

    // Copy scratch A -> layer texture
    let scratch_a_tex = engine.inner.texture_pool.get(engine.inner.scratch_texture_a).cloned();
    engine.inner.render_to_texture(&layer_tex, w as i32, h as i32, |eng| {
        let gl = &eng.gl;
        gl.use_program(Some(&eng.shaders.blit.program));
        gl.active_texture(WebGl2RenderingContext::TEXTURE0);
        if let Some(s) = &scratch_a_tex {
            gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(s));
        }
        if let Some(loc) = eng.shaders.blit.location(gl, "u_tex") {
            gl.uniform1i(Some(&loc), 0);
        }
        eng.draw_fullscreen_quad();
    });

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
