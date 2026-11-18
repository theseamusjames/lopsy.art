//! Commands of the proof-of-concept RAW develop stage (`crate::develop`):
//! set or clear a document's develop settings. The settings are data read
//! by the compositor every frame; no layer pixels change.

use lopsy_core::raf::develop::RawDevelopSettings;

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

/// `set_raw_develop` with the settings as the JSON `setRawDevelop` takes.
pub fn set_raw_develop_json(engine: &mut EngineInner, json: &str) -> Result<(), String> {
    let settings: RawDevelopSettings =
        serde_json::from_str(json).map_err(|e| format!("Raw develop settings: {e}"))?;
    set_raw_develop(engine, settings)
}
