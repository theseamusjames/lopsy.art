use web_sys::WebGl2RenderingContext;
use crate::engine::EngineInner;
use crate::gpu::shader::ShaderProgram;

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

    let filtered_tex = engine.texture_pool.get(filtered_scratch).cloned();
    let original_tex = engine.texture_pool.get(original_scratch).cloned();

    engine.render_to_texture(&layer_tex, w as i32, h as i32, |engine| {
        let gl = &engine.gl;
        let shader = &engine.shaders.selection_mask_blend;
        gl.use_program(Some(&shader.program));

        // TEXTURE0: filtered result
        gl.active_texture(WebGl2RenderingContext::TEXTURE0);
        if let Some(t) = &filtered_tex {
            gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(t));
        }
        if let Some(loc) = shader.location(gl, "u_filtered") {
            gl.uniform1i(Some(&loc), 0);
        }

        // TEXTURE1: original layer backup
        gl.active_texture(WebGl2RenderingContext::TEXTURE1);
        if let Some(t) = &original_tex {
            gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(t));
        }
        if let Some(loc) = shader.location(gl, "u_original") {
            gl.uniform1i(Some(&loc), 1);
        }

        // TEXTURE2: selection mask
        gl.active_texture(WebGl2RenderingContext::TEXTURE2);
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&sel_tex));
        if let Some(loc) = shader.location(gl, "u_selMask") {
            gl.uniform1i(Some(&loc), 2);
        }

        engine.draw_fullscreen_quad();
    });
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
    if let Some(loc) = engine.shaders.blit.location(gl, "u_tex") {
        gl.uniform1i(Some(&loc), 0);
    }
    engine.draw_fullscreen_quad();
}

/// Apply a shader program to a layer's texture (read from layer, render to scratch, copy back).
/// The `set_uniforms` closure is called after the shader is bound so you can set custom uniforms.
///
/// `get_shader` is called lazily to borrow the shader from the engine — this lets callers
/// pass e.g. `|e| &e.shaders.noise` without fighting the borrow checker.
pub fn apply_filter(
    engine: &mut EngineInner,
    layer_id: &str,
    get_shader: impl Fn(&EngineInner) -> &ShaderProgram,
    set_uniforms: impl FnOnce(&WebGl2RenderingContext, &ShaderProgram),
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

    // Bind scratch FBO A
    let scratch_fbo_a = engine.scratch_fbo_a;
    engine.fbo_pool.bind(&engine.gl, scratch_fbo_a);
    engine.gl.viewport(0, 0, w as i32, h as i32);

    {
        let gl = &engine.gl;
        let shader = get_shader(engine);

        // Use the filter shader
        gl.use_program(Some(&shader.program));

        // Bind layer texture to unit 0
        gl.active_texture(WebGl2RenderingContext::TEXTURE0);
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&layer_tex));
        if let Some(loc) = shader.location(gl, "u_tex") {
            gl.uniform1i(Some(&loc), 0);
        }

        // Let caller set additional uniforms
        set_uniforms(gl, shader);
    }

    // Draw fullscreen quad
    engine.draw_fullscreen_quad();

    if has_selection {
        // Blend filtered (scratch A) with original (scratch B) using selection mask → layer
        let scratch_a = engine.scratch_texture_a;
        let scratch_b = engine.scratch_texture_b;
        blend_with_selection_mask(engine, layer_id, scratch_a, scratch_b);
    } else {
        // Copy result back to layer texture (original path)
        let scratch_tex = engine.texture_pool.get(engine.scratch_texture_a).cloned();
        engine.render_to_texture(&layer_tex, w as i32, h as i32, |engine| {
            let gl = &engine.gl;
            gl.use_program(Some(&engine.shaders.blit.program));
            gl.active_texture(WebGl2RenderingContext::TEXTURE0);
            if let Some(t) = &scratch_tex {
                gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(t));
            }
            if let Some(loc) = engine.shaders.blit.location(gl, "u_tex") {
                gl.uniform1i(Some(&loc), 0);
            }
            engine.draw_fullscreen_quad();
        });
    }

    engine.mark_layer_dirty(layer_id);
}

/// Two-pass separable blur (horizontal then vertical).
/// Used for both Gaussian and box blur.
pub fn apply_separable_blur(
    engine: &mut EngineInner,
    layer_id: &str,
    get_shader: impl Fn(&EngineInner) -> &ShaderProgram,
    set_common_uniforms: impl Fn(&WebGl2RenderingContext, &ShaderProgram),
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

    {
        let gl = &engine.gl;
        let shader = get_shader(engine);
        gl.use_program(Some(&shader.program));
    }

    // Pass 1: horizontal (layer -> scratch A)
    let scratch_fbo_a = engine.scratch_fbo_a;
    engine.fbo_pool.bind(&engine.gl, scratch_fbo_a);
    engine.gl.viewport(0, 0, w as i32, h as i32);
    {
        let gl = &engine.gl;
        let shader = get_shader(engine);
        gl.active_texture(WebGl2RenderingContext::TEXTURE0);
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&layer_tex));
        if let Some(loc) = shader.location(gl, "u_tex") {
            gl.uniform1i(Some(&loc), 0);
        }
        if let Some(loc) = shader.location(gl, "u_direction") {
            gl.uniform2f(Some(&loc), 1.0, 0.0);
        }
        set_common_uniforms(gl, shader);
    }
    engine.draw_fullscreen_quad();

    // Pass 2: vertical (scratch A -> scratch B)
    let scratch_fbo_b = engine.scratch_fbo_b;
    engine.fbo_pool.bind(&engine.gl, scratch_fbo_b);
    engine.gl.viewport(0, 0, w as i32, h as i32);
    {
        let gl = &engine.gl;
        let shader = get_shader(engine);
        gl.active_texture(WebGl2RenderingContext::TEXTURE0);
        if let Some(scratch_tex_a) = engine.texture_pool.get(engine.scratch_texture_a) {
            gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(scratch_tex_a));
        }
        if let Some(loc) = shader.location(gl, "u_tex") {
            gl.uniform1i(Some(&loc), 0);
        }
        if let Some(loc) = shader.location(gl, "u_direction") {
            gl.uniform2f(Some(&loc), 0.0, 1.0);
        }
        set_common_uniforms(gl, shader);
    }
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
        let scratch_tex_b = engine.texture_pool.get(engine.scratch_texture_b).cloned();
        engine.render_to_texture(&layer_tex, w as i32, h as i32, |engine| {
            let gl = &engine.gl;
            gl.use_program(Some(&engine.shaders.blit.program));
            gl.active_texture(WebGl2RenderingContext::TEXTURE0);
            if let Some(t) = &scratch_tex_b {
                gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(t));
            }
            if let Some(loc) = engine.shaders.blit.location(gl, "u_tex") {
                gl.uniform1i(Some(&loc), 0);
            }
            engine.draw_fullscreen_quad();
        });
    }

    engine.mark_layer_dirty(layer_id);
}
