use crate::engine::EngineInner;
use crate::gpu::pass::{Blend, Target};
use crate::gpu::texture_pool::TextureHandle;

/// Save the current layer content so render_shape can restore it before each
/// frame. Called once at the start of a shape drag.
pub fn save_shape_preview(engine: &mut EngineInner, layer_id: &str) {
    let _ = engine.ensure_layer_full_size(layer_id);

    let tex_handle = match engine.layer_textures.get(layer_id) {
        Some(&h) => h,
        None => return,
    };
    let (w, h) = engine.texture_pool.get_size(tex_handle).unwrap_or((1, 1));
    if engine.texture_pool.get(tex_handle).is_none() {
        return;
    }

    // Allocate (or reuse) the preview texture
    if let Some(old) = engine.shape_preview_texture.take() {
        engine.texture_pool.release(old);
    }
    let preview_handle = match engine.texture_pool.acquire(w, h) {
        Ok(h) => h,
        Err(_) => return,
    };
    if engine.texture_pool.get(preview_handle).is_none() {
        return;
    }

    copy_texture(engine, tex_handle, preview_handle, w, h);

    engine.shape_preview_texture = Some(preview_handle);
    engine.shape_preview_layer_id = Some(layer_id.to_string());
    engine.shape_preview_x = 0;
    engine.shape_preview_y = 0;
    engine.shape_preview_w = w;
    engine.shape_preview_h = h;
}

/// Release the preview texture. Called when the shape drag ends.
pub fn end_shape_preview(engine: &mut EngineInner) {
    if let Some(h) = engine.shape_preview_texture.take() {
        engine.texture_pool.release(h);
    }
    engine.shape_preview_layer_id = None;
}

pub fn render_shape(
    engine: &mut EngineInner,
    layer_id: &str,
    shape_type: u32,
    cx: f64,
    cy: f64,
    width: f64,
    height: f64,
    fill_r: f32,
    fill_g: f32,
    fill_b: f32,
    fill_a: f32,
    stroke_r: f32,
    stroke_g: f32,
    stroke_b: f32,
    stroke_a: f32,
    stroke_width: f32,
    sides: u32,
    corner_radius: f32,
) {
    let corner_radius = corner_radius.min((width as f32).min(height as f32) / 2.0);
    let _ = engine.ensure_layer_full_size(layer_id);

    let tex_handle = match engine.layer_textures.get(layer_id) {
        Some(&h) => h,
        None => return,
    };
    let (w, h) = engine.texture_pool.get_size(tex_handle).unwrap_or((1, 1));
    let (layer_x, layer_y) = engine.layer_stack.iter()
        .find(|l| l.id == layer_id)
        .map(|l| (l.x, l.y))
        .unwrap_or((0, 0));
    if engine.texture_pool.get(tex_handle).is_none() {
        return;
    }

    // The shape is composited in the shader against a copy of the layer's
    // prior content instead of with fixed-function blending: layer textures
    // hold straight alpha, and `ONE, ONE_MINUS_SRC_ALPHA` blending of a
    // coverage-weighted colour wrote premultiplied RGB into the anti-aliased
    // edge, which rendered as a dark fringe (#815). During a drag the saved
    // preview already is that copy, and sampling it also restores the layer
    // so each mousemove renders cleanly instead of accumulating.
    let preview = if engine.shape_preview_layer_id.as_deref() == Some(layer_id) {
        engine.shape_preview_texture.filter(|&p| engine.texture_pool.get(p).is_some())
    } else {
        None
    };
    let mut temp_handle = None;
    let dst = match preview {
        Some(p) => p,
        None => {
            let Ok(handle) = engine.texture_pool.acquire(w, h) else { return };
            if engine.texture_pool.get(handle).is_none() {
                engine.texture_pool.release(handle);
                return;
            }
            copy_texture(engine, tex_handle, handle, w, h);
            temp_handle = Some(handle);
            handle
        }
    };

    engine.pass_untyped(&engine.shaders.shape_fill)
        .texture("u_dstTex", dst)
        .i32("u_shapeType", shape_type as i32)
        // Convert center from document space to texture space
        .vec2("u_center", (cx as f32) - (layer_x as f32), (cy as f32) - (layer_y as f32))
        .vec2("u_size", width as f32, height as f32)
        .vec4("u_fillColor", fill_r, fill_g, fill_b, fill_a)
        .vec4("u_strokeColor", stroke_r, stroke_g, stroke_b, stroke_a)
        .f32("u_strokeWidth", stroke_width)
        .f32("u_cornerRadius", corner_radius)
        .i32("u_sides", sides as i32)
        .vec2("u_texSize", w as f32, h as f32)
        .blend(Blend::Off)
        .viewport(0, 0, w as i32, h as i32)
        .draw(Target::Texture(tex_handle));
    // The copy may be released below; don't leave it bound to a sampler.
    engine.gpu().unbind_textures(1);

    if let Some(handle) = temp_handle {
        engine.texture_pool.release(handle);
    }
    engine.mark_layer_dirty(layer_id);
}

fn copy_texture(engine: &EngineInner, src: TextureHandle, dst: TextureHandle, w: u32, h: u32) {
    engine.pass(&engine.shaders.blit, ())
        .texture("u_tex", src)
        .blend(Blend::Off)
        .viewport(0, 0, w as i32, h as i32)
        .draw(Target::Texture(dst));
}

/// One-shot shape render that expands the texture to cover the full shape.
/// Used by confirmShapeSize (modal path) where there's no preview/drag cycle.
pub fn render_shape_expanded(
    engine: &mut EngineInner,
    layer_id: &str,
    shape_type: u32,
    cx: f64,
    cy: f64,
    width: f64,
    height: f64,
    fill_r: f32,
    fill_g: f32,
    fill_b: f32,
    fill_a: f32,
    stroke_r: f32,
    stroke_g: f32,
    stroke_b: f32,
    stroke_a: f32,
    stroke_width: f32,
    sides: u32,
    corner_radius: f32,
) {
    let corner_radius = corner_radius.min((width as f32).min(height as f32) / 2.0);
    let half_w = (width / 2.0 + stroke_width as f64 + 1.0).ceil() as i32;
    let half_h = (height / 2.0 + stroke_width as f64 + 1.0).ceil() as i32;
    let _ = engine.ensure_layer_covers(
        layer_id,
        (cx as i32) - half_w,
        (cy as i32) - half_h,
        (cx as i32) + half_w,
        (cy as i32) + half_h,
    );

    // Delegate to the standard render (no preview active for one-shot)
    render_shape(
        engine, layer_id, shape_type, cx, cy, width, height,
        fill_r, fill_g, fill_b, fill_a,
        stroke_r, stroke_g, stroke_b, stroke_a,
        stroke_width, sides, corner_radius,
    );
}
