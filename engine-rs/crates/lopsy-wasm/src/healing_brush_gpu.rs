use lopsy_core::dab_rect::dab_rect;
use web_sys::{WebGl2RenderingContext, WebGlTexture};

use crate::dab_pass_gpu::scratch_dab_pass;
use crate::engine::EngineInner;
use crate::gpu::framebuffer::FramebufferHandle;

/// Apply a healing brush dab entirely on the GPU, preserving FP16 precision.
///
/// Algorithm, per dab:
///  1. Render the mean colour of the source region into texel (0, 0) and of
///     the destination region into texel (1, 0) of a 2×1 target.
///  2. Apply `healed = src - srcMean + dstMean` in the dab shader, which
///     reads both means from that target.
///
/// The means never leave the GPU (#1218): reading them back cost two
/// pipeline-draining `readPixels` per dab, and on RGBA16F targets the
/// `UNSIGNED_BYTE` read was rejected outright, leaving both means at zero.
pub fn apply_healing_dab(
    engine: &mut EngineInner,
    layer_id: &str,
    dest_x: f64,
    dest_y: f64,
    source_offset_x: f64,
    source_offset_y: f64,
    size: f32,
    opacity: f32,
) {
    apply_healing_dab_batch(
        engine,
        layer_id,
        &[dest_x, dest_y],
        source_offset_x,
        source_offset_y,
        size,
        opacity,
    );
}

pub fn apply_healing_dab_batch(
    engine: &mut EngineInner,
    layer_id: &str,
    points: &[f64],
    source_offset_x: f64,
    source_offset_y: f64,
    size: f32,
    opacity: f32,
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
    let Some((mean_tex, mean_fbo)) = ensure_mean_target(engine) else {
        return;
    };

    let (ox, oy) = (source_offset_x as f32, source_offset_y as f32);
    for chunk in points.chunks_exact(2) {
        let (dx, dy) = (chunk[0] as f32, chunk[1] as f32);
        let Some(rect) = dab_rect(dx, dy, size, w, h) else {
            continue;
        };

        render_region_means(
            engine,
            &layer_tex,
            mean_fbo,
            w,
            h,
            (dx + ox, dy + oy),
            (dx, dy),
            size * 0.5,
        );

        // The scissor bounds the destination only: the shader still reads the
        // source disc at `+ source_offset` from anywhere in the layer.
        scratch_dab_pass(engine, &layer_tex, w, h, rect, |engine| {
            let gl = &engine.gl;
            let shader = &engine.shaders.healing_dab;
            gl.use_program(Some(&shader.program));
            gl.active_texture(WebGl2RenderingContext::TEXTURE1);
            gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&mean_tex));
            gl.active_texture(WebGl2RenderingContext::TEXTURE0);
            gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&layer_tex));
            if let Some(loc) = shader.location(gl, "u_layerTex") {
                gl.uniform1i(Some(&loc), 0);
            }
            if let Some(loc) = shader.location(gl, "u_meanTex") {
                gl.uniform1i(Some(&loc), 1);
            }
            if let Some(loc) = shader.location(gl, "u_center") {
                gl.uniform2f(Some(&loc), dx, dy);
            }
            if let Some(loc) = shader.location(gl, "u_size") {
                gl.uniform1f(Some(&loc), size);
            }
            if let Some(loc) = shader.location(gl, "u_texSize") {
                gl.uniform2f(Some(&loc), w as f32, h as f32);
            }
            if let Some(loc) = shader.location(gl, "u_sourceOffset") {
                gl.uniform2f(Some(&loc), ox, oy);
            }
            if let Some(loc) = shader.location(gl, "u_opacity") {
                gl.uniform1f(Some(&loc), opacity);
            }
            engine.draw_fullscreen_quad();
        });
    }

    let gl = &engine.gl;
    gl.active_texture(WebGl2RenderingContext::TEXTURE1);
    gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, None);
    gl.active_texture(WebGl2RenderingContext::TEXTURE0);

    engine.mark_layer_dirty(layer_id);
}

/// The engine's 2×1 region-mean target, created on first use. It comes from
/// the texture pool, so it is RGBA16F wherever layers are and RGBA8 on GPUs
/// without renderable float textures.
fn ensure_mean_target(engine: &mut EngineInner) -> Option<(WebGlTexture, FramebufferHandle)> {
    if engine.healing_mean_target.is_none() {
        let tex = engine.texture_pool.acquire(&engine.gl, 2, 1).ok()?;
        engine.texture_pool.set_nearest_filter(&engine.gl, tex);
        let fbo = match engine.fbo_pool.create(&engine.gl) {
            Ok(f) => f,
            Err(_) => {
                engine.texture_pool.release(tex);
                return None;
            }
        };
        engine
            .fbo_pool
            .attach_texture(&engine.gl, fbo, engine.texture_pool.get(tex)?);
        engine.healing_mean_target = Some((tex, fbo));
    }
    let (tex, fbo) = engine.healing_mean_target?;
    Some((engine.texture_pool.get(tex)?.clone(), fbo))
}

/// Render the mean RGB of the circle of `radius` around `src_center` into
/// texel (0, 0) of the mean target and around `dst_center` into texel (1, 0),
/// with one 2×1 draw of `healing_mean.glsl`. Runs unscissored.
fn render_region_means(
    engine: &EngineInner,
    layer_tex: &WebGlTexture,
    mean_fbo: FramebufferHandle,
    tex_w: u32,
    tex_h: u32,
    src_center: (f32, f32),
    dst_center: (f32, f32),
    radius: f32,
) {
    let gl = &engine.gl;
    engine.fbo_pool.bind(gl, mean_fbo);
    gl.viewport(0, 0, 2, 1);

    let shader = &engine.shaders.healing_mean;
    gl.use_program(Some(&shader.program));
    gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(layer_tex));
    if let Some(loc) = shader.location(gl, "u_tex") {
        gl.uniform1i(Some(&loc), 0);
    }
    if let Some(loc) = shader.location(gl, "u_srcCenter") {
        gl.uniform2f(Some(&loc), src_center.0, src_center.1);
    }
    if let Some(loc) = shader.location(gl, "u_dstCenter") {
        gl.uniform2f(Some(&loc), dst_center.0, dst_center.1);
    }
    if let Some(loc) = shader.location(gl, "u_radius") {
        gl.uniform1f(Some(&loc), radius);
    }
    if let Some(loc) = shader.location(gl, "u_texSize") {
        gl.uniform2f(Some(&loc), tex_w as f32, tex_h as f32);
    }
    engine.draw_fullscreen_quad();
}
