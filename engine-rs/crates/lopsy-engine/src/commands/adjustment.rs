//! Per-document image adjustments (exposure, contrast, highlights, shadows,
//! whites, blacks, vignette, saturation, vibrance) plus curves/levels LUTs
//! and the mask-edit toggle.
//!
//! Adjustments are applied on the compositor's final pass rather than baked
//! into layer pixels — these setters just write the scalar / upload the LUT
//! and flag the engine for recomposite.


use crate::engine::EngineInner;

pub fn set_image_exposure(engine: &mut EngineInner, value: f32) {
    engine.adjustments.exposure = value;
    engine.needs_recomposite = true;
}

pub fn set_image_contrast(engine: &mut EngineInner, value: f32) {
    engine.adjustments.contrast = value;
    engine.needs_recomposite = true;
}

pub fn set_image_highlights(engine: &mut EngineInner, value: f32) {
    engine.adjustments.highlights = value;
    engine.needs_recomposite = true;
}

pub fn set_image_shadows(engine: &mut EngineInner, value: f32) {
    engine.adjustments.shadows = value;
    engine.needs_recomposite = true;
}

pub fn set_image_whites(engine: &mut EngineInner, value: f32) {
    engine.adjustments.whites = value;
    engine.needs_recomposite = true;
}

pub fn set_image_blacks(engine: &mut EngineInner, value: f32) {
    engine.adjustments.blacks = value;
    engine.needs_recomposite = true;
}

pub fn set_image_vignette(engine: &mut EngineInner, value: f32) {
    engine.adjustments.vignette = value;
    engine.needs_recomposite = true;
}

pub fn set_image_saturation(engine: &mut EngineInner, value: f32) {
    engine.adjustments.saturation = value;
    engine.needs_recomposite = true;
}

pub fn set_image_vibrance(engine: &mut EngineInner, value: f32) {
    engine.adjustments.vibrance = value;
    engine.needs_recomposite = true;
}

pub fn clear_image_adjustments(engine: &mut EngineInner) {
    engine.adjustments.exposure = 0.0;
    engine.adjustments.contrast = 0.0;
    engine.adjustments.highlights = 0.0;
    engine.adjustments.shadows = 0.0;
    engine.adjustments.whites = 0.0;
    engine.adjustments.blacks = 0.0;
    engine.adjustments.vignette = 0.0;
    engine.adjustments.saturation = 0.0;
    engine.adjustments.vibrance = 0.0;
    if let Some(tex) = engine.adjustments.curves_texture.take() {
        engine.texture_pool.release(tex);
    }
    engine.adjustments.has_curves = false;
    if let Some(tex) = engine.adjustments.levels_texture.take() {
        engine.texture_pool.release(tex);
    }
    engine.adjustments.has_levels = false;
    engine.adjustments.hue_shift = 0.0;
    engine.adjustments.hsl_saturation = 0.0;
    engine.adjustments.lightness = 0.0;
    engine.adjustments.cb_shadows = [0.0; 3];
    engine.adjustments.cb_midtones = [0.0; 3];
    engine.adjustments.cb_highlights = [0.0; 3];
    engine.adjustments.pf_color = [1.0; 3];
    engine.adjustments.pf_density = 0.0;
    engine.adjustments.pf_preserve_luminosity = true;
    engine.adjustments.bw_enabled = false;
    engine.adjustments.cm_enabled = false;
    engine.adjustments.invert = false;
    if let Some(tex) = engine.adjustments.gradient_map_texture.take() {
        engine.texture_pool.release(tex);
    }
    engine.adjustments.has_gradient_map = false;
    engine.needs_recomposite = true;
}

// ============================================================
// New effect setters
// ============================================================

pub fn set_image_invert(engine: &mut EngineInner, enabled: bool) {
    engine.adjustments.invert = enabled;
    engine.needs_recomposite = true;
}

pub fn set_image_hue_saturation(engine: &mut EngineInner, hue: f32, saturation: f32, lightness: f32) {
    engine.adjustments.hue_shift = hue;
    engine.adjustments.hsl_saturation = saturation;
    engine.adjustments.lightness = lightness;
    engine.needs_recomposite = true;
}

pub fn set_image_color_balance(
    engine: &mut EngineInner,
    sh_r: f32, sh_g: f32, sh_b: f32,
    mt_r: f32, mt_g: f32, mt_b: f32,
    hi_r: f32, hi_g: f32, hi_b: f32,
) {
    engine.adjustments.cb_shadows    = [sh_r, sh_g, sh_b];
    engine.adjustments.cb_midtones   = [mt_r, mt_g, mt_b];
    engine.adjustments.cb_highlights = [hi_r, hi_g, hi_b];
    engine.needs_recomposite = true;
}

pub fn set_image_photo_filter(engine: &mut EngineInner, r: f32, g: f32, b: f32, density: f32, preserve_luminosity: bool) {
    engine.adjustments.pf_color = [r, g, b];
    engine.adjustments.pf_density = density;
    engine.adjustments.pf_preserve_luminosity = preserve_luminosity;
    engine.needs_recomposite = true;
}

pub fn set_image_black_white(engine: &mut EngineInner, reds: f32, yellows: f32, greens: f32, cyans: f32, blues: f32, magentas: f32) {
    engine.adjustments.bw_reds     = reds;
    engine.adjustments.bw_yellows  = yellows;
    engine.adjustments.bw_greens   = greens;
    engine.adjustments.bw_cyans    = cyans;
    engine.adjustments.bw_blues    = blues;
    engine.adjustments.bw_magentas = magentas;
    engine.adjustments.bw_enabled  = true;
    engine.needs_recomposite = true;
}

pub fn clear_image_black_white(engine: &mut EngineInner) {
    engine.adjustments.bw_enabled = false;
    engine.needs_recomposite = true;
}

pub fn set_image_channel_mixer(
    engine: &mut EngineInner,
    rr: f32, rg: f32, rb: f32, rc: f32,
    gr: f32, gg: f32, gb: f32, gc: f32,
    br: f32, bg: f32, bb: f32, bc: f32,
) {
    engine.adjustments.cm_r = [rr, rg, rb, rc];
    engine.adjustments.cm_g = [gr, gg, gb, gc];
    engine.adjustments.cm_b = [br, bg, bb, bc];
    engine.adjustments.cm_enabled = true;
    engine.needs_recomposite = true;
}

pub fn clear_image_channel_mixer(engine: &mut EngineInner) {
    engine.adjustments.cm_enabled = false;
    engine.needs_recomposite = true;
}

pub fn set_image_gradient_map_lut(engine: &mut EngineInner, lut: &[u8]) -> Result<(), String> {
    if lut.len() != 256 * 4 {
        return Err("Gradient map LUT must be exactly 256 * 4 bytes".to_string());
    }
    let inner = &mut *engine;
    let tex = match inner.adjustments.gradient_map_texture {
        Some(t) => t,
        None => {
            let t = inner.texture_pool.acquire(256, 1)
                ?;
            inner.adjustments.gradient_map_texture = Some(t);
            t
        }
    };
    inner.texture_pool.upload_rgba(tex, 0, 0, 256, 1, lut)
        ?;
    inner.adjustments.has_gradient_map = true;
    inner.needs_recomposite = true;
    Ok(())
}

pub fn clear_image_gradient_map(engine: &mut EngineInner) {
    if let Some(tex) = engine.adjustments.gradient_map_texture.take() {
        engine.texture_pool.release(tex);
    }
    engine.adjustments.has_gradient_map = false;
    engine.needs_recomposite = true;
}

/// Upload the packed 256x4 RGBA curves LUT (R=red curve, G=green, B=blue,
/// A=master). Allocates the LUT texture lazily on first call. Pass an
/// empty / 0-length slice via `clearImageCurves` to disable.
pub fn set_image_curves_lut(engine: &mut EngineInner, lut: &[u8]) -> Result<(), String> {
    if lut.len() != 256 * 4 {
        return Err("Curves LUT must be exactly 256 * 4 bytes".to_string());
    }
    let inner = &mut *engine;
    let tex = match inner.adjustments.curves_texture {
        Some(t) => t,
        None => {
            let t = inner.texture_pool.acquire(256, 1)
                ?;
            inner.adjustments.curves_texture = Some(t);
            t
        }
    };
    inner.texture_pool.upload_rgba(tex, 0, 0, 256, 1, lut)
        ?;
    inner.adjustments.has_curves = true;
    inner.needs_recomposite = true;
    Ok(())
}

pub fn clear_image_curves(engine: &mut EngineInner) {
    if let Some(tex) = engine.adjustments.curves_texture.take() {
        engine.texture_pool.release(tex);
    }
    engine.adjustments.has_curves = false;
    engine.needs_recomposite = true;
}

/// Upload the packed 256x4 RGBA Levels LUT for one channel.
/// Values are [inputBlack, inputWhite, gamma, outputBlack, outputWhite] as f32 in [0,1] except gamma in [0.01,10].
/// Allocates the LUT texture lazily on first call. Pass a 0-length slice via `clearImageLevels` to disable.
pub fn set_image_levels_lut(engine: &mut EngineInner, lut: &[u8]) -> Result<(), String> {
    if lut.len() != 256 * 4 {
        return Err("Levels LUT must be exactly 256 * 4 bytes".to_string());
    }
    let inner = &mut *engine;
    let tex = match inner.adjustments.levels_texture {
        Some(t) => t,
        None => {
            let t = inner.texture_pool.acquire(256, 1)
                ?;
            inner.adjustments.levels_texture = Some(t);
            t
        }
    };
    inner.texture_pool.upload_rgba(tex, 0, 0, 256, 1, lut)
        ?;
    inner.adjustments.has_levels = true;
    inner.needs_recomposite = true;
    Ok(())
}

pub fn clear_image_levels(engine: &mut EngineInner) {
    if let Some(tex) = engine.adjustments.levels_texture.take() {
        engine.texture_pool.release(tex);
    }
    engine.adjustments.has_levels = false;
    engine.needs_recomposite = true;
}

// ============================================================
// Group Adjustments
// ============================================================

pub fn set_group_adjustments(
    engine: &mut EngineInner,
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
) -> Result<(), String> {
    let child_ids: Vec<String> = serde_json::from_str(child_ids_json)
        .map_err(|e| format!("Invalid child IDs JSON: {e}"))?;
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
    if let Some(prev) = engine.group_adjustments.get(group_id) {
        adj.curves_texture = prev.adjustments.curves_texture;
        adj.levels_texture = prev.adjustments.levels_texture;
        adj.gradient_map_texture = prev.adjustments.gradient_map_texture;
    }
    engine.group_adjustments.insert(
        group_id.to_string(),
        crate::engine::GroupAdjustment { adjustments: adj, child_ids },
    );
    engine.needs_recomposite = true;
    Ok(())
}

pub fn remove_group_adjustment(engine: &mut EngineInner, group_id: &str) {
    if let Some(ga) = engine.group_adjustments.remove(group_id) {
        if let Some(t) = ga.adjustments.curves_texture {
            engine.texture_pool.release(t);
        }
        if let Some(t) = ga.adjustments.levels_texture {
            engine.texture_pool.release(t);
        }
        if let Some(t) = ga.adjustments.gradient_map_texture {
            engine.texture_pool.release(t);
        }
        if let Some(t) = engine.group_pre_adj_cache.remove(group_id) {
            engine.texture_pool.release(t);
        }
        engine.needs_recomposite = true;
    }
}

pub fn set_group_curves_lut(engine: &mut EngineInner, group_id: &str, lut: &[u8]) -> Result<(), String> {
    if lut.len() != 256 * 4 {
        return Err("Group curves LUT must be exactly 256 * 4 bytes".to_string());
    }
    if !engine.group_adjustments.contains_key(group_id) {
        return Err("Group not found — call setGroupAdjustments first".to_string());
    }
    let existing = engine.group_adjustments.get(group_id).and_then(|g| g.adjustments.curves_texture);
    let tex = match existing {
        Some(t) => t,
        None => {
            let t = engine.texture_pool.acquire(256, 1)
                ?;
            if let Some(g) = engine.group_adjustments.get_mut(group_id) { g.adjustments.curves_texture = Some(t); }
            t
        }
    };
    engine.texture_pool.upload_rgba(tex, 0, 0, 256, 1, lut)
        ?;
    if let Some(g) = engine.group_adjustments.get_mut(group_id) { g.adjustments.has_curves = true; }
    engine.needs_recomposite = true;
    Ok(())
}

pub fn set_group_levels_lut(engine: &mut EngineInner, group_id: &str, lut: &[u8]) -> Result<(), String> {
    if lut.len() != 256 * 4 {
        return Err("Group levels LUT must be exactly 256 * 4 bytes".to_string());
    }
    if !engine.group_adjustments.contains_key(group_id) {
        return Err("Group not found — call setGroupAdjustments first".to_string());
    }
    let existing = engine.group_adjustments.get(group_id).and_then(|g| g.adjustments.levels_texture);
    let tex = match existing {
        Some(t) => t,
        None => {
            let t = engine.texture_pool.acquire(256, 1)
                ?;
            if let Some(g) = engine.group_adjustments.get_mut(group_id) { g.adjustments.levels_texture = Some(t); }
            t
        }
    };
    engine.texture_pool.upload_rgba(tex, 0, 0, 256, 1, lut)
        ?;
    if let Some(g) = engine.group_adjustments.get_mut(group_id) { g.adjustments.has_levels = true; }
    engine.needs_recomposite = true;
    Ok(())
}

pub fn clear_group_adjustments(engine: &mut EngineInner) {
    let textures_to_release: Vec<_> = engine.group_adjustments.values()
        .flat_map(|ga| {
            let mut v = Vec::new();
            if let Some(t) = ga.adjustments.curves_texture { v.push(t); }
            if let Some(t) = ga.adjustments.levels_texture { v.push(t); }
            if let Some(t) = ga.adjustments.gradient_map_texture { v.push(t); }
            v
        })
        .collect();
    for tex in textures_to_release {
        engine.texture_pool.release(tex);
    }
    engine.group_adjustments.clear();
    for (_, tex) in engine.group_pre_adj_cache.drain() {
        engine.texture_pool.release(tex);
    }
    engine.needs_recomposite = true;
}

// ============================================================
// Group new effect setters — mirror of per-image setters above
// ============================================================

pub fn set_group_invert(engine: &mut EngineInner, group_id: &str, enabled: bool) -> Result<(), String> {
    let ga = engine.group_adjustments.get_mut(group_id)
        .ok_or_else(|| "Group not found".to_string())?;
    ga.adjustments.invert = enabled;
    engine.needs_recomposite = true;
    Ok(())
}

pub fn set_group_hue_saturation(engine: &mut EngineInner, group_id: &str, hue: f32, saturation: f32, lightness: f32) -> Result<(), String> {
    let ga = engine.group_adjustments.get_mut(group_id)
        .ok_or_else(|| "Group not found".to_string())?;
    ga.adjustments.hue_shift = hue;
    ga.adjustments.hsl_saturation = saturation;
    ga.adjustments.lightness = lightness;
    engine.needs_recomposite = true;
    Ok(())
}

pub fn set_group_color_balance(
    engine: &mut EngineInner, group_id: &str,
    sh_r: f32, sh_g: f32, sh_b: f32,
    mt_r: f32, mt_g: f32, mt_b: f32,
    hi_r: f32, hi_g: f32, hi_b: f32,
) -> Result<(), String> {
    let ga = engine.group_adjustments.get_mut(group_id)
        .ok_or_else(|| "Group not found".to_string())?;
    ga.adjustments.cb_shadows    = [sh_r, sh_g, sh_b];
    ga.adjustments.cb_midtones   = [mt_r, mt_g, mt_b];
    ga.adjustments.cb_highlights = [hi_r, hi_g, hi_b];
    engine.needs_recomposite = true;
    Ok(())
}

/// `values` is the block built by `compileColorGrade`: four wheels of
/// [tint_r, tint_g, tint_b, luminance] (shadows, midtones, highlights,
/// global), then the tone-mask exponent and width.
pub fn set_group_color_grading(engine: &mut EngineInner, group_id: &str, values: &[f32]) -> Result<(), String> {
    if values.len() != 18 {
        return Err("Color grading values must be exactly 18 floats".to_string());
    }
    let ga = engine.group_adjustments.get_mut(group_id)
        .ok_or_else(|| "Group not found".to_string())?;
    let wheel = |i: usize| [values[i], values[i + 1], values[i + 2], values[i + 3]];
    ga.adjustments.cg_shadows    = wheel(0);
    ga.adjustments.cg_midtones   = wheel(4);
    ga.adjustments.cg_highlights = wheel(8);
    ga.adjustments.cg_global     = wheel(12);
    ga.adjustments.cg_exponent   = values[16];
    ga.adjustments.cg_width      = values[17];
    ga.adjustments.cg_enabled    = true;
    engine.needs_recomposite = true;
    Ok(())
}

pub fn set_group_photo_filter(engine: &mut EngineInner, group_id: &str, r: f32, g: f32, b: f32, density: f32, preserve_luminosity: bool) -> Result<(), String> {
    let ga = engine.group_adjustments.get_mut(group_id)
        .ok_or_else(|| "Group not found".to_string())?;
    ga.adjustments.pf_color = [r, g, b];
    ga.adjustments.pf_density = density;
    ga.adjustments.pf_preserve_luminosity = preserve_luminosity;
    engine.needs_recomposite = true;
    Ok(())
}

pub fn set_group_black_white(engine: &mut EngineInner, group_id: &str, reds: f32, yellows: f32, greens: f32, cyans: f32, blues: f32, magentas: f32) -> Result<(), String> {
    let ga = engine.group_adjustments.get_mut(group_id)
        .ok_or_else(|| "Group not found".to_string())?;
    ga.adjustments.bw_reds     = reds;
    ga.adjustments.bw_yellows  = yellows;
    ga.adjustments.bw_greens   = greens;
    ga.adjustments.bw_cyans    = cyans;
    ga.adjustments.bw_blues    = blues;
    ga.adjustments.bw_magentas = magentas;
    ga.adjustments.bw_enabled  = true;
    engine.needs_recomposite = true;
    Ok(())
}

pub fn set_group_channel_mixer(
    engine: &mut EngineInner, group_id: &str,
    rr: f32, rg: f32, rb: f32, rc: f32,
    gr: f32, gg: f32, gb: f32, gc: f32,
    br: f32, bg: f32, bb: f32, bc: f32,
) -> Result<(), String> {
    let ga = engine.group_adjustments.get_mut(group_id)
        .ok_or_else(|| "Group not found".to_string())?;
    ga.adjustments.cm_r = [rr, rg, rb, rc];
    ga.adjustments.cm_g = [gr, gg, gb, gc];
    ga.adjustments.cm_b = [br, bg, bb, bc];
    ga.adjustments.cm_enabled = true;
    engine.needs_recomposite = true;
    Ok(())
}

pub fn set_group_gradient_map_lut(engine: &mut EngineInner, group_id: &str, lut: &[u8]) -> Result<(), String> {
    if lut.len() != 256 * 4 {
        return Err("Gradient map LUT must be exactly 256 * 4 bytes".to_string());
    }
    if !engine.group_adjustments.contains_key(group_id) {
        return Err("Group not found — call setGroupAdjustments first".to_string());
    }
    let existing = engine.group_adjustments.get(group_id).and_then(|g| g.adjustments.gradient_map_texture);
    let tex = match existing {
        Some(t) => t,
        None => {
            let t = engine.texture_pool.acquire(256, 1)
                ?;
            if let Some(g) = engine.group_adjustments.get_mut(group_id) { g.adjustments.gradient_map_texture = Some(t); }
            t
        }
    };
    engine.texture_pool.upload_rgba(tex, 0, 0, 256, 1, lut)
        ?;
    if let Some(g) = engine.group_adjustments.get_mut(group_id) { g.adjustments.has_gradient_map = true; }
    engine.needs_recomposite = true;
    Ok(())
}

// ============================================================
// Mask Edit Mode
// ============================================================

pub fn set_mask_edit_layer(engine: &mut EngineInner, layer_id: &str) {
    engine.mask_edit_layer_id = Some(layer_id.to_string());
    // A group pre-adjustment cache holds its children masked or
    // unmasked depending on mask edit state, so it can't survive a toggle.
    engine.mark_all_dirty();
}

pub fn clear_mask_edit_layer(engine: &mut EngineInner) {
    engine.mask_edit_layer_id = None;
    engine.mark_all_dirty();
}
