//! Per-document image adjustments (exposure, contrast, highlights, shadows,
//! whites, blacks, vignette, saturation, vibrance) plus curves/levels LUTs
//! and the mask-edit toggle.
//!
//! Adjustments are applied on the compositor's final pass rather than baked
//! into layer pixels — these setters just write the scalar / upload the LUT
//! and flag the engine for recomposite.

use wasm_bindgen::prelude::*;

use crate::Engine;

#[wasm_bindgen(js_name = "setImageExposure")]
pub fn set_image_exposure(engine: &mut Engine, value: f32) {
    engine.inner.adjustments.exposure = value;
    engine.inner.needs_recomposite = true;
}

#[wasm_bindgen(js_name = "setImageContrast")]
pub fn set_image_contrast(engine: &mut Engine, value: f32) {
    engine.inner.adjustments.contrast = value;
    engine.inner.needs_recomposite = true;
}

#[wasm_bindgen(js_name = "setImageHighlights")]
pub fn set_image_highlights(engine: &mut Engine, value: f32) {
    engine.inner.adjustments.highlights = value;
    engine.inner.needs_recomposite = true;
}

#[wasm_bindgen(js_name = "setImageShadows")]
pub fn set_image_shadows(engine: &mut Engine, value: f32) {
    engine.inner.adjustments.shadows = value;
    engine.inner.needs_recomposite = true;
}

#[wasm_bindgen(js_name = "setImageWhites")]
pub fn set_image_whites(engine: &mut Engine, value: f32) {
    engine.inner.adjustments.whites = value;
    engine.inner.needs_recomposite = true;
}

#[wasm_bindgen(js_name = "setImageBlacks")]
pub fn set_image_blacks(engine: &mut Engine, value: f32) {
    engine.inner.adjustments.blacks = value;
    engine.inner.needs_recomposite = true;
}

#[wasm_bindgen(js_name = "setImageVignette")]
pub fn set_image_vignette(engine: &mut Engine, value: f32) {
    engine.inner.adjustments.vignette = value;
    engine.inner.needs_recomposite = true;
}

#[wasm_bindgen(js_name = "setImageSaturation")]
pub fn set_image_saturation(engine: &mut Engine, value: f32) {
    engine.inner.adjustments.saturation = value;
    engine.inner.needs_recomposite = true;
}

#[wasm_bindgen(js_name = "setImageVibrance")]
pub fn set_image_vibrance(engine: &mut Engine, value: f32) {
    engine.inner.adjustments.vibrance = value;
    engine.inner.needs_recomposite = true;
}

#[wasm_bindgen(js_name = "clearImageAdjustments")]
pub fn clear_image_adjustments(engine: &mut Engine) {
    engine.inner.adjustments.exposure = 0.0;
    engine.inner.adjustments.contrast = 0.0;
    engine.inner.adjustments.highlights = 0.0;
    engine.inner.adjustments.shadows = 0.0;
    engine.inner.adjustments.whites = 0.0;
    engine.inner.adjustments.blacks = 0.0;
    engine.inner.adjustments.vignette = 0.0;
    engine.inner.adjustments.saturation = 0.0;
    engine.inner.adjustments.vibrance = 0.0;
    if let Some(tex) = engine.inner.adjustments.curves_texture.take() {
        engine.inner.texture_pool.release(tex);
    }
    engine.inner.adjustments.has_curves = false;
    if let Some(tex) = engine.inner.adjustments.levels_texture.take() {
        engine.inner.texture_pool.release(tex);
    }
    engine.inner.adjustments.has_levels = false;
    engine.inner.needs_recomposite = true;
}

/// Upload the packed 256x4 RGBA curves LUT (R=red curve, G=green, B=blue,
/// A=master). Allocates the LUT texture lazily on first call. Pass an
/// empty / 0-length slice via `clearImageCurves` to disable.
#[wasm_bindgen(js_name = "setImageCurvesLut")]
pub fn set_image_curves_lut(engine: &mut Engine, lut: &[u8]) -> Result<(), JsError> {
    if lut.len() != 256 * 4 {
        return Err(JsError::new("Curves LUT must be exactly 256 * 4 bytes"));
    }
    let inner = &mut engine.inner;
    let tex = match inner.adjustments.curves_texture {
        Some(t) => t,
        None => {
            let t = inner.texture_pool.acquire(&inner.gl, 256, 1)
                .map_err(|e| JsError::new(&e))?;
            inner.adjustments.curves_texture = Some(t);
            t
        }
    };
    inner.texture_pool.upload_rgba(&inner.gl, tex, 0, 0, 256, 1, lut)
        .map_err(|e| JsError::new(&e))?;
    inner.adjustments.has_curves = true;
    inner.needs_recomposite = true;
    Ok(())
}

#[wasm_bindgen(js_name = "clearImageCurves")]
pub fn clear_image_curves(engine: &mut Engine) {
    if let Some(tex) = engine.inner.adjustments.curves_texture.take() {
        engine.inner.texture_pool.release(tex);
    }
    engine.inner.adjustments.has_curves = false;
    engine.inner.needs_recomposite = true;
}

/// Upload the packed 256x4 RGBA Levels LUT for one channel.
/// Values are [inputBlack, inputWhite, gamma, outputBlack, outputWhite] as f32 in [0,1] except gamma in [0.01,10].
/// Allocates the LUT texture lazily on first call. Pass a 0-length slice via `clearImageLevels` to disable.
#[wasm_bindgen(js_name = "setImageLevelsLut")]
pub fn set_image_levels_lut(engine: &mut Engine, lut: &[u8]) -> Result<(), JsError> {
    if lut.len() != 256 * 4 {
        return Err(JsError::new("Levels LUT must be exactly 256 * 4 bytes"));
    }
    let inner = &mut engine.inner;
    let tex = match inner.adjustments.levels_texture {
        Some(t) => t,
        None => {
            let t = inner.texture_pool.acquire(&inner.gl, 256, 1)
                .map_err(|e| JsError::new(&e))?;
            inner.adjustments.levels_texture = Some(t);
            t
        }
    };
    inner.texture_pool.upload_rgba(&inner.gl, tex, 0, 0, 256, 1, lut)
        .map_err(|e| JsError::new(&e))?;
    inner.adjustments.has_levels = true;
    inner.needs_recomposite = true;
    Ok(())
}

#[wasm_bindgen(js_name = "clearImageLevels")]
pub fn clear_image_levels(engine: &mut Engine) {
    if let Some(tex) = engine.inner.adjustments.levels_texture.take() {
        engine.inner.texture_pool.release(tex);
    }
    engine.inner.adjustments.has_levels = false;
    engine.inner.needs_recomposite = true;
}

// ============================================================
// Group Adjustments
// ============================================================

#[wasm_bindgen(js_name = "setGroupAdjustments")]
pub fn set_group_adjustments(
    engine: &mut Engine,
    group_id: &str,
    child_ids_json: &str,
    exposure: f32,
    contrast: f32,
    highlights: f32,
    shadows: f32,
    whites: f32,
    blacks: f32,
    saturation: f32,
    vibrance: f32,
) -> Result<(), JsError> {
    let child_ids: Vec<String> = serde_json::from_str(child_ids_json)
        .map_err(|e| JsError::new(&format!("Invalid child IDs JSON: {e}")))?;
    let adj = crate::engine::ImageAdjustmentState {
        exposure,
        contrast,
        highlights,
        shadows,
        whites,
        blacks,
        saturation,
        vibrance,
        ..Default::default()
    };
    engine.inner.group_adjustments.insert(
        group_id.to_string(),
        crate::engine::GroupAdjustment { adjustments: adj, child_ids },
    );
    engine.inner.needs_recomposite = true;
    Ok(())
}

#[wasm_bindgen(js_name = "setGroupCurvesLut")]
pub fn set_group_curves_lut(engine: &mut Engine, group_id: &str, lut: &[u8]) -> Result<(), JsError> {
    if lut.len() != 256 * 4 {
        return Err(JsError::new("Group curves LUT must be exactly 256 * 4 bytes"));
    }
    if !engine.inner.group_adjustments.contains_key(group_id) {
        return Err(JsError::new("Group not found — call setGroupAdjustments first"));
    }
    let existing = engine.inner.group_adjustments.get(group_id).unwrap().adjustments.curves_texture;
    let tex = match existing {
        Some(t) => t,
        None => {
            let t = engine.inner.texture_pool.acquire(&engine.inner.gl, 256, 1)
                .map_err(|e| JsError::new(&e))?;
            engine.inner.group_adjustments.get_mut(group_id).unwrap().adjustments.curves_texture = Some(t);
            t
        }
    };
    engine.inner.texture_pool.upload_rgba(&engine.inner.gl, tex, 0, 0, 256, 1, lut)
        .map_err(|e| JsError::new(&e))?;
    engine.inner.group_adjustments.get_mut(group_id).unwrap().adjustments.has_curves = true;
    engine.inner.needs_recomposite = true;
    Ok(())
}

#[wasm_bindgen(js_name = "setGroupLevelsLut")]
pub fn set_group_levels_lut(engine: &mut Engine, group_id: &str, lut: &[u8]) -> Result<(), JsError> {
    if lut.len() != 256 * 4 {
        return Err(JsError::new("Group levels LUT must be exactly 256 * 4 bytes"));
    }
    if !engine.inner.group_adjustments.contains_key(group_id) {
        return Err(JsError::new("Group not found — call setGroupAdjustments first"));
    }
    let existing = engine.inner.group_adjustments.get(group_id).unwrap().adjustments.levels_texture;
    let tex = match existing {
        Some(t) => t,
        None => {
            let t = engine.inner.texture_pool.acquire(&engine.inner.gl, 256, 1)
                .map_err(|e| JsError::new(&e))?;
            engine.inner.group_adjustments.get_mut(group_id).unwrap().adjustments.levels_texture = Some(t);
            t
        }
    };
    engine.inner.texture_pool.upload_rgba(&engine.inner.gl, tex, 0, 0, 256, 1, lut)
        .map_err(|e| JsError::new(&e))?;
    engine.inner.group_adjustments.get_mut(group_id).unwrap().adjustments.has_levels = true;
    engine.inner.needs_recomposite = true;
    Ok(())
}

#[wasm_bindgen(js_name = "clearGroupAdjustments")]
pub fn clear_group_adjustments(engine: &mut Engine) {
    let textures_to_release: Vec<_> = engine.inner.group_adjustments.values()
        .flat_map(|ga| {
            let mut v = Vec::new();
            if let Some(t) = ga.adjustments.curves_texture { v.push(t); }
            if let Some(t) = ga.adjustments.levels_texture { v.push(t); }
            v
        })
        .collect();
    for tex in textures_to_release {
        engine.inner.texture_pool.release(tex);
    }
    engine.inner.group_adjustments.clear();
    engine.inner.needs_recomposite = true;
}

// ============================================================
// Mask Edit Mode
// ============================================================

#[wasm_bindgen(js_name = "setMaskEditLayer")]
pub fn set_mask_edit_layer(engine: &mut Engine, layer_id: &str) {
    engine.inner.mask_edit_layer_id = Some(layer_id.to_string());
    engine.inner.needs_recomposite = true;
}

#[wasm_bindgen(js_name = "clearMaskEditLayer")]
pub fn clear_mask_edit_layer(engine: &mut Engine) {
    engine.inner.mask_edit_layer_id = None;
    engine.inner.needs_recomposite = true;
}
