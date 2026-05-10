//! Distortion filters: mesh warp, liquify warp.

use wasm_bindgen::prelude::*;
use web_sys::WebGl2RenderingContext;

use crate::Engine;
use crate::filter_gpu;

#[wasm_bindgen(js_name = "filterMeshWarp")]
pub fn filter_mesh_warp(
    engine: &mut Engine,
    layer_id: &str,
    grid_data: &[u8],
    grid_width: u32,
    grid_height: u32,
    bounds_min_u: f32,
    bounds_min_v: f32,
    bounds_max_u: f32,
    bounds_max_v: f32,
) {
    if grid_width < 2 || grid_height < 2 || grid_data.is_empty() {
        return;
    }

    let gl = &engine.inner.gl;

    let grid_handle = match engine.inner.texture_pool.acquire(gl, grid_width, grid_height) {
        Ok(h) => h,
        Err(_) => return,
    };
    let _ = engine.inner.texture_pool.upload_rgba(
        gl, grid_handle, 0, 0, grid_width, grid_height, grid_data,
    );

    let grid_tex_obj = engine.inner.texture_pool.get(grid_handle).cloned();

    // Set LINEAR filtering on the grid texture for smooth interpolation
    if let Some(ref t) = grid_tex_obj {
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(t));
        gl.tex_parameteri(
            WebGl2RenderingContext::TEXTURE_2D,
            WebGl2RenderingContext::TEXTURE_MIN_FILTER,
            WebGl2RenderingContext::LINEAR as i32,
        );
        gl.tex_parameteri(
            WebGl2RenderingContext::TEXTURE_2D,
            WebGl2RenderingContext::TEXTURE_MAG_FILTER,
            WebGl2RenderingContext::LINEAR as i32,
        );
        gl.tex_parameteri(
            WebGl2RenderingContext::TEXTURE_2D,
            WebGl2RenderingContext::TEXTURE_WRAP_S,
            WebGl2RenderingContext::CLAMP_TO_EDGE as i32,
        );
        gl.tex_parameteri(
            WebGl2RenderingContext::TEXTURE_2D,
            WebGl2RenderingContext::TEXTURE_WRAP_T,
            WebGl2RenderingContext::CLAMP_TO_EDGE as i32,
        );
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, None);
    }

    let gw = grid_width as f32;
    let gh = grid_height as f32;

    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.mesh_warp,
        |gl, shader| {
            gl.active_texture(WebGl2RenderingContext::TEXTURE1);
            if let Some(t) = &grid_tex_obj {
                gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(t));
            }
            if let Some(loc) = shader.location(gl, "u_grid") {
                gl.uniform1i(Some(&loc), 1);
            }
            if let Some(loc) = shader.location(gl, "u_gridSize") {
                gl.uniform2f(Some(&loc), gw, gh);
            }
            if let Some(loc) = shader.location(gl, "u_boundsMin") {
                gl.uniform2f(Some(&loc), bounds_min_u, bounds_min_v);
            }
            if let Some(loc) = shader.location(gl, "u_boundsMax") {
                gl.uniform2f(Some(&loc), bounds_max_u, bounds_max_v);
            }
        },
    );

    engine.inner.texture_pool.release(grid_handle);
}

/// Allocate a persistent displacement texture and upload the initial
/// (zeroed) RGBA8 data. Call once when the Liquify session opens.
#[wasm_bindgen(js_name = "liquifyInitDisplacement")]
pub fn liquify_init_displacement(
    engine: &mut Engine,
    data: &[u8],
    width: u32,
    height: u32,
) {
    if data.is_empty() || width == 0 || height == 0 {
        return;
    }
    let gl = &engine.inner.gl;

    if let Some(old) = engine.inner.liquify_disp_texture.take() {
        engine.inner.texture_pool.release(old);
    }
    let handle = match engine.inner.texture_pool.acquire(gl, width, height) {
        Ok(h) => h,
        Err(_) => return,
    };
    let _ = engine.inner.texture_pool.upload_rgba(gl, handle, 0, 0, width, height, data);

    // NEAREST — displacement is per-pixel.
    if let Some(tex) = engine.inner.texture_pool.get(handle) {
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(tex));
        gl.tex_parameteri(
            WebGl2RenderingContext::TEXTURE_2D,
            WebGl2RenderingContext::TEXTURE_MIN_FILTER,
            WebGl2RenderingContext::NEAREST as i32,
        );
        gl.tex_parameteri(
            WebGl2RenderingContext::TEXTURE_2D,
            WebGl2RenderingContext::TEXTURE_MAG_FILTER,
            WebGl2RenderingContext::NEAREST as i32,
        );
        gl.tex_parameteri(
            WebGl2RenderingContext::TEXTURE_2D,
            WebGl2RenderingContext::TEXTURE_WRAP_S,
            WebGl2RenderingContext::CLAMP_TO_EDGE as i32,
        );
        gl.tex_parameteri(
            WebGl2RenderingContext::TEXTURE_2D,
            WebGl2RenderingContext::TEXTURE_WRAP_T,
            WebGl2RenderingContext::CLAMP_TO_EDGE as i32,
        );
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, None);
    }
    engine.inner.liquify_disp_texture = Some(handle);
}

/// Upload a dirty sub-rectangle to the persistent displacement texture.
/// `data` is a contiguous RGBA8 block of size `rw * rh * 4`.
#[wasm_bindgen(js_name = "liquifyUploadRegion")]
pub fn liquify_upload_region(
    engine: &mut Engine,
    data: &[u8],
    rx: i32,
    ry: i32,
    rw: u32,
    rh: u32,
) {
    let handle = match engine.inner.liquify_disp_texture {
        Some(h) => h,
        None => return,
    };
    let gl = &engine.inner.gl;
    let _ = engine.inner.texture_pool.upload_rgba(gl, handle, rx, ry, rw, rh, data);
}

/// Render the liquify warp: source = filter preview backup, displacement =
/// persistent displacement texture, output = layer texture.
#[wasm_bindgen(js_name = "liquifyRender")]
pub fn liquify_render(engine: &mut Engine, layer_id: &str, max_disp: f32) {
    let preview_handle = match engine.inner.filter_preview_texture {
        Some(h) => h,
        None => return,
    };
    let preview_tex = match engine.inner.texture_pool.get(preview_handle) {
        Some(t) => t.clone(),
        None => return,
    };

    let disp_handle = match engine.inner.liquify_disp_texture {
        Some(h) => h,
        None => return,
    };
    let disp_tex = match engine.inner.texture_pool.get(disp_handle) {
        Some(t) => t.clone(),
        None => return,
    };

    let _ = engine.inner.ensure_layer_full_size(layer_id);

    let layer_tex_handle = match engine.inner.layer_textures.get(layer_id) {
        Some(&h) => h,
        None => return,
    };
    let (w, h) = engine
        .inner
        .texture_pool
        .get_size(layer_tex_handle)
        .unwrap_or((1, 1));
    let layer_tex = match engine.inner.texture_pool.get(layer_tex_handle) {
        Some(t) => t.clone(),
        None => return,
    };

    let texel_w = 1.0 / w as f32;
    let texel_h = 1.0 / h as f32;

    engine.inner.gl.disable(WebGl2RenderingContext::BLEND);
    engine
        .inner
        .render_to_texture(&layer_tex, w as i32, h as i32, |eng| {
            let gl = &eng.gl;
            let shader = &eng.shaders.liquify_warp;
            gl.use_program(Some(&shader.program));

            gl.active_texture(WebGl2RenderingContext::TEXTURE0);
            gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&preview_tex));
            if let Some(loc) = shader.location(gl, "u_tex") {
                gl.uniform1i(Some(&loc), 0);
            }

            gl.active_texture(WebGl2RenderingContext::TEXTURE1);
            gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&disp_tex));
            if let Some(loc) = shader.location(gl, "u_disp") {
                gl.uniform1i(Some(&loc), 1);
            }

            if let Some(loc) = shader.location(gl, "u_maxDisp") {
                gl.uniform1f(Some(&loc), max_disp);
            }
            if let Some(loc) = shader.location(gl, "u_texelSize") {
                gl.uniform2f(Some(&loc), texel_w, texel_h);
            }

            eng.draw_fullscreen_quad();
        });

    engine.inner.mark_layer_dirty(layer_id);
}

/// Release the persistent displacement texture. Call when the session ends.
#[wasm_bindgen(js_name = "liquifyRelease")]
pub fn liquify_release(engine: &mut Engine) {
    if let Some(tex) = engine.inner.liquify_disp_texture.take() {
        engine.inner.texture_pool.release(tex);
    }
}
