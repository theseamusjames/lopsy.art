use lopsy_core::geometry::Rect;
use lopsy_core::pixel_buffer::{content_rect_from_projections, reduction_steps};
use crate::engine::EngineInner;
use crate::gpu::pass::{Blend, Scissor, Target};
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
    tex: TextureHandle,
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
    src: TextureHandle,
    w: u32,
    h: u32,
    axis: Axis,
) -> Result<Vec<u8>, String> {
    let len = match axis { Axis::X => w, Axis::Y => h };
    let mut cur = src;
    let (mut cur_w, mut cur_h) = (w, h);
    let mut owned: Option<TextureHandle> = None;
    let mut is_first = true;

    for out_len in reduction_steps(len, SPAN) {
        let (out_w, out_h) = match axis { Axis::X => (out_len, h), Axis::Y => (w, out_len) };
        let out = match engine.texture_pool.acquire(out_w, out_h) {
            Ok(t) => t,
            Err(e) => {
                if let Some(prev) = owned { engine.texture_pool.release(prev); }
                return Err(e);
            }
        };
        if engine.texture_pool.get(out).is_none() {
            engine.texture_pool.release(out);
            if let Some(prev) = owned { engine.texture_pool.release(prev); }
            return Err("reduction texture missing".into());
        }
        draw_reduce_step(engine, cur, (cur_w, cur_h), out, axis, is_first);
        if let Some(prev) = owned.replace(out) {
            engine.texture_pool.release(prev);
        }
        cur = out;
        cur_w = out_w;
        cur_h = out_h;
        is_first = false;
    }

    let Some(strip) = owned else { return Err("no reduction step ran".into()) };
    let rgba = engine.gpu().read_rgba(strip, 0, 0, cur_w, cur_h);
    engine.texture_pool.release(strip);
    let rgba = rgba?;
    Ok(rgba.chunks_exact(4).map(|px| px[0]).collect())
}

fn draw_reduce_step(
    engine: &EngineInner,
    src: TextureHandle,
    src_size: (u32, u32),
    dst: TextureHandle,
    axis: Axis,
    is_alpha_test: bool,
) {
    let (ax, ay) = match axis { Axis::X => (1, 0), Axis::Y => (0, 1) };
    engine
        .pass(&engine.shaders.content_bounds_reduce)
        .texture("u_src", src)
        .ivec2("u_axis", ax, ay)
        .i32("u_span", SPAN as i32)
        .ivec2("u_srcSize", src_size.0 as i32, src_size.1 as i32)
        .i32("u_alphaTest", i32::from(is_alpha_test))
        .blend(Blend::Off)
        .scissor(Scissor::Off)
        .draw(Target::Texture(dst));
}
