//! Filter preview texture: save/restore/clear the pre-filter layer state
//! so interactive filter dialogs can preview without destroying the
//! original pixels until the user clicks Apply.


use crate::gpu::pass::{Blend, Target};
use crate::engine::EngineInner;

pub fn save_filter_preview(engine: &mut EngineInner, layer_id: &str) {
    let inner = &mut *engine;
    let _ = inner.ensure_layer_full_size(layer_id);

    let tex_handle = match inner.layer_textures.get(layer_id) {
        Some(&h) => h,
        None => return,
    };
    let (w, h) = inner.texture_pool.get_size(tex_handle).unwrap_or((1, 1));
    if inner.texture_pool.get(tex_handle).is_none() {
        return;
    }

    if let Some(old) = inner.previews.filter_texture.take() {
        inner.texture_pool.release(old);
    }
    let preview_handle = match inner.texture_pool.acquire(w, h) {
        Ok(h) => h,
        Err(_) => return,
    };
    if inner.texture_pool.get(preview_handle).is_none() {
        return;
    }

    inner.pass(&inner.shaders.blit, ())
        .texture("u_tex", tex_handle)
        .blend(Blend::Off)
        .draw(Target::Texture(preview_handle));

    inner.previews.filter_texture = Some(preview_handle);
    inner.previews.filter_layer_id = Some(layer_id.to_string());
}

pub fn restore_filter_preview(engine: &mut EngineInner) {
    let inner = &mut *engine;
    let preview_handle = match inner.previews.filter_texture {
        Some(h) => h,
        None => return,
    };
    let layer_id = match &inner.previews.filter_layer_id {
        Some(id) => id.clone(),
        None => return,
    };
    let layer_tex_handle = match inner.layer_textures.get(&layer_id) {
        Some(&h) => h,
        None => return,
    };
    let (w, h) = inner.texture_pool.get_size(layer_tex_handle).unwrap_or((1, 1));
    if inner.texture_pool.get(layer_tex_handle).is_none()
        || inner.texture_pool.get(preview_handle).is_none()
    {
        return;
    }

    inner.pass(&inner.shaders.blit, ())
        .texture("u_tex", preview_handle)
        .blend(Blend::Off)
        .viewport(0, 0, w as i32, h as i32)
        .draw(Target::Texture(layer_tex_handle));

    inner.mark_layer_dirty(&layer_id);
}

pub fn clear_filter_preview(engine: &mut EngineInner) {
    if let Some(tex) = engine.previews.filter_texture.take() {
        engine.texture_pool.release(tex);
    }
    engine.previews.filter_layer_id = None;
}
