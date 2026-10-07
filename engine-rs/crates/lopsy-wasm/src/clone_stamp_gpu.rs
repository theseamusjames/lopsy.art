use lopsy_core::dab_rect::dab_rect;
use web_sys::WebGl2RenderingContext;

use crate::dab_pass_gpu::scratch_dab_pass;
use crate::engine::EngineInner;

pub fn apply_clone_stamp_dab(
    engine: &mut EngineInner,
    layer_id: &str,
    dest_x: f64,
    dest_y: f64,
    source_offset_x: f64,
    source_offset_y: f64,
    size: f32,
) {
    apply_clone_stamp_dab_batch(
        engine,
        layer_id,
        &[dest_x, dest_y],
        source_offset_x,
        source_offset_y,
        size,
    );
}

pub fn apply_clone_stamp_dab_batch(
    engine: &mut EngineInner,
    layer_id: &str,
    points: &[f64],
    source_offset_x: f64,
    source_offset_y: f64,
    size: f32,
) {
    let tex_handle = match engine.layer_textures.get(layer_id) {
        Some(&h) => h,
        None => return,
    };
    let (w, h) = engine.texture_pool.get_size(tex_handle).unwrap_or((1, 1));
    let layer_tex = match engine.texture_pool.get(tex_handle) {
        Some(t) => t.clone(),
        None => return,
    };
    // Each dab renders at the layer's size and copies scratch back texel for
    // texel, so scratch must match the layer exactly (see ensure_scratch_size).
    if engine.ensure_scratch_size(w, h).is_err() {
        return;
    }

    for chunk in points.chunks_exact(2) {
        let (cx, cy) = (chunk[0] as f32, chunk[1] as f32);
        // The scissor bounds the destination only: the shader still reads the
        // source disc at `+ source_offset` from anywhere in the layer.
        let Some(rect) = dab_rect(cx, cy, size, w, h) else {
            continue;
        };
        scratch_dab_pass(engine, &layer_tex, w, h, rect, |engine| {
            let gl = &engine.gl;
            let shader = &engine.shaders.clone_stamp;
            gl.use_program(Some(&shader.program));
            gl.active_texture(WebGl2RenderingContext::TEXTURE0);
            gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&layer_tex));
            if let Some(loc) = shader.location(gl, "u_sourceTex") {
                gl.uniform1i(Some(&loc), 0);
            }
            if let Some(loc) = shader.location(gl, "u_center") {
                gl.uniform2f(Some(&loc), cx, cy);
            }
            if let Some(loc) = shader.location(gl, "u_size") {
                gl.uniform1f(Some(&loc), size);
            }
            if let Some(loc) = shader.location(gl, "u_texSize") {
                gl.uniform2f(Some(&loc), w as f32, h as f32);
            }
            if let Some(loc) = shader.location(gl, "u_sourceOffset") {
                gl.uniform2f(Some(&loc), source_offset_x as f32, source_offset_y as f32);
            }
            engine.draw_fullscreen_quad();
        });
    }

    engine.mark_layer_dirty(layer_id);
}
