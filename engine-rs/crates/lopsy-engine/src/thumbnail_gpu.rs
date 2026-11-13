//! Box-filtered thumbnails for the Layers, Channels and Navigator panels.
//!
//! Each thumbnail pixel averages its whole source footprint on the GPU
//! (`thumbnail_box.glsl`) and only the thumbnail is read back. A plain
//! LINEAR blit sampled one 2x2 neighbourhood per thumbnail pixel, so a fine
//! regular pattern aliased: a grid whose period matched the stride showed
//! only its lines.

use crate::engine::EngineInner;
use crate::gpu::pass::ReadFormat;
use crate::gpu::texture_pool::TextureHandle;
use crate::gpu::params::core::ThumbnailBoxParams;

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

/// Box-downscale `src` (`w`×`h`, straight alpha) to fit `max_size` and
/// read it back. `channel` is [`COLOUR`] or 0..3 for R, G, B, A as grey.
///
/// Returns an 8-byte header `[width_u32_le, height_u32_le]` + RGBA8 pixels,
/// or an empty vector when the GPU objects cannot be created.
pub fn read_box_thumbnail(
    engine: &EngineInner,
    src: TextureHandle,
    w: u32,
    h: u32,
    max_size: u32,
    channel: i32,
) -> Vec<u8> {
    if w == 0 || h == 0 {
        return Vec::new();
    }
    let (tw, th) = thumbnail_size(w, h, max_size);

    let Some(thumb) = engine.pass(&engine.shaders.thumbnail_box, ThumbnailBoxParams { dst_size: [tw as f32, th as f32], channel })
        .texture("u_tex", src)
        .read_back(ReadFormat::Rgba8, tw, th)
    else {
        return Vec::new();
    };

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
