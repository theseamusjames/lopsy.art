use web_sys::{WebGl2RenderingContext, WebGlTexture};
use lopsy_core::geometry::Rect;
use lopsy_core::pixel_buffer::{content_rect_from_projections, reduction_steps};
use crate::engine::EngineInner;
use crate::gpu::texture_pool::TextureHandle;

/// Texels each reduction step folds into one. Large enough that a 16K
/// axis needs only three steps, small enough to keep per-fragment loops
/// short.
const SPAN: u32 = 64;

/// Content bounds (texture-local) of a layer texture, computed on the GPU
/// (#1021). Reduces the texture to a `w × 1` column-occupancy and a
/// `1 × h` row-occupancy strip and reads back only those `w + h` texels,
/// instead of the whole texture — at 4096² that is 128 KB of float
/// readback instead of 256 MB, and no 16-million-pixel CPU scan. The
/// occupancy test matches `crop_to_content_bounds` on a `read_rgba`
/// result exactly (see `content_bounds_reduce.glsl`).
pub fn texture_content_bounds(
    engine: &mut EngineInner,
    tex: &WebGlTexture,
    w: u32,
    h: u32,
) -> Result<Rect, String> {
    let cols = reduce_axis(engine, tex, w, h, Axis::Y)?;
    if cols.iter().all(|&b| b <= 127) {
        return Ok(Rect::new(0, 0, 0, 0));
    }
    let rows = reduce_axis(engine, tex, w, h, Axis::X)?;
    Ok(content_rect_from_projections(&cols, &rows))
}

#[derive(Clone, Copy)]
enum Axis {
    X,
    Y,
}

/// Fold the texture along `axis` until that axis is one texel long, then
/// read the strip back. Returns one occupancy byte per texel of the other
/// axis (non-zero = occupied).
fn reduce_axis(
    engine: &mut EngineInner,
    src: &WebGlTexture,
    w: u32,
    h: u32,
    axis: Axis,
) -> Result<Vec<u8>, String> {
    let len = match axis { Axis::X => w, Axis::Y => h };
    let mut cur_tex = src.clone();
    let (mut cur_w, mut cur_h) = (w, h);
    let mut owned: Option<TextureHandle> = None;
    let mut is_first = true;

    for out_len in reduction_steps(len, SPAN) {
        let (out_w, out_h) = match axis { Axis::X => (out_len, h), Axis::Y => (w, out_len) };
        let out = match engine.texture_pool.acquire(&engine.gl, out_w, out_h) {
            Ok(t) => t,
            Err(e) => {
                if let Some(prev) = owned { engine.texture_pool.release(prev); }
                return Err(e);
            }
        };
        let Some(out_tex) = engine.texture_pool.get(out).cloned() else {
            engine.texture_pool.release(out);
            if let Some(prev) = owned { engine.texture_pool.release(prev); }
            return Err("reduction texture missing".into());
        };
        draw_reduce_step(engine, &cur_tex, (cur_w, cur_h), &out_tex, (out_w, out_h), axis, is_first);
        if let Some(prev) = owned.replace(out) {
            engine.texture_pool.release(prev);
        }
        cur_tex = out_tex;
        cur_w = out_w;
        cur_h = out_h;
        is_first = false;
    }

    let Some(strip) = owned else { return Err("no reduction step ran".into()) };
    let rgba = read_strip(engine, &cur_tex, cur_w, cur_h);
    engine.texture_pool.release(strip);
    let rgba = rgba?;
    Ok(rgba.chunks_exact(4).map(|px| px[0]).collect())
}

fn draw_reduce_step(
    engine: &EngineInner,
    src: &WebGlTexture,
    src_size: (u32, u32),
    dst: &WebGlTexture,
    dst_size: (u32, u32),
    axis: Axis,
    is_alpha_test: bool,
) {
    let (ax, ay) = match axis { Axis::X => (1, 0), Axis::Y => (0, 1) };
    engine.gl.disable(WebGl2RenderingContext::BLEND);
    engine.gl.disable(WebGl2RenderingContext::SCISSOR_TEST);
    engine.render_to_texture(dst, dst_size.0 as i32, dst_size.1 as i32, |engine| {
        let gl = &engine.gl;
        let shader = &engine.shaders.content_bounds_reduce;
        gl.use_program(Some(&shader.program));
        gl.active_texture(WebGl2RenderingContext::TEXTURE0);
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(src));
        if let Some(loc) = shader.location(gl, "u_src") { gl.uniform1i(Some(&loc), 0); }
        if let Some(loc) = shader.location(gl, "u_axis") { gl.uniform2i(Some(&loc), ax, ay); }
        if let Some(loc) = shader.location(gl, "u_span") { gl.uniform1i(Some(&loc), SPAN as i32); }
        if let Some(loc) = shader.location(gl, "u_srcSize") {
            gl.uniform2i(Some(&loc), src_size.0 as i32, src_size.1 as i32);
        }
        if let Some(loc) = shader.location(gl, "u_alphaTest") {
            gl.uniform1i(Some(&loc), i32::from(is_alpha_test));
        }
        engine.draw_fullscreen_quad();
    });
}

fn read_strip(engine: &EngineInner, tex: &WebGlTexture, w: u32, h: u32) -> Result<Vec<u8>, String> {
    engine.fbo_pool.attach_texture(&engine.gl, engine.render_fbo, tex);
    engine.fbo_pool.bind(&engine.gl, engine.render_fbo);
    let result = engine.texture_pool.read_rgba(&engine.gl, 0, 0, w, h);
    engine.fbo_pool.unbind(&engine.gl);
    result
}
