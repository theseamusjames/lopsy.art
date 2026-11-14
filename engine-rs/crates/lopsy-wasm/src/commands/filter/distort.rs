//! Distortion filters: mesh warp, liquify warp.


use crate::engine::EngineInner;
use crate::filter_gpu;
use crate::gpu::pass::{Blend, Target};
use crate::gpu::params::filters::{LiquifyDabParams, LiquifyWarpParams, MeshWarpParams};

pub fn filter_mesh_warp(
    engine: &mut EngineInner,
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

    let grid_handle = match engine.texture_pool.acquire(grid_width, grid_height) {
        Ok(h) => h,
        Err(_) => return,
    };
    let _ = engine.texture_pool.upload_rgba(grid_handle, 0, 0, grid_width, grid_height, grid_data,
    );

    // The shader reads grid points with texelFetch and interpolates the
    // decoded 16-bit offsets itself: hardware filtering would blend the high
    // and low bytes separately at the texture's own precision (#1160).
    let is_grid_live = engine.texture_pool.get(grid_handle).is_some();

    let gw = grid_width as f32;
    let gh = grid_height as f32;

    filter_gpu::apply_filter_with_texture(
        &mut *engine,
        layer_id,
        |e| &e.shaders.mesh_warp,
        MeshWarpParams {
            grid_size: [gw, gh],
            bounds_min: [bounds_min_u, bounds_min_v],
            bounds_max: [bounds_max_u, bounds_max_v],
        },
        "u_grid",
        is_grid_live.then_some(grid_handle),
    );

    engine.texture_pool.release(grid_handle);
}

/// Allocate a persistent displacement texture and upload the initial
/// (zeroed) RGBA8 data. Call once when the Liquify session opens.
pub fn liquify_init_displacement(
    engine: &mut EngineInner,
    data: &[u8],
    width: u32,
    height: u32,
) {
    if data.is_empty() || width == 0 || height == 0 {
        return;
    }
    if let Some(old) = engine.liquify_disp_texture.take() {
        engine.texture_pool.release(old);
    }
    let handle = match engine.texture_pool.acquire(width, height) {
        Ok(h) => h,
        Err(_) => return,
    };
    let _ = engine.texture_pool.upload_rgba(handle, 0, 0, width, height, data);

    // NEAREST — displacement is per-pixel.
    engine.texture_pool.set_nearest_filter(handle);
    engine.texture_pool.set_clamp_wrap(handle);
    engine.liquify_disp_texture = Some(handle);
}

/// Render the liquify warp: source = filter preview backup, displacement =
/// persistent displacement texture, output = layer texture.
pub fn liquify_render(engine: &mut EngineInner, layer_id: &str, max_disp: f32) {
    let preview_handle = match engine.filter_preview_texture {
        Some(h) => h,
        None => return,
    };
    if engine.texture_pool.get(preview_handle).is_none() {
        return;
    }

    let disp_handle = match engine.liquify_disp_texture {
        Some(h) => h,
        None => return,
    };
    if engine.texture_pool.get(disp_handle).is_none() {
        return;
    }

    let _ = engine.ensure_layer_full_size(layer_id);

    let layer_tex_handle = match engine.layer_textures.get(layer_id) {
        Some(&h) => h,
        None => return,
    };
    let (w, h) = engine
        .texture_pool
        .get_size(layer_tex_handle)
        .unwrap_or((1, 1));
    if engine.texture_pool.get(layer_tex_handle).is_none() {
        return;
    }

    let texel_w = 1.0 / w as f32;
    let texel_h = 1.0 / h as f32;

    let inner = &*engine;
    inner.pass(&inner.shaders.liquify_warp, LiquifyWarpParams { max_disp, texel_size: [texel_w, texel_h] })
        .texture("u_tex", preview_handle)
        .texture("u_disp", disp_handle)
        .blend(Blend::Off)
        .viewport(0, 0, w as i32, h as i32)
        .draw(Target::Texture(layer_tex_handle));

    engine.mark_layer_dirty(layer_id);
}

/// Release the persistent displacement texture. Call when the session ends.
pub fn liquify_release(engine: &mut EngineInner) {
    if let Some(tex) = engine.liquify_disp_texture.take() {
        engine.texture_pool.release(tex);
    }
}

pub fn liquify_apply_dab_gpu(
    engine: &mut EngineInner,
    cx: f32,
    cy: f32,
    radius: f32,
    pressure: f32,
    drag_dx: f32,
    drag_dy: f32,
    mode: u32,
) {
    let disp_handle = match engine.liquify_disp_texture {
        Some(h) => h,
        None => return,
    };
    let (w, h) = engine.texture_pool.get_size(disp_handle).unwrap_or((0, 0));
    if w == 0 || h == 0 { return; }

    if engine.texture_pool.get(disp_handle).is_none() {
        return;
    }

    let scratch = match engine.texture_pool.acquire(w, h) {
        Ok(s) => s,
        Err(_) => return,
    };
    if engine.texture_pool.get(scratch).is_none() {
        engine.texture_pool.release(scratch);
        return;
    }

    // Read the displacement field, write the dabbed field into a fresh
    // texture, and make that the new field.
    let inner = &*engine;
    inner.pass(&inner.shaders.liquify_dab, LiquifyDabParams {
        center: [cx, cy],
        radius,
        pressure,
        drag: [drag_dx, drag_dy],
        mode: mode as i32,
        size: [w as f32, h as f32],
    })
        .texture("u_disp", disp_handle)
        .viewport(0, 0, w as i32, h as i32)
        .draw(Target::Texture(scratch));

    engine.texture_pool.release(disp_handle);
    engine.liquify_disp_texture = Some(scratch);
}
