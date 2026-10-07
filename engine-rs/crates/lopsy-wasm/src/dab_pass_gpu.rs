use lopsy_core::geometry::Rect;
use web_sys::{WebGl2RenderingContext, WebGlTexture};

use crate::engine::EngineInner;

/// Run `draw` with the scissor test limited to `rect` (texels of whatever
/// target `draw` binds), then switch the test off again so later passes —
/// other tools, the compositor — are never clipped by a stale rect.
pub(crate) fn with_scissor<R>(
    engine: &mut EngineInner,
    rect: Rect,
    draw: impl FnOnce(&mut EngineInner) -> R,
) -> R {
    engine.gl.enable(WebGl2RenderingContext::SCISSOR_TEST);
    engine
        .gl
        .scissor(rect.x, rect.y, rect.width as i32, rect.height as i32);
    let result = draw(engine);
    engine.gl.disable(WebGl2RenderingContext::SCISSOR_TEST);
    result
}

/// One read-modify-write dab on a `w`×`h` layer texture. `draw` binds its
/// dab shader (which samples `layer_tex`) and draws a full-screen quad into
/// scratch A; scratch A is then copied back over the layer. Both passes are
/// scissored to `rect` (#1219): the dab shaders pass every texel outside the
/// dab's radius through unchanged, so the result is identical to the two
/// full-texture passes they replace. Scratch texels outside `rect` stay
/// stale and are never copied back. The caller sizes scratch to the layer
/// and calls `mark_layer_dirty` once its batch is done.
pub(crate) fn scratch_dab_pass(
    engine: &mut EngineInner,
    layer_tex: &WebGlTexture,
    w: u32,
    h: u32,
    rect: Rect,
    draw: impl FnOnce(&EngineInner),
) {
    with_scissor(engine, rect, |engine| {
        engine.fbo_pool.bind(&engine.gl, engine.scratch_fbo_a);
        engine.gl.viewport(0, 0, w as i32, h as i32);
        draw(engine);
        copy_scratch_a_to(engine, layer_tex, w, h);
    });
}

/// Blit scratch A over `dst` at `w`×`h`, honouring whatever scissor rect is
/// active.
pub(crate) fn copy_scratch_a_to(engine: &EngineInner, dst: &WebGlTexture, w: u32, h: u32) {
    let Some(scratch_tex) = engine.texture_pool.get(engine.scratch_texture_a).cloned() else {
        return;
    };
    engine.render_to_texture(dst, w as i32, h as i32, |engine| {
        let gl = &engine.gl;
        gl.use_program(Some(&engine.shaders.blit.program));
        gl.active_texture(WebGl2RenderingContext::TEXTURE0);
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&scratch_tex));
        if let Some(loc) = engine.shaders.blit.location(gl, "u_tex") {
            gl.uniform1i(Some(&loc), 0);
        }
        engine.draw_fullscreen_quad();
    });
}
