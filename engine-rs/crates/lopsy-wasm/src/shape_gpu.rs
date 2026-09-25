use web_sys::WebGl2RenderingContext;
use crate::engine::EngineInner;

/// Save the current layer content so render_shape can restore it before each
/// frame. Called once at the start of a shape drag.
pub fn save_shape_preview(engine: &mut EngineInner, layer_id: &str) {
    let _ = engine.ensure_layer_full_size(layer_id);

    let tex_handle = match engine.layer_textures.get(layer_id) {
        Some(&h) => h,
        None => return,
    };
    let (w, h) = engine.texture_pool.get_size(tex_handle).unwrap_or((1, 1));
    let layer_tex = match engine.texture_pool.get(tex_handle) {
        Some(t) => t.clone(),
        None => return,
    };

    // Allocate (or reuse) the preview texture
    if let Some(old) = engine.shape_preview_texture.take() {
        engine.texture_pool.release(old);
    }
    let preview_handle = match engine.texture_pool.acquire(&engine.gl, w, h) {
        Ok(h) => h,
        Err(_) => return,
    };
    let preview_tex = match engine.texture_pool.get(preview_handle) {
        Some(t) => t.clone(),
        None => return,
    };

    copy_texture(engine, &layer_tex, &preview_tex, w, h);

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
    let layer_tex = match engine.texture_pool.get(tex_handle) {
        Some(t) => t.clone(),
        None => return,
    };

    // The shape is composited in the shader against a copy of the layer's
    // prior content instead of with fixed-function blending: layer textures
    // hold straight alpha, and `ONE, ONE_MINUS_SRC_ALPHA` blending of a
    // coverage-weighted colour wrote premultiplied RGB into the anti-aliased
    // edge, which rendered as a dark fringe (#815). During a drag the saved
    // preview already is that copy, and sampling it also restores the layer
    // so each mousemove renders cleanly instead of accumulating.
    let preview_tex = if engine.shape_preview_layer_id.as_deref() == Some(layer_id) {
        engine.shape_preview_texture.and_then(|h| engine.texture_pool.get(h).cloned())
    } else {
        None
    };
    let mut temp_handle = None;
    let dst_tex = match preview_tex {
        Some(t) => t,
        None => {
            let Ok(handle) = engine.texture_pool.acquire(&engine.gl, w, h) else { return };
            let Some(t) = engine.texture_pool.get(handle).cloned() else {
                engine.texture_pool.release(handle);
                return;
            };
            copy_texture(engine, &layer_tex, &t, w, h);
            temp_handle = Some(handle);
            t
        }
    };

    // Convert center from document space to texture space
    engine.gl.disable(WebGl2RenderingContext::BLEND);
    engine.render_to_texture(&layer_tex, w as i32, h as i32, |engine| {
        let gl = &engine.gl;
        let shader = &engine.shaders.shape_fill;
        gl.use_program(Some(&shader.program));

        gl.active_texture(WebGl2RenderingContext::TEXTURE1);
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&dst_tex));
        if let Some(loc) = shader.location(gl, "u_dstTex") {
            gl.uniform1i(Some(&loc), 1);
        }
        gl.active_texture(WebGl2RenderingContext::TEXTURE0);

        if let Some(loc) = shader.location(gl, "u_shapeType") {
            gl.uniform1i(Some(&loc), shape_type as i32);
        }
        if let Some(loc) = shader.location(gl, "u_center") {
            gl.uniform2f(Some(&loc), (cx as f32) - (layer_x as f32), (cy as f32) - (layer_y as f32));
        }
        if let Some(loc) = shader.location(gl, "u_size") {
            gl.uniform2f(Some(&loc), width as f32, height as f32);
        }
        if let Some(loc) = shader.location(gl, "u_fillColor") {
            gl.uniform4f(Some(&loc), fill_r, fill_g, fill_b, fill_a);
        }
        if let Some(loc) = shader.location(gl, "u_strokeColor") {
            gl.uniform4f(Some(&loc), stroke_r, stroke_g, stroke_b, stroke_a);
        }
        if let Some(loc) = shader.location(gl, "u_strokeWidth") {
            gl.uniform1f(Some(&loc), stroke_width);
        }
        if let Some(loc) = shader.location(gl, "u_cornerRadius") {
            gl.uniform1f(Some(&loc), corner_radius);
        }
        if let Some(loc) = shader.location(gl, "u_sides") {
            gl.uniform1i(Some(&loc), sides as i32);
        }
        if let Some(loc) = shader.location(gl, "u_texSize") {
            gl.uniform2f(Some(&loc), w as f32, h as f32);
        }

        engine.draw_fullscreen_quad();
    });

    engine.gl.active_texture(WebGl2RenderingContext::TEXTURE1);
    engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, None);
    engine.gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    if let Some(handle) = temp_handle {
        engine.texture_pool.release(handle);
    }
    engine.mark_layer_dirty(layer_id);
}

fn copy_texture(
    engine: &EngineInner,
    src: &web_sys::WebGlTexture,
    dst: &web_sys::WebGlTexture,
    w: u32,
    h: u32,
) {
    engine.gl.disable(WebGl2RenderingContext::BLEND);
    engine.render_to_texture(dst, w as i32, h as i32, |engine| {
        let gl = &engine.gl;
        gl.use_program(Some(&engine.shaders.blit.program));
        gl.active_texture(WebGl2RenderingContext::TEXTURE0);
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(src));
        if let Some(loc) = engine.shaders.blit.location(gl, "u_tex") {
            gl.uniform1i(Some(&loc), 0);
        }
        engine.draw_fullscreen_quad();
    });
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
