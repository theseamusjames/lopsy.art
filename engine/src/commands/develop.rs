//! Commands of the proof-of-concept RAW develop stage (`crate::develop`):
//! set or clear a document's develop settings. The settings are data read
//! by the compositor every frame; no layer pixels change.

use lopsy_core::develop_stats;
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
            None => engine.texture_pool.acquire(CURVE_WIDTH, rows)?,
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
