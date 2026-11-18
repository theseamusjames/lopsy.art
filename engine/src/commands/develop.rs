//! Commands of the proof-of-concept RAW develop stage (`crate::develop`):
//! set or clear a document's develop settings. The settings are data read
//! by the compositor every frame; no layer pixels change.

use lopsy_core::{color_mixer, develop_stats};
use lopsy_core::raf::develop::RawDevelopSettings;

use crate::document::{compositor, thumbnail_gpu};
use crate::gpu::read::Read;

use crate::develop::{curve_texels, RawDevelopState, CURVE_WIDTH};
use crate::engine::EngineInner;

/// Develop the composite with `settings` from the next frame on. Uploads
/// the base curve as a small LUT texture, reusing the previous one when it
/// is the same size.
pub fn set_raw_develop(engine: &mut EngineInner, settings: RawDevelopSettings) -> Result<(), String> {
    let finite = settings.wb_ratio.iter().chain(&settings.cam_to_rgb).all(|v| v.is_finite())
        && settings.exposure_ev.is_finite()
        && settings.saturation.is_finite();
    if !finite {
        return Err("Raw develop settings must be finite numbers".to_string());
    }
    let curve = settings.base_curve.as_deref().filter(|c| !c.is_empty());
    if let Some(c) = curve {
        if c.len() < 2 || c.len() > 65_536 || !c.iter().all(|v| v.is_finite()) {
            return Err(format!("Raw develop base curve needs 2 to 65536 finite entries, got {}", c.len()));
        }
    }

    let previous = engine.raw_develop.take();
    let mut old_texture = previous.as_ref().and_then(|p| p.curve_texture);
    let old_rows = previous.as_ref().map(|p| p.curve_size.div_ceil(CURVE_WIDTH));

    let mut curve_texture = None;
    let mut curve_size = 0;
    if let Some(c) = curve {
        let (texels, rows) = curve_texels(c);
        let reusable = old_texture.filter(|&t| old_rows == Some(rows) && engine.texture_pool.get(t).is_some());
        let texture = match reusable {
            Some(t) => {
                old_texture = None;
                t
            }
            None => match engine.texture_pool.acquire(CURVE_WIDTH, rows) {
                Ok(t) => t,
                Err(e) => {
                    // Keep the previous stage (and its texture) as it was.
                    engine.raw_develop = previous;
                    return Err(e);
                }
            },
        };
        if let Err(e) = engine.texture_pool.upload_rgba_f32(texture, 0, 0, CURVE_WIDTH, rows, &texels) {
            engine.texture_pool.release(texture);
            if let Some(t) = old_texture {
                engine.texture_pool.release(t);
            }
            engine.needs_recomposite = true;
            return Err(e);
        }
        curve_texture = Some(texture);
        curve_size = c.len() as u32;
    }
    if let Some(t) = old_texture {
        engine.texture_pool.release(t);
    }

    engine.raw_develop = Some(RawDevelopState { settings, curve_texture, curve_size });
    engine.needs_recomposite = true;
    Ok(())
}

/// Stop developing: the composite is shown as its layers hold it.
pub fn clear_raw_develop(engine: &mut EngineInner) {
    if let Some(texture) = engine.raw_develop.take().and_then(|d| d.curve_texture) {
        engine.texture_pool.release(texture);
    }
    engine.needs_recomposite = true;
}

/// Color by hue on the composite, after the image adjustments: 24 values,
/// (hue, saturation, luminance) per band in −100..100, bands in the order
/// red, orange, yellow, green, aqua, blue, purple, magenta
/// (`lopsy_core::color_mixer`).
pub fn set_image_color_mixer(engine: &mut EngineInner, values: &[f32]) -> Result<(), String> {
    let values: [f32; color_mixer::VALUES_LEN] = values
        .try_into()
        .map_err(|_| format!("Color mixer values must be exactly {} floats", color_mixer::VALUES_LEN))?;
    if !values.iter().all(|v| v.is_finite()) {
        return Err("Color mixer values must be finite".to_string());
    }
    engine.color_mixer = Some(values.map(|v| v.clamp(-100.0, 100.0)));
    engine.needs_recomposite = true;
    Ok(())
}

/// Stop the color mixer: the composite is shown without it.
pub fn clear_image_color_mixer(engine: &mut EngineInner) {
    engine.color_mixer = None;
    engine.needs_recomposite = true;
}

/// Sharpening and noise reduction: `[amount 0..150, radius 0.5..3 (full-
/// resolution px), edges 0..100, nrLuminance 0..100, nrColor 0..100,
/// nrDetail 0..100, pixelScale (working width / full width)]`, clamped.
/// See `lopsy_core::detail` for where and how they run.
pub fn set_image_detail(engine: &mut EngineInner, values: &[f32]) -> Result<(), String> {
    engine.detail = Some(lopsy_core::detail::DetailSettings::from_values(values)?);
    engine.needs_recomposite = true;
    Ok(())
}

pub fn clear_image_detail(engine: &mut EngineInner) {
    engine.detail = None;
    engine.needs_recomposite = true;
}

/// Large details, small details and haze: `[large, small, haze (each
/// −100..100), pixelScale]`, clamped.
pub fn set_image_local_contrast(engine: &mut EngineInner, values: &[f32]) -> Result<(), String> {
    engine.local_contrast = Some(lopsy_core::detail::LocalContrastSettings::from_values(values)?);
    engine.needs_recomposite = true;
    Ok(())
}

pub fn clear_image_local_contrast(engine: &mut EngineInner) {
    engine.local_contrast = None;
    engine.needs_recomposite = true;
}

/// Areas: `lopsy_core::areas::STRIDE` (16) floats per area, at most 8;
/// the layout is in `lopsy_core::areas`. An empty slice is the same as
/// `clear_image_areas`.
pub fn set_image_areas(engine: &mut EngineInner, values: &[f32]) -> Result<(), String> {
    let (areas, clamped) = lopsy_core::areas::parse_areas(values)?;
    engine.areas = if areas.is_empty() { None } else { Some(clamped) };
    engine.needs_recomposite = true;
    Ok(())
}

pub fn clear_image_areas(engine: &mut EngineInner) {
    engine.areas = None;
    engine.area_overlay = -1;
    engine.needs_recomposite = true;
}

/// Show area `index`'s mask in red on screen (never in exports); −1, or an
/// index with no area, shows none.
pub fn set_image_area_overlay(engine: &mut EngineInner, index: i32) {
    engine.area_overlay = index.max(-1);
    engine.needs_recomposite = true;
}

/// Mark clipped pixels on the live frame (never in exports): shadows in
/// blue where any channel is at or below 0, highlights in red where any is
/// at or above 1, after the whole develop chain.
pub fn set_clipping_warning(engine: &mut EngineInner, shadows: bool, highlights: bool) {
    engine.clipping_warning = (shadows, highlights);
    engine.needs_recomposite = true;
}

/// The white balance that makes the patch of `radius` document pixels
/// around (`x`, `y`) neutral, as `[temperature, tint]` in the Photos
/// recipe's units (`lopsy_core::develop_stats::neutral_temperature_tint`).
/// The patch is read from the document's layers composited without the
/// RAW develop stage or any adjustment: for a RAW document, camera RGB at
/// the as-shot balance, so the answer is absolute; otherwise the encoded
/// pixels, so it is the shift that neutralizes them. Changes nothing in
/// the document; the next frame rebuilds the live composite.
pub fn sample_neutral_white_balance(engine: &mut EngineInner, x: f32, y: f32, radius: f32) -> Read<Vec<f32>> {
    let (w, h) = (engine.doc_width as i32, engine.doc_height as i32);
    if !(x.is_finite() && y.is_finite() && radius.is_finite()) || w == 0 || h == 0 {
        return Read::failed("Sample position must be finite numbers inside a document".to_string());
    }
    let r = radius.clamp(0.0, 64.0).round() as i32;
    let (cx, cy) = (x.floor() as i32, y.floor() as i32);
    let (x0, y0) = ((cx - r).clamp(0, w - 1), (cy - r).clamp(0, h - 1));
    let (x1, y1) = ((cx + r).clamp(0, w - 1), (cy + r).clamp(0, h - 1));
    if let Err(e) = compositor::composite_layers_only(engine) {
        return Read::failed(e);
    }
    let is_raw = engine.raw_develop.is_some();
    let (pw, ph) = ((x1 - x0 + 1) as u32, (y1 - y0 + 1) as u32);
    engine
        .gpu()
        .read_rgba_u16(engine.composite_texture, x0, y0, pw, ph)
        .map(move |px| develop_stats::neutral_temperature_tint(&px, is_raw).to_vec())
}

/// Long edge of the downscaled copy the histogram is counted from.
pub const HISTOGRAM_MAX_EDGE: u32 = 512;

/// The histogram of what the user sees: the composite after the RAW
/// develop stage and the image adjustments (before the final blit),
/// box-downscaled on the GPU to at most `HISTOGRAM_MAX_EDGE` on its long
/// edge, read back as RGBA8 and binned on the CPU into 4 × 256 bins: red,
/// green, blue, then Rec. 709 luminance of the encoded values
/// (`lopsy_core::develop_stats`). Draws the frame first if it is stale.
/// Changes nothing in the document. A Lab document's composite is encoded
/// Lab, so its bins are not RGB.
pub fn read_develop_histogram(engine: &mut EngineInner) -> Read<Vec<u32>> {
    if engine.needs_recomposite {
        compositor::render(engine);
    }
    let composite = engine.composite_texture;
    if engine.texture_pool.get(composite).is_none() {
        return Read::ready(Ok(vec![0; develop_stats::HISTOGRAM_LEN]));
    }
    let (w, h) = (engine.doc_width, engine.doc_height);
    thumbnail_gpu::read_box_thumbnail(&*engine, composite, w, h, HISTOGRAM_MAX_EDGE, thumbnail_gpu::COLOUR)
        .map(|thumb| develop_stats::histogram_from_rgba8(thumb.get(8..).unwrap_or(&[])))
}

/// `set_raw_develop` with the settings as the JSON `setRawDevelop` takes.
pub fn set_raw_develop_json(engine: &mut EngineInner, json: &str) -> Result<(), String> {
    let settings: RawDevelopSettings =
        serde_json::from_str(json).map_err(|e| format!("Raw develop settings: {e}"))?;
    set_raw_develop(engine, settings)
}
