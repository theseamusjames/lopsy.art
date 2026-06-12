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
    engine.inner.adjustments.hue_shift = 0.0;
    engine.inner.adjustments.hsl_saturation = 0.0;
    engine.inner.adjustments.lightness = 0.0;
    engine.inner.adjustments.cb_shadows = [0.0; 3];
    engine.inner.adjustments.cb_midtones = [0.0; 3];
    engine.inner.adjustments.cb_highlights = [0.0; 3];
    engine.inner.adjustments.pf_color = [1.0; 3];
    engine.inner.adjustments.pf_density = 0.0;
    engine.inner.adjustments.pf_preserve_luminosity = true;
    engine.inner.adjustments.bw_enabled = false;
    engine.inner.adjustments.cm_enabled = false;
    engine.inner.adjustments.invert = false;
    if let Some(tex) = engine.inner.adjustments.gradient_map_texture.take() {
        engine.inner.texture_pool.release(tex);
    }
    engine.inner.adjustments.has_gradient_map = false;
    engine.inner.needs_recomposite = true;
}

// ============================================================
// New effect setters
// ============================================================

#[wasm_bindgen(js_name = "setImageInvert")]
pub fn set_image_invert(engine: &mut Engine, enabled: bool) {
    engine.inner.adjustments.invert = enabled;
    engine.inner.needs_recomposite = true;
}

#[wasm_bindgen(js_name = "setImageHueSaturation")]
pub fn set_image_hue_saturation(engine: &mut Engine, hue: f32, saturation: f32, lightness: f32) {
    engine.inner.adjustments.hue_shift = hue;
    engine.inner.adjustments.hsl_saturation = saturation;
    engine.inner.adjustments.lightness = lightness;
    engine.inner.needs_recomposite = true;
}

#[wasm_bindgen(js_name = "setImageColorBalance")]
pub fn set_image_color_balance(
    engine: &mut Engine,
    sh_r: f32, sh_g: f32, sh_b: f32,
    mt_r: f32, mt_g: f32, mt_b: f32,
    hi_r: f32, hi_g: f32, hi_b: f32,
) {
    engine.inner.adjustments.cb_shadows    = [sh_r, sh_g, sh_b];
    engine.inner.adjustments.cb_midtones   = [mt_r, mt_g, mt_b];
    engine.inner.adjustments.cb_highlights = [hi_r, hi_g, hi_b];
    engine.inner.needs_recomposite = true;
}

#[wasm_bindgen(js_name = "setImagePhotoFilter")]
pub fn set_image_photo_filter(engine: &mut Engine, r: f32, g: f32, b: f32, density: f32, preserve_luminosity: bool) {
    engine.inner.adjustments.pf_color = [r, g, b];
    engine.inner.adjustments.pf_density = density;
    engine.inner.adjustments.pf_preserve_luminosity = preserve_luminosity;
    engine.inner.needs_recomposite = true;
}

#[wasm_bindgen(js_name = "setImageBlackWhite")]
pub fn set_image_black_white(engine: &mut Engine, reds: f32, yellows: f32, greens: f32, cyans: f32, blues: f32, magentas: f32) {
    engine.inner.adjustments.bw_reds     = reds;
    engine.inner.adjustments.bw_yellows  = yellows;
    engine.inner.adjustments.bw_greens   = greens;
    engine.inner.adjustments.bw_cyans    = cyans;
    engine.inner.adjustments.bw_blues    = blues;
    engine.inner.adjustments.bw_magentas = magentas;
    engine.inner.adjustments.bw_enabled  = true;
    engine.inner.needs_recomposite = true;
}

#[wasm_bindgen(js_name = "clearImageBlackWhite")]
pub fn clear_image_black_white(engine: &mut Engine) {
    engine.inner.adjustments.bw_enabled = false;
    engine.inner.needs_recomposite = true;
}

#[wasm_bindgen(js_name = "setImageChannelMixer")]
pub fn set_image_channel_mixer(
    engine: &mut Engine,
    rr: f32, rg: f32, rb: f32, rc: f32,
    gr: f32, gg: f32, gb: f32, gc: f32,
    br: f32, bg: f32, bb: f32, bc: f32,
) {
    engine.inner.adjustments.cm_r = [rr, rg, rb, rc];
    engine.inner.adjustments.cm_g = [gr, gg, gb, gc];
    engine.inner.adjustments.cm_b = [br, bg, bb, bc];
    engine.inner.adjustments.cm_enabled = true;
    engine.inner.needs_recomposite = true;
}

#[wasm_bindgen(js_name = "clearImageChannelMixer")]
pub fn clear_image_channel_mixer(engine: &mut Engine) {
    engine.inner.adjustments.cm_enabled = false;
    engine.inner.needs_recomposite = true;
}

#[wasm_bindgen(js_name = "setImageGradientMapLut")]
pub fn set_image_gradient_map_lut(engine: &mut Engine, lut: &[u8]) -> Result<(), JsError> {
    if lut.len() != 256 * 4 {
        return Err(JsError::new("Gradient map LUT must be exactly 256 * 4 bytes"));
    }
    let inner = &mut engine.inner;
    let tex = match inner.adjustments.gradient_map_texture {
        Some(t) => t,
        None => {
            let t = inner.texture_pool.acquire(&inner.gl, 256, 1)
                .map_err(|e| JsError::new(&e))?;
            inner.adjustments.gradient_map_texture = Some(t);
            t
        }
    };
    inner.texture_pool.upload_rgba(&inner.gl, tex, 0, 0, 256, 1, lut)
        .map_err(|e| JsError::new(&e))?;
    inner.adjustments.has_gradient_map = true;
    inner.needs_recomposite = true;
    Ok(())
}

#[wasm_bindgen(js_name = "clearImageGradientMap")]
pub fn clear_image_gradient_map(engine: &mut Engine) {
    if let Some(tex) = engine.inner.adjustments.gradient_map_texture.take() {
        engine.inner.texture_pool.release(tex);
    }
    engine.inner.adjustments.has_gradient_map = false;
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
    vignette: f32,
) -> Result<(), JsError> {
    let child_ids: Vec<String> = serde_json::from_str(child_ids_json)
        .map_err(|e| JsError::new(&format!("Invalid child IDs JSON: {e}")))?;
    let mut adj = crate::engine::ImageAdjustmentState {
        exposure,
        contrast,
        highlights,
        shadows,
        whites,
        blacks,
        saturation,
        vibrance,
        vignette,
        ..Default::default()
    };
    // Carry forward LUT texture handles so the subsequent setGroup*Lut
    // calls reuse the same GPU texture instead of allocating a new one.
    // Only the handles are carried — has_* flags reset to false so stale
    // LUTs are never sampled.  If the effect is still active, the
    // matching setGroup*Lut call re-sets has_* = true.
    if let Some(prev) = engine.inner.group_adjustments.get(group_id) {
        adj.curves_texture = prev.adjustments.curves_texture;
        adj.levels_texture = prev.adjustments.levels_texture;
        adj.gradient_map_texture = prev.adjustments.gradient_map_texture;
    }
    engine.inner.group_adjustments.insert(
        group_id.to_string(),
        crate::engine::GroupAdjustment { adjustments: adj, child_ids },
    );
    engine.inner.needs_recomposite = true;
    Ok(())
}

#[wasm_bindgen(js_name = "removeGroupAdjustment")]
pub fn remove_group_adjustment(engine: &mut Engine, group_id: &str) {
    if let Some(ga) = engine.inner.group_adjustments.remove(group_id) {
        if let Some(t) = ga.adjustments.curves_texture {
            engine.inner.texture_pool.release(t);
        }
        if let Some(t) = ga.adjustments.levels_texture {
            engine.inner.texture_pool.release(t);
        }
        if let Some(t) = ga.adjustments.gradient_map_texture {
            engine.inner.texture_pool.release(t);
        }
        engine.inner.needs_recomposite = true;
    }
}

#[wasm_bindgen(js_name = "setGroupCurvesLut")]
pub fn set_group_curves_lut(engine: &mut Engine, group_id: &str, lut: &[u8]) -> Result<(), JsError> {
    if lut.len() != 256 * 4 {
        return Err(JsError::new("Group curves LUT must be exactly 256 * 4 bytes"));
    }
    if !engine.inner.group_adjustments.contains_key(group_id) {
        return Err(JsError::new("Group not found — call setGroupAdjustments first"));
    }
    let existing = engine.inner.group_adjustments.get(group_id).and_then(|g| g.adjustments.curves_texture);
    let tex = match existing {
        Some(t) => t,
        None => {
            let t = engine.inner.texture_pool.acquire(&engine.inner.gl, 256, 1)
                .map_err(|e| JsError::new(&e))?;
            if let Some(g) = engine.inner.group_adjustments.get_mut(group_id) { g.adjustments.curves_texture = Some(t); }
            t
        }
    };
    engine.inner.texture_pool.upload_rgba(&engine.inner.gl, tex, 0, 0, 256, 1, lut)
        .map_err(|e| JsError::new(&e))?;
    if let Some(g) = engine.inner.group_adjustments.get_mut(group_id) { g.adjustments.has_curves = true; }
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
    let existing = engine.inner.group_adjustments.get(group_id).and_then(|g| g.adjustments.levels_texture);
    let tex = match existing {
        Some(t) => t,
        None => {
            let t = engine.inner.texture_pool.acquire(&engine.inner.gl, 256, 1)
                .map_err(|e| JsError::new(&e))?;
            if let Some(g) = engine.inner.group_adjustments.get_mut(group_id) { g.adjustments.levels_texture = Some(t); }
            t
        }
    };
    engine.inner.texture_pool.upload_rgba(&engine.inner.gl, tex, 0, 0, 256, 1, lut)
        .map_err(|e| JsError::new(&e))?;
    if let Some(g) = engine.inner.group_adjustments.get_mut(group_id) { g.adjustments.has_levels = true; }
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
            if let Some(t) = ga.adjustments.gradient_map_texture { v.push(t); }
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
// Group new effect setters — mirror of per-image setters above
// ============================================================

#[wasm_bindgen(js_name = "setGroupInvert")]
pub fn set_group_invert(engine: &mut Engine, group_id: &str, enabled: bool) -> Result<(), JsError> {
    let ga = engine.inner.group_adjustments.get_mut(group_id)
        .ok_or_else(|| JsError::new("Group not found"))?;
    ga.adjustments.invert = enabled;
    engine.inner.needs_recomposite = true;
    Ok(())
}

#[wasm_bindgen(js_name = "setGroupHueSaturation")]
pub fn set_group_hue_saturation(engine: &mut Engine, group_id: &str, hue: f32, saturation: f32, lightness: f32) -> Result<(), JsError> {
    let ga = engine.inner.group_adjustments.get_mut(group_id)
        .ok_or_else(|| JsError::new("Group not found"))?;
    ga.adjustments.hue_shift = hue;
    ga.adjustments.hsl_saturation = saturation;
    ga.adjustments.lightness = lightness;
    engine.inner.needs_recomposite = true;
    Ok(())
}

#[wasm_bindgen(js_name = "setGroupColorBalance")]
pub fn set_group_color_balance(
    engine: &mut Engine, group_id: &str,
    sh_r: f32, sh_g: f32, sh_b: f32,
    mt_r: f32, mt_g: f32, mt_b: f32,
    hi_r: f32, hi_g: f32, hi_b: f32,
) -> Result<(), JsError> {
    let ga = engine.inner.group_adjustments.get_mut(group_id)
        .ok_or_else(|| JsError::new("Group not found"))?;
    ga.adjustments.cb_shadows    = [sh_r, sh_g, sh_b];
    ga.adjustments.cb_midtones   = [mt_r, mt_g, mt_b];
    ga.adjustments.cb_highlights = [hi_r, hi_g, hi_b];
    engine.inner.needs_recomposite = true;
    Ok(())
}

#[wasm_bindgen(js_name = "setGroupPhotoFilter")]
pub fn set_group_photo_filter(engine: &mut Engine, group_id: &str, r: f32, g: f32, b: f32, density: f32, preserve_luminosity: bool) -> Result<(), JsError> {
    let ga = engine.inner.group_adjustments.get_mut(group_id)
        .ok_or_else(|| JsError::new("Group not found"))?;
    ga.adjustments.pf_color = [r, g, b];
    ga.adjustments.pf_density = density;
    ga.adjustments.pf_preserve_luminosity = preserve_luminosity;
    engine.inner.needs_recomposite = true;
    Ok(())
}

#[wasm_bindgen(js_name = "setGroupBlackWhite")]
pub fn set_group_black_white(engine: &mut Engine, group_id: &str, reds: f32, yellows: f32, greens: f32, cyans: f32, blues: f32, magentas: f32) -> Result<(), JsError> {
    let ga = engine.inner.group_adjustments.get_mut(group_id)
        .ok_or_else(|| JsError::new("Group not found"))?;
    ga.adjustments.bw_reds     = reds;
    ga.adjustments.bw_yellows  = yellows;
    ga.adjustments.bw_greens   = greens;
    ga.adjustments.bw_cyans    = cyans;
    ga.adjustments.bw_blues    = blues;
    ga.adjustments.bw_magentas = magentas;
    ga.adjustments.bw_enabled  = true;
    engine.inner.needs_recomposite = true;
    Ok(())
}

#[wasm_bindgen(js_name = "setGroupChannelMixer")]
pub fn set_group_channel_mixer(
    engine: &mut Engine, group_id: &str,
    rr: f32, rg: f32, rb: f32, rc: f32,
    gr: f32, gg: f32, gb: f32, gc: f32,
    br: f32, bg: f32, bb: f32, bc: f32,
) -> Result<(), JsError> {
    let ga = engine.inner.group_adjustments.get_mut(group_id)
        .ok_or_else(|| JsError::new("Group not found"))?;
    ga.adjustments.cm_r = [rr, rg, rb, rc];
    ga.adjustments.cm_g = [gr, gg, gb, gc];
    ga.adjustments.cm_b = [br, bg, bb, bc];
    ga.adjustments.cm_enabled = true;
    engine.inner.needs_recomposite = true;
    Ok(())
}

#[wasm_bindgen(js_name = "setGroupGradientMapLut")]
pub fn set_group_gradient_map_lut(engine: &mut Engine, group_id: &str, lut: &[u8]) -> Result<(), JsError> {
    if lut.len() != 256 * 4 {
        return Err(JsError::new("Gradient map LUT must be exactly 256 * 4 bytes"));
    }
    if !engine.inner.group_adjustments.contains_key(group_id) {
        return Err(JsError::new("Group not found — call setGroupAdjustments first"));
    }
    let existing = engine.inner.group_adjustments.get(group_id).and_then(|g| g.adjustments.gradient_map_texture);
    let tex = match existing {
        Some(t) => t,
        None => {
            let t = engine.inner.texture_pool.acquire(&engine.inner.gl, 256, 1)
                .map_err(|e| JsError::new(&e))?;
            if let Some(g) = engine.inner.group_adjustments.get_mut(group_id) { g.adjustments.gradient_map_texture = Some(t); }
            t
        }
    };
    engine.inner.texture_pool.upload_rgba(&engine.inner.gl, tex, 0, 0, 256, 1, lut)
        .map_err(|e| JsError::new(&e))?;
    if let Some(g) = engine.inner.group_adjustments.get_mut(group_id) { g.adjustments.has_gradient_map = true; }
    engine.inner.needs_recomposite = true;
    Ok(())
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
