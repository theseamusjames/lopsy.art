//! Render filters: pattern fill (tile a pattern texture across a layer).

use wasm_bindgen::prelude::*;
use web_sys::WebGl2RenderingContext;

use crate::Engine;
use crate::filter_gpu;

#[wasm_bindgen(js_name = "filterPatternFill")]
pub fn filter_pattern_fill(
    engine: &mut Engine,
    layer_id: &str,
    pattern_data: &[u8],
    pattern_width: u32,
    pattern_height: u32,
    scale: f32,
    offset_x: f32,
    offset_y: f32,
) {
    if pattern_width == 0 || pattern_height == 0 || pattern_data.is_empty() {
        return;
    }

    let gl = &engine.inner.gl;

    let pattern_handle = match engine.inner.texture_pool.acquire(gl, pattern_width, pattern_height) {
        Ok(h) => h,
        Err(_) => return,
    };
    let _ = engine.inner.texture_pool.upload_rgba(
        gl, pattern_handle, 0, 0, pattern_width, pattern_height, pattern_data,
    );
    let pattern_tex = engine.inner.texture_pool.get(pattern_handle).cloned();

    let tex_handle = match engine.inner.layer_textures.get(layer_id) {
        Some(&h) => h,
        None => {
            engine.inner.texture_pool.release(pattern_handle);
            return;
        }
    };
    let (layer_w, layer_h) = engine.inner.texture_pool.get_size(tex_handle).unwrap_or((1, 1));

    let pw = pattern_width as f32;
    let ph = pattern_height as f32;
    let lw = layer_w as f32;
    let lh = layer_h as f32;
    let scale = scale.max(0.01);

    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.pattern_fill,
        |gl, shader| {
            gl.active_texture(WebGl2RenderingContext::TEXTURE1);
            if let Some(t) = &pattern_tex {
                gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(t));
            }
            if let Some(loc) = shader.location(gl, "u_pattern") {
                gl.uniform1i(Some(&loc), 1);
            }
            if let Some(loc) = shader.location(gl, "u_layerSize") {
                gl.uniform2f(Some(&loc), lw, lh);
            }
            if let Some(loc) = shader.location(gl, "u_patternSize") {
                gl.uniform2f(Some(&loc), pw, ph);
            }
            if let Some(loc) = shader.location(gl, "u_scale") {
                gl.uniform1f(Some(&loc), scale);
            }
            if let Some(loc) = shader.location(gl, "u_offset") {
                gl.uniform2f(Some(&loc), offset_x, offset_y);
            }
        },
    );

    engine.inner.texture_pool.release(pattern_handle);
}
