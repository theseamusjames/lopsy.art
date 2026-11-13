//! Distortion filters: mesh warp, liquify warp.

use wasm_bindgen::prelude::*;

use crate::Engine;
use crate::filter_gpu;
use crate::gpu::pass::{Blend, Target};

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

    let grid_handle = match engine.inner.texture_pool.acquire(grid_width, grid_height) {
        Ok(h) => h,
        Err(_) => return,
    };
    let _ = engine.inner.texture_pool.upload_rgba(grid_handle, 0, 0, grid_width, grid_height, grid_data,
    );

    // The shader reads grid points with texelFetch and interpolates the
    // decoded 16-bit offsets itself: hardware filtering would blend the high
    // and low bytes separately at the texture's own precision (#1160).
    let is_grid_live = engine.inner.texture_pool.get(grid_handle).is_some();

    let gw = grid_width as f32;
    let gh = grid_height as f32;

    filter_gpu::apply_filter_untyped(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.mesh_warp,
        |pass| {
            let pass = if is_grid_live {
                pass.texture("u_grid", grid_handle)
            } else {
                pass.i32("u_grid", 1)
            };
            pass
                .vec2("u_gridSize", gw, gh)
                .vec2("u_boundsMin", bounds_min_u, bounds_min_v)
                .vec2("u_boundsMax", bounds_max_u, bounds_max_v)
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
    if let Some(old) = engine.inner.liquify_disp_texture.take() {
        engine.inner.texture_pool.release(old);
    }
    let handle = match engine.inner.texture_pool.acquire(width, height) {
        Ok(h) => h,
        Err(_) => return,
    };
    let _ = engine.inner.texture_pool.upload_rgba(handle, 0, 0, width, height, data);

    // NEAREST — displacement is per-pixel.
    engine.inner.texture_pool.set_nearest_filter(handle);
    engine.inner.texture_pool.set_clamp_wrap(handle);
    engine.inner.liquify_disp_texture = Some(handle);
}

/// Render the liquify warp: source = filter preview backup, displacement =
/// persistent displacement texture, output = layer texture.
#[wasm_bindgen(js_name = "liquifyRender")]
pub fn liquify_render(engine: &mut Engine, layer_id: &str, max_disp: f32) {
    let preview_handle = match engine.inner.filter_preview_texture {
        Some(h) => h,
        None => return,
    };
    if engine.inner.texture_pool.get(preview_handle).is_none() {
        return;
    }

    let disp_handle = match engine.inner.liquify_disp_texture {
        Some(h) => h,
        None => return,
    };
    if engine.inner.texture_pool.get(disp_handle).is_none() {
        return;
    }

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
    if engine.inner.texture_pool.get(layer_tex_handle).is_none() {
        return;
    }

    let texel_w = 1.0 / w as f32;
    let texel_h = 1.0 / h as f32;

    let inner = &engine.inner;
    inner.pass_untyped(&inner.shaders.liquify_warp)
        .texture("u_tex", preview_handle)
        .texture("u_disp", disp_handle)
        .f32("u_maxDisp", max_disp)
        .vec2("u_texelSize", texel_w, texel_h)
        .blend(Blend::Off)
        .viewport(0, 0, w as i32, h as i32)
        .draw(Target::Texture(layer_tex_handle));

    engine.inner.mark_layer_dirty(layer_id);
}

/// Release the persistent displacement texture. Call when the session ends.
#[wasm_bindgen(js_name = "liquifyRelease")]
pub fn liquify_release(engine: &mut Engine) {
    if let Some(tex) = engine.inner.liquify_disp_texture.take() {
        engine.inner.texture_pool.release(tex);
    }
}

#[wasm_bindgen(js_name = "liquifyApplyDabGpu")]
pub fn liquify_apply_dab_gpu(
    engine: &mut Engine,
    cx: f32,
    cy: f32,
    radius: f32,
    pressure: f32,
    drag_dx: f32,
    drag_dy: f32,
    mode: u32,
) {
    let disp_handle = match engine.inner.liquify_disp_texture {
        Some(h) => h,
        None => return,
    };
    let (w, h) = engine.inner.texture_pool.get_size(disp_handle).unwrap_or((0, 0));
    if w == 0 || h == 0 { return; }

    if engine.inner.texture_pool.get(disp_handle).is_none() {
        return;
    }

    let scratch = match engine.inner.texture_pool.acquire(w, h) {
        Ok(s) => s,
        Err(_) => return,
    };
    if engine.inner.texture_pool.get(scratch).is_none() {
        engine.inner.texture_pool.release(scratch);
        return;
    }

    // Read the displacement field, write the dabbed field into a fresh
    // texture, and make that the new field.
    let inner = &engine.inner;
    inner.pass_untyped(&inner.shaders.liquify_dab)
        .texture("u_disp", disp_handle)
        .vec2("u_center", cx, cy)
        .f32("u_radius", radius)
        .f32("u_pressure", pressure)
        .vec2("u_drag", drag_dx, drag_dy)
        .i32("u_mode", mode as i32)
        .vec2("u_size", w as f32, h as f32)
        .viewport(0, 0, w as i32, h as i32)
        .draw(Target::Texture(scratch));

    engine.inner.texture_pool.release(disp_handle);
    engine.inner.liquify_disp_texture = Some(scratch);
}
