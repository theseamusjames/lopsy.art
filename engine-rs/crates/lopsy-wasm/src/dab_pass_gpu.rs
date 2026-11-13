use lopsy_core::geometry::Rect;

use crate::engine::EngineInner;
use crate::gpu::pass::{Pass, Scissor, Target};
use crate::gpu::texture_pool::TextureHandle;

/// One read-modify-write dab on a `w`×`h` layer texture. `dab` is the dab
/// shader's pass, already given its uniforms and the layer as input; it is
/// drawn into scratch A, and scratch A is then copied back over the layer.
/// Both passes are scissored to `rect` (#1219): the dab shaders pass every
/// texel outside the dab's radius through unchanged, so the result is
/// identical to the two full-texture passes they replace. Scratch texels
/// outside `rect` stay stale and are never copied back. The caller sizes
/// scratch to the layer and calls `mark_layer_dirty` once its batch is done.
pub(crate) fn scratch_dab_pass<P>(
    engine: &EngineInner,
    layer: TextureHandle,
    w: u32,
    h: u32,
    rect: Rect,
    dab: Pass<'_, P>,
) {
    dab.viewport(0, 0, w as i32, h as i32)
        .scissor(Scissor::Rect(rect))
        .draw(Target::Framebuffer(engine.scratch_fbo_a));
    copy_scratch_a_to(engine, layer, w, h, rect);
}

/// Blit scratch A over `dst` at `w`×`h`, limited to `rect`.
pub(crate) fn copy_scratch_a_to(engine: &EngineInner, dst: TextureHandle, w: u32, h: u32, rect: Rect) {
    engine
        .pass(&engine.shaders.blit, ())
        .texture("u_tex", engine.scratch_texture_a)
        .viewport(0, 0, w as i32, h as i32)
        .scissor(Scissor::Rect(rect))
        .draw(Target::Texture(dst));
}
