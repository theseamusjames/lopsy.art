use web_sys::{WebGl2RenderingContext, WebGlProgram};
use crate::engine::EngineInner;

/// Blend the filtered result with the original layer texture
/// using the selection mask. Writes the blended result back to the layer texture.
fn blend_with_selection_mask(
    engine: &mut EngineInner,
    layer_id: &str,
    filtered_scratch: crate::gpu::texture_pool::TextureHandle,
    original_scratch: crate::gpu::texture_pool::TextureHandle,
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
    let sel_handle = match engine.selection_mask_texture {
        Some(h) => h,
        None => return,
    };
    let sel_tex = match engine.texture_pool.get(sel_handle) {
        Some(t) => t.clone(),
        None => return,
    };

    let gl = &engine.gl;
    let program = &engine.shaders.selection_mask_blend.program;

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

    gl.use_program(Some(program));

    // TEXTURE0: filtered result
    gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    if let Some(filtered_tex) = engine.texture_pool.get(filtered_scratch) {
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(filtered_tex));
    }
    if let Some(loc) = gl.get_uniform_location(program, "u_filtered") {
        gl.uniform1i(Some(&loc), 0);
    }

    // TEXTURE1: original layer backup
    gl.active_texture(WebGl2RenderingContext::TEXTURE1);
    if let Some(original_tex) = engine.texture_pool.get(original_scratch) {
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(original_tex));
    }
    if let Some(loc) = gl.get_uniform_location(program, "u_original") {
        gl.uniform1i(Some(&loc), 1);
    }

    // TEXTURE2: selection mask
    gl.active_texture(WebGl2RenderingContext::TEXTURE2);
    gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&sel_tex));
    if let Some(loc) = gl.get_uniform_location(program, "u_selMask") {
        gl.uniform1i(Some(&loc), 2);
    }

    engine.draw_fullscreen_quad();

    gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, None);
    gl.delete_framebuffer(temp_fbo.as_ref());
}

/// Copy the layer texture into a scratch buffer using a simple blit.
fn copy_layer_to_scratch(
    engine: &mut EngineInner,
    layer_id: &str,
    scratch_fbo: crate::gpu::framebuffer::FramebufferHandle,
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

    let gl = &engine.gl;
    engine.fbo_pool.bind(gl, scratch_fbo);
    gl.viewport(0, 0, w as i32, h as i32);
    gl.use_program(Some(&engine.shaders.blit.program));
    gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&layer_tex));
    if let Some(loc) = gl.get_uniform_location(&engine.shaders.blit.program, "u_tex") {
        gl.uniform1i(Some(&loc), 0);
    }
    engine.draw_fullscreen_quad();
}

/// Apply a shader program to a layer's texture (read from layer, render to scratch, copy back).
/// The `set_uniforms` closure is called after the shader is bound so you can set custom uniforms.
pub fn apply_filter(
    engine: &mut EngineInner,
    layer_id: &str,
    program: &WebGlProgram,
    set_uniforms: impl FnOnce(&WebGl2RenderingContext, &WebGlProgram),
) {
    let has_selection = engine.selection_mask_texture.is_some();

    // If there's a selection, save the original layer to scratch B first
    if has_selection {
        let scratch_fbo_b = engine.scratch_fbo_b;
        copy_layer_to_scratch(engine, layer_id, scratch_fbo_b);
    }

    let tex_handle = match engine.layer_textures.get(layer_id) {
        Some(&h) => h,
        None => return,
    };
    let (w, h) = engine.texture_pool.get_size(tex_handle).unwrap_or((1, 1));
    let layer_tex = match engine.texture_pool.get(tex_handle) {
        Some(t) => t.clone(),
        None => return,
    };

    let gl = &engine.gl;

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

    if has_selection {
        // Blend filtered (scratch A) with original (scratch B) using selection mask → layer
        let scratch_a = engine.scratch_texture_a;
        let scratch_b = engine.scratch_texture_b;
        blend_with_selection_mask(engine, layer_id, scratch_a, scratch_b);
    } else {
        // Copy result back to layer texture (original path)
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

        gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, None);
        gl.delete_framebuffer(temp_fbo.as_ref());
    }

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
    let has_selection = engine.selection_mask_texture.is_some();

    let tex_handle = match engine.layer_textures.get(layer_id) {
        Some(&h) => h,
        None => return,
    };
    let (w, h) = engine.texture_pool.get_size(tex_handle).unwrap_or((1, 1));
    let layer_tex = match engine.texture_pool.get(tex_handle) {
        Some(t) => t.clone(),
        None => return,
    };

    let gl = &engine.gl;

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

    if has_selection {
        // Save the original layer to scratch A (layer still untouched).
        // We need to drop the `gl` borrow before calling copy_layer_to_scratch,
        // so we capture the needed values first.
        let scratch_fbo_a = engine.scratch_fbo_a;
        copy_layer_to_scratch(engine, layer_id, scratch_fbo_a);
        // Blend: filtered (scratch B) with original (scratch A) using selection mask → layer
        let scratch_b = engine.scratch_texture_b;
        let scratch_a = engine.scratch_texture_a;
        blend_with_selection_mask(engine, layer_id, scratch_b, scratch_a);
    } else {
        // Copy scratch B back to layer texture (original path)
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
    }

    engine.mark_layer_dirty(layer_id);
}
