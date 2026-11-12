use lopsy_core::dab_rect::dab_rect;

use crate::dab_pass_gpu::scratch_dab_pass;
use crate::engine::EngineInner;
use crate::gpu::framebuffer::FramebufferHandle;
use crate::gpu::pass::Target;
use crate::gpu::texture_pool::TextureHandle;

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
    if engine.texture_pool.get(tex_handle).is_none() {
        return;
    }
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
            tex_handle,
            mean_fbo,
            w,
            h,
            (dx + ox, dy + oy),
            (dx, dy),
            size * 0.5,
        );

        // The scissor bounds the destination only: the shader still reads the
        // source disc at `+ source_offset` from anywhere in the layer.
        scratch_dab_pass(
            engine,
            tex_handle,
            w,
            h,
            rect,
            engine
                .pass(&engine.shaders.healing_dab)
                .texture("u_layerTex", tex_handle)
                .texture("u_meanTex", mean_tex)
                .vec2("u_center", dx, dy)
                .f32("u_size", size)
                .vec2("u_texSize", w as f32, h as f32)
                .vec2("u_sourceOffset", ox, oy)
                .f32("u_opacity", opacity),
        );
    }

    // The mean target must not stay bound to a sampler unit: the next dab
    // batch renders into it.
    engine.gpu().unbind_textures(2);

    engine.mark_layer_dirty(layer_id);
}

/// The engine's 2×1 region-mean target, created on first use. It comes from
/// the texture pool, so it is RGBA16F wherever layers are and RGBA8 on GPUs
/// without renderable float textures.
fn ensure_mean_target(engine: &mut EngineInner) -> Option<(TextureHandle, FramebufferHandle)> {
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
    engine.texture_pool.get(tex)?;
    Some((tex, fbo))
}

/// Render the mean RGB of the circle of `radius` around `src_center` into
/// texel (0, 0) of the mean target and around `dst_center` into texel (1, 0),
/// with one 2×1 draw of `healing_mean.glsl`. Runs unscissored.
fn render_region_means(
    engine: &EngineInner,
    layer: TextureHandle,
    mean_fbo: FramebufferHandle,
    tex_w: u32,
    tex_h: u32,
    src_center: (f32, f32),
    dst_center: (f32, f32),
    radius: f32,
) {
    engine
        .pass(&engine.shaders.healing_mean)
        .texture("u_tex", layer)
        .vec2("u_srcCenter", src_center.0, src_center.1)
        .vec2("u_dstCenter", dst_center.0, dst_center.1)
        .f32("u_radius", radius)
        .vec2("u_texSize", tex_w as f32, tex_h as f32)
        .viewport(0, 0, 2, 1)
        .draw(Target::Framebuffer(mean_fbo));
}
