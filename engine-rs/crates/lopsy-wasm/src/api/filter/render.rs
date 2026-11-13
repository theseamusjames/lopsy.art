//! Render filters: pattern fill, color LUT (texture-based filters), sunburst.

use wasm_bindgen::prelude::*;

use crate::Engine;
use crate::filter_gpu;
use crate::gpu::params::filters::{ColorLutParams, PatternFillParams, SunburstParams};

/// `stagger_*` offsets alternate rows / columns (brick, half-drop) and
/// `origin_*` shifts the whole tiling grid; all four are fractions of one tile.
#[wasm_bindgen(js_name = "filterPatternFill")]
#[allow(clippy::too_many_arguments)]
pub fn filter_pattern_fill(
    engine: &mut Engine,
    layer_id: &str,
    pattern_data: &[u8],
    pattern_width: u32,
    pattern_height: u32,
    scale: f32,
    stagger_x: f32,
    stagger_y: f32,
    origin_x: f32,
    origin_y: f32,
) {
    if pattern_width == 0 || pattern_height == 0 || pattern_data.is_empty() {
        return;
    }

    let pattern_handle = match engine.inner.texture_pool.acquire(pattern_width, pattern_height) {
        Ok(h) => h,
        Err(_) => return,
    };
    let _ = engine.inner.texture_pool.upload_rgba(pattern_handle, 0, 0, pattern_width, pattern_height, pattern_data,
    );
    let is_pattern_live = engine.inner.texture_pool.get(pattern_handle).is_some();

    // #848: expand the layer's texture to the doc union before reading its
    // size. A never-painted layer's texture is still the lazy 1x1
    // placeholder at this point — reading layer_w/layer_h before expansion
    // sends u_layerSize=(1,1) to pattern_fill.glsl, which then samples the
    // pattern's very first texel for every fragment instead of tiling it.
    let _ = engine.inner.ensure_layer_full_size(layer_id);

    let tex_handle = match engine.inner.layer_textures.get(layer_id) {
        Some(&h) => h,
        None => {
            engine.inner.texture_pool.release(pattern_handle);
            return;
        }
    };
    let (layer_w, layer_h) = engine.inner.texture_pool.get_size(tex_handle).unwrap_or((1, 1));

    let pw = pattern_width as f32;
    let ph = pattern_height as f32;
    let lw = layer_w as f32;
    let lh = layer_h as f32;
    let scale = scale.max(0.01);

    filter_gpu::apply_filter_with_texture(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.pattern_fill,
        PatternFillParams {
            layer_size: [lw, lh],
            pattern_size: [pw, ph],
            scale,
            stagger: [stagger_x, stagger_y],
            origin: [origin_x, origin_y],
        },
        "u_pattern",
        is_pattern_live.then_some(pattern_handle),
    );

    engine.inner.texture_pool.release(pattern_handle);
}

#[wasm_bindgen(js_name = "filterColorLut")]
pub fn filter_color_lut(
    engine: &mut Engine,
    layer_id: &str,
    lut_data: &[u8],
    lut_size: u32,
    intensity: f32,
) {
    if lut_size == 0 || lut_data.is_empty() {
        return;
    }

    let strip_w = lut_size * lut_size;
    let strip_h = lut_size;

    let lut_handle = match engine.inner.texture_pool.acquire(strip_w, strip_h) {
        Ok(h) => h,
        Err(_) => return,
    };
    let _ = engine.inner.texture_pool.upload_rgba(lut_handle, 0, 0, strip_w, strip_h, lut_data,
    );
    let is_lut_live = engine.inner.texture_pool.get(lut_handle).is_some();
    // The LUT is sampled with interpolation between its texels and must
    // not wrap across the strip's slices.
    engine.inner.texture_pool.set_linear_filter(lut_handle);
    engine.inner.texture_pool.set_clamp_wrap(lut_handle);

    let size_f = lut_size as f32;
    let intensity = intensity.clamp(0.0, 1.0);

    filter_gpu::apply_filter_with_texture(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.color_lut,
        ColorLutParams { lut_size: size_f, intensity },
        "u_lut",
        is_lut_live.then_some(lut_handle),
    );

    engine.inner.texture_pool.release(lut_handle);
}

#[wasm_bindgen(js_name = "extractChannelPixels")]
pub fn extract_channel_pixels(
    engine: &mut Engine,
    layer_id: &str,
    channel: u32,
) -> Vec<u8> {
    filter_gpu::extract_channel_pixels(&mut engine.inner, layer_id, channel)
}

/// GPU-side downscaled thumbnail for a single channel of a layer texture.
///
/// Box-downscales the channel on the GPU into a small RGBA8 texture (each
/// thumbnail pixel averages its whole source footprint), then reads back
/// only the thumbnail-sized pixels.
///
/// Replaces `readLayerAsImageData` + `extractChannelPixels` in
/// ChannelsPanel — those combined to move ~67 MB per channel per
/// pixel-version bump on a 4K layer even though the panel displays 40×20
/// thumbnails (#683).
///
/// Returns 8-byte header [width_u32_le, height_u32_le] + RGBA pixels.
#[wasm_bindgen(js_name = "readChannelThumbnail")]
pub fn read_channel_thumbnail(
    engine: &mut Engine,
    layer_id: &str,
    channel: u32,
    max_size: u32,
) -> Vec<u8> {
    filter_gpu::read_channel_thumbnail(&mut engine.inner, layer_id, channel, max_size)
}

/// Burst origin in layer-texture pixels plus the distance to the farthest
/// document corner. The origin is given as a fraction of the document, so
/// it has to be shifted by the layer's offset — a layer that hangs off the
/// canvas has a texture origin that isn't the document's.
fn sunburst_geometry(
    center_x: f32,
    center_y: f32,
    doc_w: f32,
    doc_h: f32,
    layer_x: f32,
    layer_y: f32,
) -> (f32, f32, f32) {
    let doc_cx = center_x * doc_w;
    let doc_cy = center_y * doc_h;
    let far_x = doc_cx.max(doc_w - doc_cx);
    let far_y = doc_cy.max(doc_h - doc_cy);
    let reach = (far_x * far_x + far_y * far_y).sqrt().max(1.0);
    (doc_cx - layer_x, doc_cy - layer_y, reach)
}

#[wasm_bindgen(js_name = "filterSunburst")]
#[allow(clippy::too_many_arguments)]
pub fn filter_sunburst(
    engine: &mut Engine,
    layer_id: &str,
    rays: u32,
    center_x: f32,
    center_y: f32,
    rotation_degrees: f32,
    length: f32,
    width: f32,
    taper: f32,
    fade: f32,
    softness: f32,
    jitter: f32,
    seed: f32,
    ray_r: f32,
    ray_g: f32,
    ray_b: f32,
    ray_a: f32,
    fill_gaps: bool,
    gap_r: f32,
    gap_g: f32,
    gap_b: f32,
) {
    // The shader needs the texture's pixel size and the layer offset, both
    // of which change when the layer is expanded to cover the document.
    // apply_filter expands too, but only after we'd have read them.
    let _ = engine.inner.ensure_layer_full_size(layer_id);
    let tex_handle = match engine.inner.layer_textures.get(layer_id) {
        Some(&h) => h,
        None => return,
    };
    let (w, h) = engine.inner.texture_pool.get_size(tex_handle).unwrap_or((1, 1));
    let (layer_x, layer_y) = engine.inner.layer_stack.iter()
        .find(|l| l.id == layer_id)
        .map(|l| (l.x as f32, l.y as f32))
        .unwrap_or((0.0, 0.0));
    let (cx, cy, reach) = sunburst_geometry(
        center_x.clamp(0.0, 1.0),
        center_y.clamp(0.0, 1.0),
        engine.inner.doc_width as f32,
        engine.inner.doc_height as f32,
        layer_x,
        layer_y,
    );

    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.sunburst,
        SunburstParams {
            size: [w as f32, h as f32],
            center: [cx, cy],
            reach,
            rays: rays.max(3) as f32,
            rotation: rotation_degrees.to_radians(),
            length: length.max(0.0),
            width: width.clamp(0.0, 1.0),
            taper: taper.clamp(0.0, 1.0),
            fade: fade.clamp(0.0, 1.0),
            softness: softness.clamp(0.0, 1.0),
            jitter: jitter.clamp(0.0, 1.0),
            seed,
            ray_color: [ray_r, ray_g, ray_b, ray_a.clamp(0.0, 1.0)],
            fill_gaps: if fill_gaps { 1 } else { 0 },
            gap_color: [gap_r, gap_g, gap_b],
        },
    );
}

#[cfg(test)]
mod tests {
    use super::sunburst_geometry;

    #[test]
    fn centered_burst_reaches_the_corners() {
        let (cx, cy, reach) = sunburst_geometry(0.5, 0.5, 400.0, 300.0, 0.0, 0.0);
        assert_eq!((cx, cy), (200.0, 150.0));
        assert!((reach - 250.0).abs() < 1e-3);
    }

    #[test]
    fn corner_burst_reaches_the_opposite_corner() {
        let (_, _, reach) = sunburst_geometry(0.0, 1.0, 300.0, 400.0, 0.0, 0.0);
        assert!((reach - 500.0).abs() < 1e-3);
    }

    #[test]
    fn origin_is_shifted_into_layer_texture_space() {
        let (cx, cy, _) = sunburst_geometry(0.5, 0.5, 400.0, 300.0, -50.0, -20.0);
        assert_eq!((cx, cy), (250.0, 170.0));
    }
}
