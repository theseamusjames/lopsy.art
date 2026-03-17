use web_sys::{WebGl2RenderingContext, WebGlProgram};
use crate::engine::EngineInner;

/// Apply a shader program to a layer's texture (read from layer, render to scratch, copy back).
/// The `set_uniforms` closure is called after the shader is bound so you can set custom uniforms.
pub fn apply_filter(
    engine: &mut EngineInner,
    layer_id: &str,
    program: &WebGlProgram,
    set_uniforms: impl FnOnce(&WebGl2RenderingContext, &WebGlProgram),
) {
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

    // Bind scratch FBO A
    engine.fbo_pool.bind(gl, engine.scratch_fbo_a);
    gl.viewport(0, 0, w as i32, h as i32);

    // Use the filter shader
    gl.use_program(Some(program));

    // Bind layer texture to unit 0
    gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&layer_tex));
    if let Some(loc) = gl.get_uniform_location(program, "u_tex") {
        gl.uniform1i(Some(&loc), 0);
    }

    // Let caller set additional uniforms
    set_uniforms(gl, program);

    // Draw fullscreen quad
    engine.draw_fullscreen_quad();

    // Copy result back to layer texture
    engine.fbo_pool.bind(gl, engine.composite_fbo);
    // Actually, we need to blit scratch A -> layer texture
    // Create temp FBO for the layer texture
    let temp_fbo = gl.create_framebuffer();
    gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, temp_fbo.as_ref());
    gl.framebuffer_texture_2d(
        WebGl2RenderingContext::FRAMEBUFFER,
        WebGl2RenderingContext::COLOR_ATTACHMENT0,
        WebGl2RenderingContext::TEXTURE_2D,
        Some(&layer_tex),
        0,
    );
    gl.viewport(0, 0, w as i32, h as i32);

    gl.use_program(Some(&engine.shaders.blit.program));
    gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    if let Some(scratch_tex) = engine.texture_pool.get(engine.scratch_texture_a) {
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(scratch_tex));
    }
    if let Some(loc) = gl.get_uniform_location(&engine.shaders.blit.program, "u_tex") {
        gl.uniform1i(Some(&loc), 0);
    }
    engine.draw_fullscreen_quad();

    // Cleanup temp FBO
    gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, None);
    gl.delete_framebuffer(temp_fbo.as_ref());

    engine.mark_layer_dirty(layer_id);
}

/// Two-pass separable blur (horizontal then vertical).
/// Used for both Gaussian and box blur.
pub fn apply_separable_blur(
    engine: &mut EngineInner,
    layer_id: &str,
    program: &WebGlProgram,
    set_common_uniforms: impl Fn(&WebGl2RenderingContext, &WebGlProgram),
) {
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

    gl.use_program(Some(program));

    // Pass 1: horizontal (layer -> scratch A)
    engine.fbo_pool.bind(gl, engine.scratch_fbo_a);
    gl.viewport(0, 0, w as i32, h as i32);
    gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&layer_tex));
    if let Some(loc) = gl.get_uniform_location(program, "u_tex") {
        gl.uniform1i(Some(&loc), 0);
    }
    if let Some(loc) = gl.get_uniform_location(program, "u_direction") {
        gl.uniform2f(Some(&loc), 1.0, 0.0);
    }
    set_common_uniforms(gl, program);
    engine.draw_fullscreen_quad();

    // Pass 2: vertical (scratch A -> scratch B)
    engine.fbo_pool.bind(gl, engine.scratch_fbo_b);
    gl.viewport(0, 0, w as i32, h as i32);
    gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    if let Some(scratch_tex_a) = engine.texture_pool.get(engine.scratch_texture_a) {
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(scratch_tex_a));
    }
    if let Some(loc) = gl.get_uniform_location(program, "u_tex") {
        gl.uniform1i(Some(&loc), 0);
    }
    if let Some(loc) = gl.get_uniform_location(program, "u_direction") {
        gl.uniform2f(Some(&loc), 0.0, 1.0);
    }
    set_common_uniforms(gl, program);
    engine.draw_fullscreen_quad();

    // Copy scratch B back to layer texture
    let temp_fbo = gl.create_framebuffer();
    gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, temp_fbo.as_ref());
    gl.framebuffer_texture_2d(
        WebGl2RenderingContext::FRAMEBUFFER,
        WebGl2RenderingContext::COLOR_ATTACHMENT0,
        WebGl2RenderingContext::TEXTURE_2D,
        Some(&layer_tex),
        0,
    );
    gl.viewport(0, 0, w as i32, h as i32);

    gl.use_program(Some(&engine.shaders.blit.program));
    gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    if let Some(scratch_tex_b) = engine.texture_pool.get(engine.scratch_texture_b) {
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(scratch_tex_b));
    }
    if let Some(loc) = gl.get_uniform_location(&engine.shaders.blit.program, "u_tex") {
        gl.uniform1i(Some(&loc), 0);
    }
    engine.draw_fullscreen_quad();

    gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, None);
    gl.delete_framebuffer(temp_fbo.as_ref());

    engine.mark_layer_dirty(layer_id);
}
