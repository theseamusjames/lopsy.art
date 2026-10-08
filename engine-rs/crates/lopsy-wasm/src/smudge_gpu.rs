use lopsy_core::dab_rect::dab_rect;
use web_sys::WebGl2RenderingContext;

use crate::dab_pass_gpu::scratch_dab_pass;
use crate::engine::EngineInner;

pub fn apply_smudge_dab(
    engine: &mut EngineInner,
    layer_id: &str,
    cx: f64,
    cy: f64,
    prev_x: f64,
    prev_y: f64,
    size: f32,
    strength: f32,
) {
    apply_smudge_dab_batch(engine, layer_id, &[prev_x, prev_y, cx, cy], size, strength);
}

/// Apply a chain of smudge dabs. `points` is a flat array
/// `[p0.x, p0.y, p1.x, p1.y, ...]` where p0 is the starting "previous" point
/// and each subsequent pair becomes a dab whose `prev` is the pair before it.
pub fn apply_smudge_dab_batch(
    engine: &mut EngineInner,
    layer_id: &str,
    points: &[f64],
    size: f32,
    strength: f32,
) {
    if points.len() < 4 {
        return;
    }
    // Smudge is not a registry paint tool, so no pointer-down `beginStroke`
    // grows the layer for it. A no-op once the layer covers the document
    // (it never reallocates per move), and it also sizes scratch to the
    // layer, which each dab's copy-back needs.
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
    if engine.ensure_scratch_size(w, h).is_err() {
        return;
    }

    for pair in points.windows(4).step_by(2) {
        let (prev_x, prev_y) = (pair[0] as f32, pair[1] as f32);
        let (cx, cy) = (pair[2] as f32, pair[3] as f32);
        // Only texels within the radius of the new centre change; the shader
        // reads the dragged pixels from `- (center - prev)` anywhere in the layer.
        let Some(rect) = dab_rect(cx, cy, size, w, h) else {
            continue;
        };
        scratch_dab_pass(engine, &layer_tex, w, h, rect, |engine| {
            let gl = &engine.gl;
            let shader = &engine.shaders.smudge_dab;
            gl.use_program(Some(&shader.program));
            gl.active_texture(WebGl2RenderingContext::TEXTURE0);
            gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&layer_tex));
            if let Some(loc) = shader.location(gl, "u_sourceTex") {
                gl.uniform1i(Some(&loc), 0);
            }
            if let Some(loc) = shader.location(gl, "u_center") {
                gl.uniform2f(Some(&loc), cx, cy);
            }
            if let Some(loc) = shader.location(gl, "u_prev") {
                gl.uniform2f(Some(&loc), prev_x, prev_y);
            }
            if let Some(loc) = shader.location(gl, "u_size") {
                gl.uniform1f(Some(&loc), size);
            }
            if let Some(loc) = shader.location(gl, "u_strength") {
                gl.uniform1f(Some(&loc), strength);
            }
            if let Some(loc) = shader.location(gl, "u_texSize") {
                gl.uniform2f(Some(&loc), w as f32, h as f32);
            }
            engine.draw_fullscreen_quad();
        });
    }

    engine.mark_layer_dirty(layer_id);
}
