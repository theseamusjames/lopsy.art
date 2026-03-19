use web_sys::WebGl2RenderingContext;
use crate::engine::EngineInner;
use crate::gpu::texture_pool::TextureHandle;
use lopsy_core::layer::{GlowDesc, ShadowDesc, StrokeDesc, ColorOverlayDesc};

/// Main compositing pipeline — called every frame
pub fn composite(engine: &mut EngineInner) {
    // Copy viewport state so we don't borrow engine
    let vp_zoom = engine.viewport.zoom;
    let vp_pan_x = engine.viewport.pan_x;
    let vp_pan_y = engine.viewport.pan_y;
    let doc_w = engine.doc_width;
    let doc_h = engine.doc_height;
    let bg = engine.bg_color;

    // 1. Bind composite FBO and clear with background color
    engine.fbo_pool.bind(&engine.gl, engine.composite_fbo);
    engine.gl.viewport(0, 0, doc_w as i32, doc_h as i32);
    engine.gl.clear_color(bg[0], bg[1], bg[2], bg[3]);
    engine.gl.clear(WebGl2RenderingContext::COLOR_BUFFER_BIT);

    // 2. Collect layer info (avoids borrowing engine.layer_stack during rendering)
    let layer_info: Vec<_> = engine.layer_stack.iter().map(|layer| {
        (
            layer.id.clone(),
            layer.visible,
            layer.opacity,
            layer.blend_mode as i32,
            layer.x as f32,
            layer.y as f32,
            layer.width as f32,
            layer.height as f32,
            layer.effects.clone(),
        )
    }).collect();

    // 3. For each visible layer, render with effects
    for (layer_id, visible, opacity, blend_mode, layer_x, layer_y, layer_w, layer_h, effects) in &layer_info {
        if !visible || *opacity < 1e-7 {
            continue;
        }

        let tex_handle = match engine.layer_textures.get(layer_id) {
            Some(&h) => h,
            None => continue,
        };
        let (tw, th) = engine.texture_pool.get_size(tex_handle).unwrap_or((*layer_w as u32, *layer_h as u32));

        // --- "Behind" effects: outer glow, drop shadow ---
        if let Some(ref glow) = effects.outer_glow {
            if glow.enabled {
                render_glow(engine, tex_handle, tw, th, glow, 0);
            }
        }
        if let Some(ref shadow) = effects.drop_shadow {
            if shadow.enabled {
                render_shadow(engine, tex_handle, tw, th, shadow);
            }
        }

        // --- Color overlay: modify layer before blending ---
        let use_overlay_scratch = effects.color_overlay.as_ref().map_or(false, |o| o.enabled);
        if let Some(ref overlay) = effects.color_overlay {
            if overlay.enabled {
                render_color_overlay(engine, tex_handle, overlay);
            }
        }

        // --- Blend layer onto composite ---
        let blend_tex = if use_overlay_scratch {
            engine.texture_pool.get(engine.scratch_texture_a).cloned()
        } else {
            engine.texture_pool.get(tex_handle).cloned()
        };
        if let Some(ref src_tex) = blend_tex {
            blend_onto_composite(engine, src_tex, *opacity, *blend_mode, *layer_x, *layer_y, tw, th, false);
        }

        // --- Active stroke texture ---
        if let Some(&stroke_handle) = engine.stroke_textures.get(layer_id) {
            if let Some(stroke_tex) = engine.texture_pool.get(stroke_handle).cloned() {
                let (sw, sh) = engine.texture_pool.get_size(stroke_handle).unwrap_or((1, 1));
                blend_onto_composite(engine, &stroke_tex, *opacity, 0, *layer_x, *layer_y, sw, sh, true);
            }
        }

        // --- "On top" effects: inner glow, stroke effect ---
        if let Some(ref glow) = effects.inner_glow {
            if glow.enabled {
                render_glow(engine, tex_handle, tw, th, glow, 1);
            }
        }
        if let Some(ref stroke) = effects.stroke {
            if stroke.enabled {
                render_stroke(engine, tex_handle, tw, th, stroke);
            }
        }
    }

    // 4. Final blit to screen canvas
    engine.fbo_pool.unbind(&engine.gl);
    let canvas = engine.gl.canvas().unwrap();
    let canvas_el: web_sys::HtmlCanvasElement = canvas.dyn_into().unwrap();
    let screen_w = canvas_el.width() as i32;
    let screen_h = canvas_el.height() as i32;
    engine.gl.viewport(0, 0, screen_w, screen_h);

    engine.gl.use_program(Some(&engine.shaders.final_blit.program));
    engine.gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    if let Some(comp_tex) = engine.texture_pool.get(engine.composite_texture) {
        engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(comp_tex));
    }

    let prog = &engine.shaders.final_blit.program;
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_compositeTex") { engine.gl.uniform1i(Some(&loc), 0); }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_resolution") { engine.gl.uniform2f(Some(&loc), screen_w as f32, screen_h as f32); }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_zoom") { engine.gl.uniform1f(Some(&loc), vp_zoom as f32); }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_pan") { engine.gl.uniform2f(Some(&loc), vp_pan_x as f32, vp_pan_y as f32); }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_docSize") { engine.gl.uniform2f(Some(&loc), doc_w as f32, doc_h as f32); }

    engine.draw_fullscreen_quad();

    engine.dirty_layers.clear();
    engine.needs_recomposite = false;
}

// ---------------------------------------------------------------------------
// Effect rendering helpers
// ---------------------------------------------------------------------------

/// Blend a source texture onto the composite using the blend shader.
fn blend_onto_composite(
    engine: &mut EngineInner,
    src_tex: &web_sys::WebGlTexture,
    opacity: f32,
    blend_mode: i32,
    layer_x: f32,
    layer_y: f32,
    tw: u32,
    th: u32,
    premultiplied: bool,
) {
    let doc_w = engine.doc_width as f32;
    let doc_h = engine.doc_height as f32;

    engine.gl.use_program(Some(&engine.shaders.blend.program));
    engine.gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(src_tex));
    engine.gl.active_texture(WebGl2RenderingContext::TEXTURE1);
    if let Some(comp_tex) = engine.texture_pool.get(engine.composite_texture) {
        engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(comp_tex));
    }
    let prog = &engine.shaders.blend.program;
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_srcTex") { engine.gl.uniform1i(Some(&loc), 0); }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_dstTex") { engine.gl.uniform1i(Some(&loc), 1); }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_opacity") { engine.gl.uniform1f(Some(&loc), opacity); }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_blendMode") { engine.gl.uniform1i(Some(&loc), blend_mode); }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_srcOffset") { engine.gl.uniform2f(Some(&loc), layer_x, layer_y); }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_srcSize") { engine.gl.uniform2f(Some(&loc), tw as f32, th as f32); }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_docSize") { engine.gl.uniform2f(Some(&loc), doc_w, doc_h); }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_srcPremultiplied") { engine.gl.uniform1i(Some(&loc), if premultiplied { 1 } else { 0 }); }

    engine.fbo_pool.bind(&engine.gl, engine.scratch_fbo_a);
    engine.draw_fullscreen_quad();

    engine.fbo_pool.bind(&engine.gl, engine.composite_fbo);
    engine.gl.use_program(Some(&engine.shaders.blit.program));
    engine.gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    if let Some(scratch_tex) = engine.texture_pool.get(engine.scratch_texture_a) {
        engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(scratch_tex));
    }
    if let Some(loc) = engine.gl.get_uniform_location(&engine.shaders.blit.program, "u_tex") { engine.gl.uniform1i(Some(&loc), 0); }
    engine.draw_fullscreen_quad();
}

/// Blend an effect result (in scratch_a) onto the composite using GL blending.
fn blend_effect_onto_composite(engine: &mut EngineInner) {
    if let Some(scratch_tex) = engine.texture_pool.get(engine.scratch_texture_a).cloned() {
        engine.fbo_pool.bind(&engine.gl, engine.composite_fbo);
        engine.gl.enable(WebGl2RenderingContext::BLEND);
        engine.gl.blend_func(WebGl2RenderingContext::SRC_ALPHA, WebGl2RenderingContext::ONE_MINUS_SRC_ALPHA);
        engine.gl.use_program(Some(&engine.shaders.blit.program));
        engine.gl.active_texture(WebGl2RenderingContext::TEXTURE0);
        engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&scratch_tex));
        if let Some(loc) = engine.gl.get_uniform_location(&engine.shaders.blit.program, "u_tex") { engine.gl.uniform1i(Some(&loc), 0); }
        engine.draw_fullscreen_quad();
        engine.gl.disable(WebGl2RenderingContext::BLEND);
    }
}

/// Render outer or inner glow.
fn render_glow(engine: &mut EngineInner, tex_handle: TextureHandle, tw: u32, th: u32, glow: &GlowDesc, mode: i32) {
    let doc_w = engine.doc_width as i32;
    let doc_h = engine.doc_height as i32;
    if let Some(layer_tex) = engine.texture_pool.get(tex_handle).cloned() {
        engine.gl.use_program(Some(&engine.shaders.glow.program));
        engine.gl.active_texture(WebGl2RenderingContext::TEXTURE0);
        engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&layer_tex));
        let prog = &engine.shaders.glow.program;
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_srcTex") { engine.gl.uniform1i(Some(&loc), 0); }
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_glowColor") { engine.gl.uniform4f(Some(&loc), glow.color[0], glow.color[1], glow.color[2], glow.color[3]); }
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_size") { engine.gl.uniform1f(Some(&loc), glow.size); }
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_spread") { engine.gl.uniform1f(Some(&loc), glow.spread); }
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_opacity") { engine.gl.uniform1f(Some(&loc), glow.opacity); }
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_texelSize") { engine.gl.uniform2f(Some(&loc), 1.0 / tw as f32, 1.0 / th as f32); }
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_mode") { engine.gl.uniform1i(Some(&loc), mode); }

        engine.fbo_pool.bind(&engine.gl, engine.scratch_fbo_a);
        engine.gl.viewport(0, 0, doc_w, doc_h);
        engine.gl.clear_color(0.0, 0.0, 0.0, 0.0);
        engine.gl.clear(WebGl2RenderingContext::COLOR_BUFFER_BIT);
        engine.draw_fullscreen_quad();

        blend_effect_onto_composite(engine);
    }
}

/// Render drop shadow.
fn render_shadow(engine: &mut EngineInner, tex_handle: TextureHandle, tw: u32, th: u32, shadow: &ShadowDesc) {
    let doc_w = engine.doc_width as i32;
    let doc_h = engine.doc_height as i32;
    if let Some(layer_tex) = engine.texture_pool.get(tex_handle).cloned() {
        engine.gl.use_program(Some(&engine.shaders.shadow.program));
        engine.gl.active_texture(WebGl2RenderingContext::TEXTURE0);
        engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&layer_tex));
        let prog = &engine.shaders.shadow.program;
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_srcTex") { engine.gl.uniform1i(Some(&loc), 0); }
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_shadowColor") { engine.gl.uniform4f(Some(&loc), shadow.color[0], shadow.color[1], shadow.color[2], shadow.color[3]); }
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_offset") { engine.gl.uniform2f(Some(&loc), shadow.offset_x, shadow.offset_y); }
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_blur") { engine.gl.uniform1f(Some(&loc), shadow.blur); }
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_opacity") { engine.gl.uniform1f(Some(&loc), shadow.opacity); }
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_texelSize") { engine.gl.uniform2f(Some(&loc), 1.0 / tw as f32, 1.0 / th as f32); }

        engine.fbo_pool.bind(&engine.gl, engine.scratch_fbo_a);
        engine.gl.viewport(0, 0, doc_w, doc_h);
        engine.gl.clear_color(0.0, 0.0, 0.0, 0.0);
        engine.gl.clear(WebGl2RenderingContext::COLOR_BUFFER_BIT);
        engine.draw_fullscreen_quad();

        blend_effect_onto_composite(engine);
    }
}

/// Render color overlay into scratch_a.
fn render_color_overlay(engine: &mut EngineInner, tex_handle: TextureHandle, overlay: &ColorOverlayDesc) {
    let doc_w = engine.doc_width as i32;
    let doc_h = engine.doc_height as i32;
    if let Some(layer_tex) = engine.texture_pool.get(tex_handle).cloned() {
        engine.gl.use_program(Some(&engine.shaders.color_overlay.program));
        engine.gl.active_texture(WebGl2RenderingContext::TEXTURE0);
        engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&layer_tex));
        let prog = &engine.shaders.color_overlay.program;
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_srcTex") { engine.gl.uniform1i(Some(&loc), 0); }
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_overlayColor") { engine.gl.uniform4f(Some(&loc), overlay.color[0], overlay.color[1], overlay.color[2], overlay.color[3]); }
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_opacity") { engine.gl.uniform1f(Some(&loc), overlay.opacity); }

        engine.fbo_pool.bind(&engine.gl, engine.scratch_fbo_a);
        engine.gl.viewport(0, 0, doc_w, doc_h);
        engine.gl.clear_color(0.0, 0.0, 0.0, 0.0);
        engine.gl.clear(WebGl2RenderingContext::COLOR_BUFFER_BIT);
        engine.draw_fullscreen_quad();
    }
}

/// Render stroke effect using the glow shader with hard cutoff.
fn render_stroke(engine: &mut EngineInner, tex_handle: TextureHandle, tw: u32, th: u32, stroke: &StrokeDesc) {
    let mode = match stroke.position {
        lopsy_core::layer::StrokePosition::Inside => 1,
        _ => 0,
    };
    // Reuse the glow shader with max spread for hard edges
    let glow = GlowDesc {
        enabled: true,
        color: stroke.color,
        size: stroke.width,
        spread: 2.0, // max = hard cutoff
        opacity: stroke.opacity,
    };
    render_glow(engine, tex_handle, tw, th, &glow, mode);
}

/// Composite for export — render to FBO, readPixels
pub fn composite_for_export(engine: &mut EngineInner) -> Result<Vec<u8>, String> {
    let doc_w = engine.doc_width;
    let doc_h = engine.doc_height;
    let bg = engine.bg_color;

    // Render composite (same as display but without viewport transform)
    engine.fbo_pool.bind(&engine.gl, engine.composite_fbo);
    engine.gl.viewport(0, 0, doc_w as i32, doc_h as i32);
    engine.gl.clear_color(bg[0], bg[1], bg[2], bg[3]);
    engine.gl.clear(WebGl2RenderingContext::COLOR_BUFFER_BIT);

    // Collect layer info
    let layer_info: Vec<_> = engine.layer_stack.iter().map(|layer| {
        (layer.id.clone(), layer.visible, layer.opacity, layer.blend_mode as i32, layer.x as f32, layer.y as f32, layer.width as f32, layer.height as f32, layer.effects.clone())
    }).collect();

    for (layer_id, visible, opacity, blend_mode, layer_x, layer_y, layer_w, layer_h, effects) in &layer_info {
        if !visible || *opacity < 1e-7 { continue; }
        let tex_handle = match engine.layer_textures.get(layer_id) { Some(&h) => h, None => continue };
        let (tw, th) = engine.texture_pool.get_size(tex_handle).unwrap_or((*layer_w as u32, *layer_h as u32));

        // Behind effects
        if let Some(ref glow) = effects.outer_glow { if glow.enabled { render_glow(engine, tex_handle, tw, th, glow, 0); } }
        if let Some(ref shadow) = effects.drop_shadow { if shadow.enabled { render_shadow(engine, tex_handle, tw, th, shadow); } }

        // Color overlay
        let use_overlay = effects.color_overlay.as_ref().map_or(false, |o| o.enabled);
        if let Some(ref overlay) = effects.color_overlay { if overlay.enabled { render_color_overlay(engine, tex_handle, overlay); } }

        // Blend layer
        let blend_tex = if use_overlay {
            engine.texture_pool.get(engine.scratch_texture_a).cloned()
        } else {
            engine.texture_pool.get(tex_handle).cloned()
        };
        if let Some(ref src_tex) = blend_tex {
            blend_onto_composite(engine, src_tex, *opacity, *blend_mode, *layer_x, *layer_y, tw, th, false);
        }

        // On-top effects
        if let Some(ref glow) = effects.inner_glow { if glow.enabled { render_glow(engine, tex_handle, tw, th, glow, 1); } }
        if let Some(ref stroke) = effects.stroke { if stroke.enabled { render_stroke(engine, tex_handle, tw, th, stroke); } }
    }

    // Read pixels
    let mut pixels = vec![0u8; (doc_w * doc_h * 4) as usize];
    engine.gl.read_pixels_with_opt_u8_array(
        0, 0, doc_w as i32, doc_h as i32,
        WebGl2RenderingContext::RGBA,
        WebGl2RenderingContext::UNSIGNED_BYTE,
        Some(&mut pixels),
    ).map_err(|e| format!("readPixels failed: {:?}", e))?;

    engine.fbo_pool.unbind(&engine.gl);
    Ok(pixels)
}

use wasm_bindgen::JsCast;
