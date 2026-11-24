//! Commands of the proof-of-concept RAW develop stage (`crate::develop`):
//! set or clear a document's develop settings. The settings are data read
//! by the compositor every frame; no layer pixels change.

use lopsy_core::{color_mixer, develop_stats};
use lopsy_core::raf::develop::RawDevelopSettings;

use crate::document::{compositor, thumbnail_gpu};
use crate::gpu::read::Read;

use crate::develop::working_space::WorkingSpace;
use crate::develop::{curve_texels, RawDevelopState, CURVE_WIDTH};
use lopsy_core::working_space::SourceEncoding;
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

/// Turn the develop working space on or off (`develop::working_space`).
/// On, the chain holds linear Rec. 2020 from the RAW step (with a RAW
/// develop state) or the input step (without one) to the output step, and
/// the live frame, the exports and the statistics go through the output
/// step. `source` says how the composite is encoded when there is no RAW
/// develop state: 0 sRGB, 1 Display P3. Off, everything is as it was.
/// Turning it on fails, leaving it off, when the texture pool is 8-bit
/// (WebGL without `EXT_color_buffer_float`): the linear chain would clip
/// to 0..1 at 8 bits there. Turning it off always succeeds.
pub fn set_develop_working_space(engine: &mut EngineInner, on: bool, source: u8) -> Result<(), String> {
    let rendered = engine.working_space.and_then(|ws| ws.rendered);
    if on {
        crate::gpu::require_float_pool(engine.texture_pool.use_float(), "The develop working space")?;
    }
    if !on {
        if let Some(texture) = rendered {
            engine.texture_pool.release(texture);
        }
        engine.working_space = None;
        engine.needs_recomposite = true;
        return Ok(());
    }
    let source = SourceEncoding::from_code(source)?;
    engine.working_space = Some(WorkingSpace { source, rendered });
    engine.needs_recomposite = true;
    Ok(())
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
/// −100..100), pixelScale]`, clamped. With the working space, haze acts on
/// scene data before the tone pass and the two details on rendered data
/// after it (`lopsy_core::linear_detail`); without it, all three on encoded
/// values (`lopsy_core::detail`).
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
    engine.clear_area_layers();
    engine.area_overlay = -1;
    engine.needs_recomposite = true;
}

// An area's layer (`lopsy_core::areas`, "An area's layer"): after the areas
// pass, the image is run through the document's develop stages again with
// the area's own settings, and the result is laid over the image through
// the area's mask. `index` is the area's place in `set_image_areas`
// (0..`MAX_AREAS`). What is set stays until `clear_image_area_layer`,
// `clear_image_area_layers` or `clear_image_areas`: a host that changes
// which area is at an index clears and sets them again.

/// Area `index`'s layer, made if it has none yet.
fn area_layer(engine: &mut EngineInner, index: u32) -> Result<&mut crate::engine::AreaLayer, String> {
    let index = index as usize;
    if index >= lopsy_core::areas::MAX_AREAS {
        return Err(format!("Area index must be below {}", lopsy_core::areas::MAX_AREAS));
    }
    if engine.area_layers.len() <= index {
        engine.area_layers.resize(index + 1, None);
    }
    engine.needs_recomposite = true;
    Ok(engine.area_layers[index].get_or_insert_with(Default::default))
}

/// Whites, blacks and vibrance of area `index`'s layer, −100..100 each as
/// `set_image_whites`, `set_image_blacks` and `set_image_vibrance` take them.
pub fn set_image_area_tone(engine: &mut EngineInner, index: u32, whites: f32, blacks: f32, vibrance: f32) -> Result<(), String> {
    if ![whites, blacks, vibrance].iter().all(|v| v.is_finite()) {
        return Err("Area tone values must be finite".to_string());
    }
    let layer = area_layer(engine, index)?;
    layer.adjustments.whites = whites;
    layer.adjustments.blacks = blacks;
    layer.adjustments.vibrance = vibrance;
    Ok(())
}

/// The curves of area `index`'s layer: the packed 256×4 LUT of
/// `set_image_curves_lut`. Its texture is the layer's until the layer is cleared.
pub fn set_image_area_curves_lut(engine: &mut EngineInner, index: u32, lut: &[u8]) -> Result<(), String> {
    if lut.len() != 256 * 4 {
        return Err("Curves LUT must be exactly 256 * 4 bytes".to_string());
    }
    let existing = area_layer(engine, index)?.adjustments.curves_texture;
    let tex = match existing {
        Some(tex) => tex,
        None => engine.texture_pool.acquire(256, 1)?,
    };
    if let Err(e) = engine.texture_pool.upload_rgba(tex, 0, 0, 256, 1, lut) {
        if existing.is_none() {
            engine.texture_pool.release(tex);
        }
        return Err(e);
    }
    let layer = area_layer(engine, index)?;
    layer.adjustments.curves_texture = Some(tex);
    layer.adjustments.has_curves = true;
    Ok(())
}

/// Colour grading of area `index`'s layer, with the 18-float block of
/// `set_image_color_grading`.
pub fn set_image_area_color_grading(engine: &mut EngineInner, index: u32, values: &[f32]) -> Result<(), String> {
    if values.len() != 18 {
        return Err("Color grading values must be exactly 18 floats".to_string());
    }
    if !values.iter().all(|v| v.is_finite()) {
        return Err("Color grading values must be finite".to_string());
    }
    let adj = &mut area_layer(engine, index)?.adjustments;
    let wheel = |i: usize| [values[i], values[i + 1], values[i + 2], values[i + 3]];
    adj.cg_shadows = wheel(0);
    adj.cg_midtones = wheel(4);
    adj.cg_highlights = wheel(8);
    adj.cg_global = wheel(12);
    adj.cg_exponent = values[16];
    adj.cg_width = values[17];
    adj.cg_enabled = true;
    Ok(())
}

/// Color by hue of area `index`'s layer: the 24 values of `set_image_color_mixer`.
pub fn set_image_area_color_mixer(engine: &mut EngineInner, index: u32, values: &[f32]) -> Result<(), String> {
    let values: [f32; color_mixer::VALUES_LEN] = values
        .try_into()
        .map_err(|_| format!("Color mixer values must be exactly {} floats", color_mixer::VALUES_LEN))?;
    if !values.iter().all(|v| v.is_finite()) {
        return Err("Color mixer values must be finite".to_string());
    }
    area_layer(engine, index)?.color_mixer = Some(values.map(|v| v.clamp(-100.0, 100.0)));
    Ok(())
}

/// Sharpening and noise reduction of area `index`'s layer: the values of `set_image_detail`.
pub fn set_image_area_detail(engine: &mut EngineInner, index: u32, values: &[f32]) -> Result<(), String> {
    let settings = lopsy_core::detail::DetailSettings::from_values(values)?;
    area_layer(engine, index)?.detail = Some(settings);
    Ok(())
}

/// Large details, small details and haze of area `index`'s layer: the values
/// of `set_image_local_contrast`. The blurs are of the image as the area's
/// layer receives it, after the document's own edits.
pub fn set_image_area_local_contrast(engine: &mut EngineInner, index: u32, values: &[f32]) -> Result<(), String> {
    let settings = lopsy_core::detail::LocalContrastSettings::from_values(values)?;
    area_layer(engine, index)?.local_contrast = Some(settings);
    Ok(())
}

/// Vignette and grain of area `index`'s layer: the values of `set_image_finish`.
pub fn set_image_area_finish(engine: &mut EngineInner, index: u32, values: &[f32]) -> Result<(), String> {
    let settings = lopsy_core::finish::FinishSettings::from_values(values)?;
    area_layer(engine, index)?.finish = Some(settings);
    Ok(())
}

/// Area `index`'s layer off: the area keeps its mask and built-in adjustments.
pub fn clear_image_area_layer(engine: &mut EngineInner, index: u32) {
    engine.clear_area_layer(index as usize);
    engine.needs_recomposite = true;
}

/// Every area's layer off.
pub fn clear_image_area_layers(engine: &mut EngineInner) {
    engine.clear_area_layers();
    engine.needs_recomposite = true;
}

/// Show area `index`'s mask in red on screen (never in exports); −1, or an
/// index with no area, shows none.
pub fn set_image_area_overlay(engine: &mut EngineInner, index: i32) {
    engine.area_overlay = index.max(-1);
    engine.needs_recomposite = true;
}

/// The shaped vignette and grain (`lopsy_core::finish`): 9 floats
/// `[vignetteAmount −100..100, size 0..100, roundness −100..100,
/// feather 0..100, grainAmount 0..100, grainSize 0..100,
/// grainRoughness 0..100, seed, pixelScale]`, clamped.
pub fn set_image_finish(engine: &mut EngineInner, values: &[f32]) -> Result<(), String> {
    engine.finish = Some(lopsy_core::finish::FinishSettings::from_values(values)?);
    engine.needs_recomposite = true;
    Ok(())
}

pub fn clear_image_finish(engine: &mut EngineInner) {
    engine.finish = None;
    engine.needs_recomposite = true;
}

/// Show the sharpening edge mask as grey on the live frame (white where it
/// sharpens fully) while `on`, for Alt-drag on the sharpening sliders. Needs
/// detail settings; never in exports.
pub fn set_image_detail_mask_view(engine: &mut EngineInner, on: bool) {
    engine.detail_mask_view = on;
    engine.needs_recomposite = true;
}

/// Mark clipped pixels on the live frame (never in exports): shadows in
/// blue where any channel is at or below 0, highlights in red where any is
/// at or above 1, after the whole develop chain. With the working space it
/// runs on the screen's output, where every channel is inside 0..1, and
/// marks what shows as 0 or 255; in the HDR view (`set_develop_hdr`) the
/// top is the peak, not white, so it marks what clips at the peak.
pub fn set_clipping_warning(engine: &mut EngineInner, shadows: bool, highlights: bool) {
    engine.clipping_warning = (shadows, highlights);
    engine.needs_recomposite = true;
}

/// The white balance that makes the patch of `radius` document pixels
/// around (`x`, `y`) neutral, as `[temperature, tint]` in the Photonamous
/// recipe's units (`lopsy_core::develop_stats::neutral_temperature_tint`).
/// The patch is read from the document's layers composited without the
/// RAW develop stage or any adjustment: for a RAW document, camera RGB at
/// the as-shot balance, so the answer is absolute; otherwise the encoded
/// pixels, so it is the shift that neutralizes them. A RAW photo whose
/// settings carry `clipLevels` has its clipped and reconstructed pixels
/// left out of the measurement. Changes nothing in
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
    // A RAW photo's clipped and reconstructed pixels are not measurements.
    let clip = engine.raw_develop.as_ref().and_then(|state| state.settings.clip_levels);
    let (pw, ph) = ((x1 - x0 + 1) as u32, (y1 - y0 + 1) as u32);
    engine
        .gpu()
        .read_rgba_u16(engine.composite_texture, x0, y0, pw, ph)
        .map(move |px| develop_stats::neutral_temperature_tint_clipped(&px, is_raw, clip).to_vec())
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
///
/// With the working space it counts the image as the output step renders
/// it for sRGB (`compositor::statistics_image`), whatever the screen is,
/// and without the screen-only views, so the histogram and Auto tone do
/// not depend on the display.
pub fn read_develop_histogram(engine: &mut EngineInner) -> Read<Vec<u32>> {
    if engine.needs_recomposite {
        compositor::render(engine);
    }
    let composite = compositor::statistics_image(engine, None).unwrap_or(engine.composite_texture);
    if engine.texture_pool.get(composite).is_none() {
        return Read::ready(Ok(vec![0; develop_stats::HISTOGRAM_LEN]));
    }
    let (w, h) = (engine.doc_width, engine.doc_height);
    thumbnail_gpu::read_box_thumbnail(&*engine, composite, w, h, HISTOGRAM_MAX_EDGE, thumbnail_gpu::COLOUR)
        .map(|thumb| develop_stats::histogram_from_rgba8(thumb.get(8..).unwrap_or(&[])))
}

/// The histogram of the HDR rendering, for the region right of white: the
/// last live frame's rendered image through the HDR output for the HDR
/// canvas in sRGB primaries with highlights up to `peak` (units of SDR
/// white), whatever the screen is and without the screen-only views,
/// box-downscaled on the GPU to at most `HISTOGRAM_MAX_EDGE` on its long
/// edge, read as floats and binned on the CPU
/// (`lopsy_core::output::hdr_histogram`): 4 × 256 bins, red, green, blue,
/// then Rec. 709 luminance of the encoded values, over the encoded range
/// from black (bin 0) to the peak (bin 255), with white at
/// `lopsy_core::output::hdr_histogram_white_bin(peak)`. Draws the frame
/// first if it is stale. Fails without the working space. Changes nothing
/// in the document; `read_develop_histogram` and Auto tone are untouched.
pub fn read_hdr_histogram(engine: &mut EngineInner, peak: f32) -> Read<Vec<u32>> {
    if engine.working_space.is_none() {
        return Read::failed("The document has no working space".to_string());
    }
    if engine.needs_recomposite {
        compositor::render(engine);
    }
    let peak = lopsy_core::output::hdr_peak(peak);
    let Some(image) = compositor::hdr_statistics_image(engine, peak) else {
        return Read::failed("No frame has been rendered in the working space".to_string());
    };
    let (tw, th) = thumbnail_gpu::thumbnail_size(engine.doc_width, engine.doc_height, HISTOGRAM_MAX_EDGE);
    let thumb = match engine.texture_pool.acquire(tw, th) {
        Ok(t) => t,
        Err(e) => return Read::failed(e),
    };
    let params = crate::gpu::params::core::ThumbnailBoxParams { dst_size: [tw as f32, th as f32], channel: thumbnail_gpu::COLOUR };
    engine
        .pass(&engine.shaders.thumbnail_box, params)
        .texture("u_tex", image)
        .draw(crate::gpu::pass::Target::Texture(thumb));
    engine.gpu().unbind_textures(1);
    let read = engine.gpu().read_rgba_f32(thumb, 0, 0, tw, th).map(move |pixels| lopsy_core::output::hdr_histogram(&pixels, peak));
    engine.texture_pool.release(thumb);
    read
}

/// `set_raw_develop` with the settings as the JSON `setRawDevelop` takes.
pub fn set_raw_develop_json(engine: &mut EngineInner, json: &str) -> Result<(), String> {
    let settings: RawDevelopSettings =
        serde_json::from_str(json).map_err(|e| format!("Raw develop settings: {e}"))?;
    set_raw_develop(engine, settings)
}

/// The last live frame's rendered image, the working space's linear
/// Rec. 2020 before the output step: straight-alpha RGBA as 32-bit floats,
/// `doc_width × doc_height` texels row by row from the top, unclamped (1.0
/// is white; above it is HDR headroom). Draws the frame first if it is
/// stale. Fails without the working space. Changes nothing in the document.
pub fn read_rendered_f32(engine: &mut EngineInner) -> Read<Vec<f32>> {
    if engine.working_space.is_none() {
        return Read::failed("The document has no working space".to_string());
    }
    if engine.needs_recomposite {
        compositor::render(engine);
    }
    let Some(rendered) = engine.working_space.and_then(|ws| ws.rendered) else {
        return Read::failed("No frame has been rendered in the working space".to_string());
    };
    let (w, h) = (engine.doc_width, engine.doc_height);
    engine.gpu().read_rgba_f32(rendered, 0, 0, w, h)
}

/// The HDR view of the live frame: `on` renders the working space's live
/// frame for the HDR canvas with highlights up to `peak` (units of SDR
/// white: 4.0 is two stops above it; clamped to 1..=64, a value that is
/// not a number is the default 4.0) while the screen is HDR
/// (`EngineInner::screen_is_hdr`); off shows the SDR rendering, as an
/// ordinary screen will, without reconfiguring the canvas. On a screen that
/// is not HDR it changes nothing on screen. Lopsy, without the working
/// space, is never affected.
pub fn set_develop_hdr(engine: &mut EngineInner, on: bool, peak: f32) {
    let view = crate::develop::output::HdrView { on, peak: lopsy_core::output::hdr_peak(peak) };
    if engine.develop_hdr != view {
        engine.develop_hdr = view;
        engine.needs_recomposite = true;
    }
}

/// The HDR rendering of the document for a file
/// (`compositor::composite_for_export_hdr_f32`): the whole export chain at
/// the document's size, then the output step for linear Rec. 2020 with
/// highlights up to `peak` (units of SDR white). `doc_width × doc_height`
/// straight-alpha RGBA f32 texels, rows from the top; 1.0 is SDR white.
/// Fails without the working space. The next frame rebuilds the live
/// composite.
pub fn read_hdr_output_f32(engine: &mut EngineInner, peak: f32) -> Read<Vec<f32>> {
    compositor::composite_for_export_hdr_f32(engine, peak)
}

// ---------------------------------------------------------------------------
// Tone, colour and curves on linear data (with the working space)
// ---------------------------------------------------------------------------
//
// These drive the tone pass (`develop::tone`, `lopsy_core::scene_tone`) and
// the look pass (`develop::look`, `lopsy_core::look`), which run only with
// the working space. Lopsy's image adjustments, the old colour by hue and
// the old areas pass do not run with it, so their setters change nothing
// then; these replace them. All zeros is the identity.

/// Tone on scene data: `lopsy_core::scene_tone::ToneSliders::parse`'s 8
/// floats (exposure EV, temperature, tint, contrast, highlights, shadows,
/// whites, blacks; recipe units). For a RAW photo, send exposure,
/// temperature and tint as 0: the RAW step applies the photo's own.
pub fn set_develop_tone(engine: &mut EngineInner, values: &[f32]) -> Result<(), String> {
    let sliders = lopsy_core::scene_tone::ToneSliders::parse(values)?;
    engine.develop_tone = (!sliders.is_identity()).then_some(sliders);
    engine.needs_recomposite = true;
    Ok(())
}

/// Colour on rendered linear data: `lopsy_core::look::LookSettings::parse`'s
/// 44 floats (vibrance, saturation, Color by hue's 24, the grade's 18).
pub fn set_develop_look(engine: &mut EngineInner, values: &[f32]) -> Result<(), String> {
    let look = lopsy_core::look::LookSettings::parse(values)?;
    engine.develop_look = (!look.is_identity()).then_some(look);
    engine.needs_recomposite = true;
    Ok(())
}

/// Which of the four tables in `values` are not the identity, or why
/// `values` are not curves. Setters call it before touching the curves in
/// effect, so values that are not curves leave those in place.
fn curves_on(values: &[f32]) -> Result<[bool; 4], String> {
    Ok(lopsy_core::look::parse_curves(values)?.map(|t| t.is_some()))
}

/// Four curve tables (`values`, already checked by `curves_on`) as a
/// texture, reusing `existing` when there is one. Returns `None` when every
/// table is the identity, and releases `existing` then. A failed upload
/// releases the texture and returns the error: the curves are off then.
fn upload_curves(
    engine: &mut EngineInner,
    existing: Option<crate::develop::look::CurvesState>,
    values: &[f32],
    on: [bool; 4],
) -> Result<Option<crate::develop::look::CurvesState>, String> {
    use crate::develop::look::{curve_texels, CurvesState, CURVE_ROWS};
    let reusable = existing.map(|c| c.texture).filter(|&t| engine.texture_pool.get(t).is_some());
    if !on.iter().any(|&o| o) {
        if let Some(old) = reusable {
            engine.texture_pool.release(old);
        }
        return Ok(None);
    }
    let texture = match reusable {
        Some(t) => t,
        None => engine.texture_pool.acquire(CURVE_WIDTH, CURVE_ROWS)?,
    };
    if let Err(e) = engine.texture_pool.upload_rgba_f32(texture, 0, 0, CURVE_WIDTH, CURVE_ROWS, &curve_texels(values)) {
        engine.texture_pool.release(texture);
        return Err(e);
    }
    Ok(Some(CurvesState { texture, on }))
}

/// Curves on rendered linear data: 4 × 4096 floats, master, red, green,
/// blue, each table over encoded 0..1 (`lopsy_core::look`). Values that
/// are not curves (the wrong length, or not finite) are an error and leave
/// the curves in effect as they were; a failed upload turns them off.
pub fn set_develop_curves(engine: &mut EngineInner, values: &[f32]) -> Result<(), String> {
    let on = curves_on(values)?;
    let existing = engine.develop_curves.take();
    engine.needs_recomposite = true;
    engine.develop_curves = upload_curves(engine, existing, values, on)?;
    Ok(())
}

pub fn clear_develop_curves(engine: &mut EngineInner) {
    if let Some(curves) = engine.develop_curves.take() {
        engine.texture_pool.release(curves.texture);
    }
    engine.needs_recomposite = true;
}

/// Tone, look and curves all off.
pub fn clear_develop_adjustments(engine: &mut EngineInner) {
    engine.develop_tone = None;
    engine.develop_look = None;
    clear_develop_curves(engine);
}

/// Floats in `set_develop_area_look`.
pub const AREA_LOOK_LEN: usize = 3 + color_mixer::VALUES_LEN + lopsy_core::look::GRADING_LEN;

/// Area `index`'s layer with the working space: 45 floats, whites, blacks
/// and vibrance (−100..100, blended through the area's mask in the tone and
/// look passes), then Color by hue's 24 and a grade's 18 (run over a copy
/// and laid back through the mask).
pub fn set_develop_area_look(engine: &mut EngineInner, index: u32, values: &[f32]) -> Result<(), String> {
    if values.len() != AREA_LOOK_LEN {
        return Err(format!("Area look needs {AREA_LOOK_LEN} floats, got {}", values.len()));
    }
    if !values[..2].iter().all(|v| v.is_finite()) {
        return Err("Area look values must be finite".to_string());
    }
    let settings = lopsy_core::look::LookSettings::parse_parts(values[2], 0.0, &values[3..27], &values[27..])?;
    let tone = lopsy_core::scene_tone::AreaTone { whites: values[0].clamp(-100.0, 100.0), blacks: values[1].clamp(-100.0, 100.0) };
    area_layer(engine, index)?.look = Some(crate::develop::look::AreaLook { tone, settings });
    Ok(())
}

/// The scene image's luminance statistics for Auto tone
/// (`lopsy_core::scene_stats`): the scene linear Rec. 2020 image after the
/// RAW or input step, before the tone pass, box-downscaled to
/// `SCENE_STATS_EDGE` on its long edge, measured as
/// `scene_stats::scene_statistics` says. For a photo that is not RAW the
/// photo's own exposure (`set_develop_tone`) is added, so for either kind
/// the statistics are of the scene with the current exposure applied.
/// Renders a live frame to read it. Fails without the working space.
pub fn read_scene_statistics(engine: &mut EngineInner) -> Read<Vec<f32>> {
    use lopsy_core::scene_stats::{scene_statistics, SCENE_STATS_EDGE};
    if engine.working_space.is_none() {
        return Read::failed("The document has no working space".to_string());
    }
    let (tw, th) = thumbnail_gpu::thumbnail_size(engine.doc_width, engine.doc_height, SCENE_STATS_EDGE);
    let texture = match engine.texture_pool.acquire(tw, th) {
        Ok(t) => t,
        Err(e) => return Read::failed(e),
    };
    engine.scene_capture = Some(texture);
    engine.needs_recomposite = true;
    compositor::render(engine);
    engine.scene_capture = None;
    let shift = if engine.raw_develop.is_some() { 0.0 } else { engine.develop_tone.map_or(0.0, |t| t.exposure) };
    let read = engine.gpu().read_rgba_f32(texture, 0, 0, tw, th).map(move |pixels| {
        let mut stats = scene_statistics(&pixels);
        if stats[0] > 0.0 {
            for v in &mut stats[1..] {
                *v += shift;
            }
        }
        stats.to_vec()
    });
    engine.texture_pool.release(texture);
    read
}

/// Area `index`'s curves with the working space, in `set_develop_curves`'
/// layout, and as it does: values that are not curves leave the area's
/// curves as they were, a failed upload turns them off.
pub fn set_develop_area_curves(engine: &mut EngineInner, index: u32, values: &[f32]) -> Result<(), String> {
    let on = curves_on(values)?;
    let existing = area_layer(engine, index)?.look_curves.take();
    let curves = upload_curves(engine, existing, values, on)?;
    area_layer(engine, index)?.look_curves = curves;
    Ok(())
}
