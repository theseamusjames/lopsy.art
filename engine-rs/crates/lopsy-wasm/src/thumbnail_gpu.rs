//! Box-filtered thumbnails for the Layers, Channels and Navigator panels.
//!
//! Each thumbnail pixel averages its whole source footprint on the GPU
//! (`thumbnail_box.glsl`) and only the thumbnail is read back. A plain
//! LINEAR blit sampled one 2x2 neighbourhood per thumbnail pixel, so a fine
//! regular pattern aliased: a grid whose period matched the stride showed
//! only its lines.

use web_sys::{WebGl2RenderingContext, WebGlTexture};

use crate::engine::EngineInner;

/// `channel` value for a colour thumbnail (as opposed to one channel as grey).
pub const COLOUR: i32 = -1;

/// Thumbnail dimensions: the source scaled to fit `max_size` on its long
/// edge, never upscaled and never below 1 px.
pub fn thumbnail_size(w: u32, h: u32, max_size: u32) -> (u32, u32) {
    if w <= max_size && h <= max_size {
        return (w, h);
    }
    let scale = (max_size as f64) / (w.max(h) as f64);
    (
        ((w as f64 * scale).round() as u32).max(1),
        ((h as f64 * scale).round() as u32).max(1),
    )
}

/// Box-downscale `src_tex` (`w`×`h`, straight alpha) to fit `max_size` and
/// read it back. `channel` is [`COLOUR`] or 0..3 for R, G, B, A as grey.
///
/// Returns an 8-byte header `[width_u32_le, height_u32_le]` + RGBA8 pixels,
/// or an empty vector when the GPU objects cannot be created.
pub fn read_box_thumbnail(
    engine: &EngineInner,
    src_tex: &WebGlTexture,
    w: u32,
    h: u32,
    max_size: u32,
    channel: i32,
) -> Vec<u8> {
    if w == 0 || h == 0 {
        return Vec::new();
    }
    let (tw, th) = thumbnail_size(w, h, max_size);
    let gl = &engine.gl;

    let thumb_tex = match gl.create_texture() {
        Some(t) => t,
        None => return Vec::new(),
    };
    gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&thumb_tex));
    let _ = gl.tex_image_2d_with_i32_and_i32_and_i32_and_format_and_type_and_opt_u8_array(
        WebGl2RenderingContext::TEXTURE_2D, 0,
        WebGl2RenderingContext::RGBA8 as i32,
        tw as i32, th as i32, 0,
        WebGl2RenderingContext::RGBA,
        WebGl2RenderingContext::UNSIGNED_BYTE,
        None,
    );
    let fbo = match gl.create_framebuffer() {
        Some(f) => f,
        None => {
            gl.delete_texture(Some(&thumb_tex));
            return Vec::new();
        }
    };
    gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, Some(&fbo));
    gl.framebuffer_texture_2d(
        WebGl2RenderingContext::FRAMEBUFFER,
        WebGl2RenderingContext::COLOR_ATTACHMENT0,
        WebGl2RenderingContext::TEXTURE_2D,
        Some(&thumb_tex), 0,
    );
    gl.viewport(0, 0, tw as i32, th as i32);

    let shader = &engine.shaders.thumbnail_box;
    gl.use_program(Some(&shader.program));
    gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(src_tex));
    if let Some(loc) = shader.location(gl, "u_tex") { gl.uniform1i(Some(&loc), 0); }
    if let Some(loc) = shader.location(gl, "u_dstSize") { gl.uniform2f(Some(&loc), tw as f32, th as f32); }
    if let Some(loc) = shader.location(gl, "u_channel") { gl.uniform1i(Some(&loc), channel); }
    engine.draw_fullscreen_quad();

    let mut thumb = vec![0u8; (tw * th * 4) as usize];
    let _ = gl.read_pixels_with_opt_u8_array(
        0, 0, tw as i32, th as i32,
        WebGl2RenderingContext::RGBA,
        WebGl2RenderingContext::UNSIGNED_BYTE,
        Some(&mut thumb),
    );

    gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, None);
    gl.delete_framebuffer(Some(&fbo));
    gl.delete_texture(Some(&thumb_tex));

    let mut result = Vec::with_capacity(8 + thumb.len());
    result.extend_from_slice(&tw.to_le_bytes());
    result.extend_from_slice(&th.to_le_bytes());
    result.extend_from_slice(&thumb);
    result
}

#[cfg(test)]
mod tests {
    use super::thumbnail_size;

    #[test]
    fn small_sources_are_not_upscaled() {
        assert_eq!(thumbnail_size(20, 10, 24), (20, 10));
    }

    #[test]
    fn long_edge_fits_max_size() {
        assert_eq!(thumbnail_size(864, 432, 24), (24, 12));
        assert_eq!(thumbnail_size(100, 4000, 24), (1, 24));
    }
}
