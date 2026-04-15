use web_sys::WebGl2RenderingContext;
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
    apply_smudge_dab_batch(
        engine,
        layer_id,
        &[prev_x, prev_y, cx, cy],
        size,
        strength,
    );
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
    let gl = &engine.gl;
    let tex_handle = match engine.layer_textures.get(layer_id) {
        Some(&h) => h,
        None => return,
    };
    let (w, h) = engine.texture_pool.get_size(tex_handle).unwrap_or((1, 1));
    let layer_tex = match engine.texture_pool.get(tex_handle) {
        Some(t) => t.clone(),
        None => return,
    };

    let prog = &engine.shaders.smudge_dab.program;

    let mut prev_x = points[0];
    let mut prev_y = points[1];

    let mut i = 2;
    while i + 1 < points.len() {
        let cx = points[i];
        let cy = points[i + 1];

        engine.fbo_pool.bind(gl, engine.scratch_fbo_a);
        gl.viewport(0, 0, w as i32, h as i32);

        gl.use_program(Some(prog));
        gl.active_texture(WebGl2RenderingContext::TEXTURE0);
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&layer_tex));
        if let Some(loc) = gl.get_uniform_location(prog, "u_sourceTex") {
            gl.uniform1i(Some(&loc), 0);
        }
        if let Some(loc) = gl.get_uniform_location(prog, "u_center") {
            gl.uniform2f(Some(&loc), cx as f32, cy as f32);
        }
        if let Some(loc) = gl.get_uniform_location(prog, "u_prev") {
            gl.uniform2f(Some(&loc), prev_x as f32, prev_y as f32);
        }
        if let Some(loc) = gl.get_uniform_location(prog, "u_size") {
            gl.uniform1f(Some(&loc), size);
        }
        if let Some(loc) = gl.get_uniform_location(prog, "u_strength") {
            gl.uniform1f(Some(&loc), strength);
        }
        if let Some(loc) = gl.get_uniform_location(prog, "u_texSize") {
            gl.uniform2f(Some(&loc), w as f32, h as f32);
        }

        engine.draw_fullscreen_quad();

        // Copy scratch A back to layer so subsequent dabs see the updated pixels
        let temp_fbo = gl.create_framebuffer();
        gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, temp_fbo.as_ref());
        gl.framebuffer_texture_2d(
            WebGl2RenderingContext::FRAMEBUFFER,
            WebGl2RenderingContext::COLOR_ATTACHMENT0,
            WebGl2RenderingContext::TEXTURE_2D,
            Some(&layer_tex),
            0,
        );
        gl.use_program(Some(&engine.shaders.blit.program));
        gl.active_texture(WebGl2RenderingContext::TEXTURE0);
        if let Some(scratch) = engine.texture_pool.get(engine.scratch_texture_a) {
            gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(scratch));
        }
        if let Some(loc) = gl.get_uniform_location(&engine.shaders.blit.program, "u_tex") {
            gl.uniform1i(Some(&loc), 0);
        }
        engine.draw_fullscreen_quad();

        gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, None);
        gl.delete_framebuffer(temp_fbo.as_ref());

        prev_x = cx;
        prev_y = cy;
        i += 2;
    }

    engine.mark_layer_dirty(layer_id);
}
