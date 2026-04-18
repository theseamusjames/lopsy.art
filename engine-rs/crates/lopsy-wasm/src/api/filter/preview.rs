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

    let gl = &inner.gl;
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

    let temp_fbo = gl.create_framebuffer();
    gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, temp_fbo.as_ref());
    gl.framebuffer_texture_2d(
        WebGl2RenderingContext::FRAMEBUFFER,
        WebGl2RenderingContext::COLOR_ATTACHMENT0,
        WebGl2RenderingContext::TEXTURE_2D,
        Some(&preview_tex),
        0,
    );
    gl.viewport(0, 0, w as i32, h as i32);
    gl.disable(WebGl2RenderingContext::BLEND);
    gl.use_program(Some(&inner.shaders.blit.program));
    gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&layer_tex));
    if let Some(loc) = gl.get_uniform_location(&inner.shaders.blit.program, "u_tex") {
        gl.uniform1i(Some(&loc), 0);
    }
    inner.draw_fullscreen_quad();
    gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, None);
    gl.delete_framebuffer(temp_fbo.as_ref());

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
    let gl = &inner.gl;

    let temp_fbo = gl.create_framebuffer();
    gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, temp_fbo.as_ref());
    gl.framebuffer_texture_2d(
        WebGl2RenderingContext::FRAMEBUFFER,
        WebGl2RenderingContext::COLOR_ATTACHMENT0,
        WebGl2RenderingContext::TEXTURE_2D,
        Some(&layer_tex),
        0,
    );
    gl.viewport(0, 0, w as i32, h as i32);
    gl.disable(WebGl2RenderingContext::BLEND);
    gl.use_program(Some(&inner.shaders.blit.program));
    gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&preview_tex));
    if let Some(loc) = gl.get_uniform_location(&inner.shaders.blit.program, "u_tex") {
        gl.uniform1i(Some(&loc), 0);
    }
    inner.draw_fullscreen_quad();
    gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, None);
    gl.delete_framebuffer(temp_fbo.as_ref());

    inner.mark_layer_dirty(&layer_id);
}

#[wasm_bindgen(js_name = "clearFilterPreview")]
pub fn clear_filter_preview(engine: &mut Engine) {
    if let Some(tex) = engine.inner.filter_preview_texture.take() {
        engine.inner.texture_pool.release(tex);
    }
    engine.inner.filter_preview_layer_id = None;
}
