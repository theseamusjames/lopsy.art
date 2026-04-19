//! Filter preview texture: save/restore/clear the pre-filter layer state
//! so interactive filter dialogs can preview without destroying the
//! original pixels until the user clicks Apply.

use wasm_bindgen::prelude::*;
use web_sys::WebGl2RenderingContext;

use crate::Engine;

#[wasm_bindgen(js_name = "saveFilterPreview")]
pub fn save_filter_preview(engine: &mut Engine, layer_id: &str) {
    let inner = &mut engine.inner;
    let _ = inner.ensure_layer_full_size(layer_id);

    let tex_handle = match inner.layer_textures.get(layer_id) {
        Some(&h) => h,
        None => return,
    };
    let (w, h) = inner.texture_pool.get_size(tex_handle).unwrap_or((1, 1));
    let layer_tex = match inner.texture_pool.get(tex_handle) {
        Some(t) => t.clone(),
        None => return,
    };

    if let Some(old) = inner.filter_preview_texture.take() {
        inner.texture_pool.release(old);
    }
    let preview_handle = match inner.texture_pool.acquire(&inner.gl, w, h) {
        Ok(h) => h,
        Err(_) => return,
    };
    let preview_tex = match inner.texture_pool.get(preview_handle) {
        Some(t) => t.clone(),
        None => return,
    };

    inner.gl.disable(WebGl2RenderingContext::BLEND);
    inner.render_to_texture(&preview_tex, w as i32, h as i32, |eng| {
        let gl = &eng.gl;
        gl.use_program(Some(&eng.shaders.blit.program));
        gl.active_texture(WebGl2RenderingContext::TEXTURE0);
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&layer_tex));
        if let Some(loc) = eng.shaders.blit.location(gl, "u_tex") {
            gl.uniform1i(Some(&loc), 0);
        }
        eng.draw_fullscreen_quad();
    });

    inner.filter_preview_texture = Some(preview_handle);
    inner.filter_preview_layer_id = Some(layer_id.to_string());
}

#[wasm_bindgen(js_name = "restoreFilterPreview")]
pub fn restore_filter_preview(engine: &mut Engine) {
    let inner = &mut engine.inner;
    let preview_handle = match inner.filter_preview_texture {
        Some(h) => h,
        None => return,
    };
    let layer_id = match &inner.filter_preview_layer_id {
        Some(id) => id.clone(),
        None => return,
    };
    let layer_tex_handle = match inner.layer_textures.get(&layer_id) {
        Some(&h) => h,
        None => return,
    };
    let (w, h) = inner.texture_pool.get_size(layer_tex_handle).unwrap_or((1, 1));
    let layer_tex = match inner.texture_pool.get(layer_tex_handle) {
        Some(t) => t.clone(),
        None => return,
    };
    let preview_tex = match inner.texture_pool.get(preview_handle) {
        Some(t) => t.clone(),
        None => return,
    };

    inner.gl.disable(WebGl2RenderingContext::BLEND);
    inner.render_to_texture(&layer_tex, w as i32, h as i32, |eng| {
        let gl = &eng.gl;
        gl.use_program(Some(&eng.shaders.blit.program));
        gl.active_texture(WebGl2RenderingContext::TEXTURE0);
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&preview_tex));
        if let Some(loc) = eng.shaders.blit.location(gl, "u_tex") {
            gl.uniform1i(Some(&loc), 0);
        }
        eng.draw_fullscreen_quad();
    });

    inner.mark_layer_dirty(&layer_id);
}

#[wasm_bindgen(js_name = "clearFilterPreview")]
pub fn clear_filter_preview(engine: &mut Engine) {
    if let Some(tex) = engine.inner.filter_preview_texture.take() {
        engine.inner.texture_pool.release(tex);
    }
    engine.inner.filter_preview_layer_id = None;
}
