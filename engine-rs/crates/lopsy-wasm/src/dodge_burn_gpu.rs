use web_sys::WebGl2RenderingContext;
use crate::engine::EngineInner;

/// Begin a dodge/burn stroke on `layer_id`. Allocates a per-stroke
/// coverage texture (same size as the layer) into which each dab's
/// strength is MAX-accumulated. Until `end_dodge_burn_stroke` runs, the
/// compositor renders a preview rather than mutating the layer, so
/// overlapping dabs within one stroke never compound.
pub fn begin_dodge_burn_stroke(
    engine: &mut EngineInner,
    layer_id: &str,
    mode: u32,
) -> Result<(), String> {
    engine.ensure_layer_full_size(layer_id)?;

    if let Some(&layer_tex) = engine.layer_textures.get(layer_id) {
        let (w, h) = engine.texture_pool.get_size(layer_tex).unwrap_or((1, 1));

        // Coverage texture — allocated clean (texture_pool.acquire zero-
        // initializes). MAX-blend starts from zero so first-dab writes win.
        let coverage_tex = engine.texture_pool.acquire(&engine.gl, w, h)?;
        if let Some(old) = engine.stroke_dodge_textures.insert(layer_id.to_string(), coverage_tex) {
            engine.texture_pool.release(old);
        }

        // Preview texture — re-rendered each frame by the compositor.
        let preview_tex = engine.texture_pool.acquire(&engine.gl, w, h)?;
        if let Some(old) = engine.stroke_dodge_preview_textures.insert(layer_id.to_string(), preview_tex) {
            engine.texture_pool.release(old);
        }

        engine.stroke_dodge_modes.insert(layer_id.to_string(), mode);

        if engine.stroke_fbo.is_none() {
            let fbo = engine.fbo_pool.create(&engine.gl)?;
            engine.stroke_fbo = Some(fbo);
        }
    }
    engine.needs_recomposite = true;
    Ok(())
}

pub fn apply_dodge_burn_dab(
    engine: &mut EngineInner,
    layer_id: &str,
    cx: f64,
    cy: f64,
    size: f32,
    hardness: f32,
    exposure: f32,
) {
    apply_dodge_burn_dab_batch(engine, layer_id, &[cx, cy], size, hardness, exposure);
}

/// MAX-accumulate each dab's scalar strength (stamp × exposure) into the
/// per-stroke coverage texture. Output is written to all four RGBA channels
/// equally; `blend_equation(MAX)` picks the highest strength at each pixel
/// across overlapping dabs — so one stroke paints a soft-edged shape at the
/// max exposure each pixel ever sees, not the sum of each dab's exposure.
pub fn apply_dodge_burn_dab_batch(
    engine: &mut EngineInner,
    layer_id: &str,
    points: &[f64],
    size: f32,
    hardness: f32,
    exposure: f32,
) {
    let coverage_handle = match engine.stroke_dodge_textures.get(layer_id) {
        Some(&h) => h,
        None => return,
    };
    let (w, h) = engine.texture_pool.get_size(coverage_handle).unwrap_or((1, 1));

    let gl = &engine.gl;

    if let (Some(fbo), Some(tex)) = (engine.stroke_fbo, engine.texture_pool.get(coverage_handle)) {
        engine.fbo_pool.attach_texture(gl, fbo, tex);
        engine.fbo_pool.bind(gl, fbo);
    } else {
        return;
    }
    gl.viewport(0, 0, w as i32, h as i32);

    // MAX-blend coverage. Start from a fresh coverage texture (zeroed at
    // begin_stroke) so the first dab writes unopposed; later overlapping
    // dabs only raise pixels whose strength exceeds the existing value.
    gl.enable(WebGl2RenderingContext::BLEND);
    gl.blend_equation(WebGl2RenderingContext::MAX);

    let shader = &engine.shaders.dodge_burn_dab;
    gl.use_program(Some(&shader.program));

    if let Some(loc) = shader.location(gl, "u_exposure") {
        gl.uniform1f(Some(&loc), exposure);
    }
    if let Some(loc) = shader.location(gl, "u_hardness") {
        gl.uniform1f(Some(&loc), hardness);
    }
    if let Some(loc) = shader.location(gl, "u_texSize") {
        gl.uniform2f(Some(&loc), w as f32, h as f32);
    }
    if let Some(loc) = shader.location(gl, "u_size") {
        gl.uniform1f(Some(&loc), size);
    }

    // Selection mask — same coordinate dance as brush_dab.
    let has_selection = engine.selection_mask_texture.is_some();
    if has_selection {
        gl.active_texture(WebGl2RenderingContext::TEXTURE0);
        if let Some(mask_handle) = engine.selection_mask_texture {
            if let Some(mask_tex) = engine.texture_pool.get(mask_handle) {
                gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(mask_tex));
            }
        }
        if let Some(loc) = shader.location(gl, "u_selectionMask") {
            gl.uniform1i(Some(&loc), 0);
        }
    }
    if let Some(loc) = shader.location(gl, "u_hasSelection") {
        gl.uniform1i(Some(&loc), if has_selection { 1 } else { 0 });
    }
    if let Some(loc) = shader.location(gl, "u_docSize") {
        gl.uniform2f(Some(&loc), engine.doc_width as f32, engine.doc_height as f32);
    }
    let (layer_ox, layer_oy) = engine.layer_stack.iter()
        .find(|l| l.id == layer_id)
        .map(|l| (l.x as f32, l.y as f32))
        .unwrap_or((0.0, 0.0));
    if let Some(loc) = shader.location(gl, "u_layerOffset") {
        gl.uniform2f(Some(&loc), layer_ox, layer_oy);
    }

    for chunk in points.chunks(2) {
        if chunk.len() < 2 { break; }
        if let Some(loc) = shader.location(gl, "u_center") {
            gl.uniform2f(Some(&loc), chunk[0] as f32, chunk[1] as f32);
        }
        engine.draw_fullscreen_quad();
    }

    gl.disable(WebGl2RenderingContext::BLEND);
    gl.blend_equation(WebGl2RenderingContext::FUNC_ADD);
    gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, None);

    engine.needs_recomposite = true;
}

/// Bake the accumulated coverage into the layer: apply the dodge/burn
/// shader once using the coverage texture as the stamp with
/// `u_exposure = 1.0` (exposure is already baked into the coverage).
/// Then release both the coverage and preview textures.
pub fn end_dodge_burn_stroke(engine: &mut EngineInner, layer_id: &str) {
    let coverage_handle = match engine.stroke_dodge_textures.remove(layer_id) {
        Some(h) => h,
        None => return,
    };
    let preview_handle = engine.stroke_dodge_preview_textures.remove(layer_id);
    let mode = engine.stroke_dodge_modes.remove(layer_id).unwrap_or(0);

    let layer_tex_handle = match engine.layer_textures.get(layer_id) {
        Some(&h) => h,
        None => {
            engine.texture_pool.release(coverage_handle);
            if let Some(p) = preview_handle { engine.texture_pool.release(p); }
            return;
        }
    };

    let (w, h) = engine.texture_pool.get_size(layer_tex_handle).unwrap_or((1, 1));
    let layer_gl_tex = match engine.texture_pool.get(layer_tex_handle) {
        Some(t) => t.clone(),
        None => {
            engine.texture_pool.release(coverage_handle);
            if let Some(p) = preview_handle { engine.texture_pool.release(p); }
            return;
        }
    };
    let coverage_gl_tex = match engine.texture_pool.get(coverage_handle) {
        Some(t) => t.clone(),
        None => {
            engine.texture_pool.release(coverage_handle);
            if let Some(p) = preview_handle { engine.texture_pool.release(p); }
            return;
        }
    };

    let gl = &engine.gl;
    gl.disable(WebGl2RenderingContext::BLEND);
    engine.fbo_pool.bind(gl, engine.scratch_fbo_a);
    gl.viewport(0, 0, w as i32, h as i32);

    let shader = &engine.shaders.dodge_burn;
    gl.use_program(Some(&shader.program));

    gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&layer_gl_tex));
    if let Some(loc) = shader.location(gl, "u_layerTex") {
        gl.uniform1i(Some(&loc), 0);
    }

    gl.active_texture(WebGl2RenderingContext::TEXTURE1);
    gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&coverage_gl_tex));
    if let Some(loc) = shader.location(gl, "u_stampTex") {
        gl.uniform1i(Some(&loc), 1);
    }

    if let Some(loc) = shader.location(gl, "u_mode") {
        gl.uniform1i(Some(&loc), mode as i32);
    }
    // Exposure is already baked into the coverage values — just apply
    // the coverage at full strength.
    if let Some(loc) = shader.location(gl, "u_exposure") {
        gl.uniform1f(Some(&loc), 1.0);
    }

    engine.draw_fullscreen_quad();

    // Unbind the layer texture from TEXTURE0 before we blit back onto it,
    // otherwise some drivers sample the FBO's own attachment.
    gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, None);
    gl.active_texture(WebGl2RenderingContext::TEXTURE1);
    gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, None);

    // Copy scratch A -> layer
    let scratch_a_tex = engine.texture_pool.get(engine.scratch_texture_a).cloned();
    engine.render_to_texture(&layer_gl_tex, w as i32, h as i32, |engine| {
        let gl = &engine.gl;
        gl.use_program(Some(&engine.shaders.blit.program));
        gl.active_texture(WebGl2RenderingContext::TEXTURE0);
        if let Some(s) = &scratch_a_tex {
            gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(s));
        }
        if let Some(loc) = engine.shaders.blit.location(gl, "u_tex") {
            gl.uniform1i(Some(&loc), 0);
        }
        engine.draw_fullscreen_quad();
    });

    engine.texture_pool.release(coverage_handle);
    if let Some(p) = preview_handle {
        engine.texture_pool.release(p);
    }
    engine.mark_layer_dirty(layer_id);
}
