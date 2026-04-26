//! Distortion filters: mesh warp.

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
