//! wasm-bindgen exports for `commands::adjustment`. Each converts its arguments
//! and calls the one function of the same name there.

use wasm_bindgen::prelude::*;

use crate::Engine;

#[wasm_bindgen(js_name = "setImageExposure")]
pub fn set_image_exposure(engine: &mut Engine, value: f32) {
    crate::commands::adjustment::set_image_exposure(&mut engine.inner, value)
}

#[wasm_bindgen(js_name = "setImageContrast")]
pub fn set_image_contrast(engine: &mut Engine, value: f32) {
    crate::commands::adjustment::set_image_contrast(&mut engine.inner, value)
}

#[wasm_bindgen(js_name = "setImageHighlights")]
pub fn set_image_highlights(engine: &mut Engine, value: f32) {
    crate::commands::adjustment::set_image_highlights(&mut engine.inner, value)
}

#[wasm_bindgen(js_name = "setImageShadows")]
pub fn set_image_shadows(engine: &mut Engine, value: f32) {
    crate::commands::adjustment::set_image_shadows(&mut engine.inner, value)
}

#[wasm_bindgen(js_name = "setImageWhites")]
pub fn set_image_whites(engine: &mut Engine, value: f32) {
    crate::commands::adjustment::set_image_whites(&mut engine.inner, value)
}

#[wasm_bindgen(js_name = "setImageBlacks")]
pub fn set_image_blacks(engine: &mut Engine, value: f32) {
    crate::commands::adjustment::set_image_blacks(&mut engine.inner, value)
}

#[wasm_bindgen(js_name = "setImageVignette")]
pub fn set_image_vignette(engine: &mut Engine, value: f32) {
    crate::commands::adjustment::set_image_vignette(&mut engine.inner, value)
}

#[wasm_bindgen(js_name = "setImageSaturation")]
pub fn set_image_saturation(engine: &mut Engine, value: f32) {
    crate::commands::adjustment::set_image_saturation(&mut engine.inner, value)
}

#[wasm_bindgen(js_name = "setImageVibrance")]
pub fn set_image_vibrance(engine: &mut Engine, value: f32) {
    crate::commands::adjustment::set_image_vibrance(&mut engine.inner, value)
}

#[wasm_bindgen(js_name = "clearImageAdjustments")]
pub fn clear_image_adjustments(engine: &mut Engine) {
    crate::commands::adjustment::clear_image_adjustments(&mut engine.inner)
}

#[wasm_bindgen(js_name = "setImageInvert")]
pub fn set_image_invert(engine: &mut Engine, enabled: bool) {
    crate::commands::adjustment::set_image_invert(&mut engine.inner, enabled)
}

#[wasm_bindgen(js_name = "setImageHueSaturation")]
pub fn set_image_hue_saturation(engine: &mut Engine, hue: f32, saturation: f32, lightness: f32) {
    crate::commands::adjustment::set_image_hue_saturation(&mut engine.inner, hue, saturation, lightness)
}

#[wasm_bindgen(js_name = "setImageColorBalance")]
pub fn set_image_color_balance(
    engine: &mut Engine,
    sh_r: f32,
    sh_g: f32,
    sh_b: f32,
    mt_r: f32,
    mt_g: f32,
    mt_b: f32,
    hi_r: f32,
    hi_g: f32,
    hi_b: f32,
) {
    crate::commands::adjustment::set_image_color_balance(&mut engine.inner, sh_r, sh_g, sh_b, mt_r, mt_g, mt_b, hi_r, hi_g, hi_b)
}

#[wasm_bindgen(js_name = "setImagePhotoFilter")]
pub fn set_image_photo_filter(
    engine: &mut Engine,
    r: f32,
    g: f32,
    b: f32,
    density: f32,
    preserve_luminosity: bool,
) {
    crate::commands::adjustment::set_image_photo_filter(&mut engine.inner, r, g, b, density, preserve_luminosity)
}

#[wasm_bindgen(js_name = "setImageBlackWhite")]
pub fn set_image_black_white(
    engine: &mut Engine,
    reds: f32,
    yellows: f32,
    greens: f32,
    cyans: f32,
    blues: f32,
    magentas: f32,
) {
    crate::commands::adjustment::set_image_black_white(&mut engine.inner, reds, yellows, greens, cyans, blues, magentas)
}

#[wasm_bindgen(js_name = "clearImageBlackWhite")]
pub fn clear_image_black_white(engine: &mut Engine) {
    crate::commands::adjustment::clear_image_black_white(&mut engine.inner)
}

#[wasm_bindgen(js_name = "setImageChannelMixer")]
pub fn set_image_channel_mixer(
    engine: &mut Engine,
    rr: f32,
    rg: f32,
    rb: f32,
    rc: f32,
    gr: f32,
    gg: f32,
    gb: f32,
    gc: f32,
    br: f32,
    bg: f32,
    bb: f32,
    bc: f32,
) {
    crate::commands::adjustment::set_image_channel_mixer(&mut engine.inner, rr, rg, rb, rc, gr, gg, gb, gc, br, bg, bb, bc)
}

#[wasm_bindgen(js_name = "clearImageChannelMixer")]
pub fn clear_image_channel_mixer(engine: &mut Engine) {
    crate::commands::adjustment::clear_image_channel_mixer(&mut engine.inner)
}

#[wasm_bindgen(js_name = "setImageGradientMapLut")]
pub fn set_image_gradient_map_lut(engine: &mut Engine, lut: &[u8]) -> Result<(), JsError> {
    crate::commands::adjustment::set_image_gradient_map_lut(&mut engine.inner, lut).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "clearImageGradientMap")]
pub fn clear_image_gradient_map(engine: &mut Engine) {
    crate::commands::adjustment::clear_image_gradient_map(&mut engine.inner)
}

#[wasm_bindgen(js_name = "setImageCurvesLut")]
pub fn set_image_curves_lut(engine: &mut Engine, lut: &[u8]) -> Result<(), JsError> {
    crate::commands::adjustment::set_image_curves_lut(&mut engine.inner, lut).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "clearImageCurves")]
pub fn clear_image_curves(engine: &mut Engine) {
    crate::commands::adjustment::clear_image_curves(&mut engine.inner)
}

#[wasm_bindgen(js_name = "setImageLevelsLut")]
pub fn set_image_levels_lut(engine: &mut Engine, lut: &[u8]) -> Result<(), JsError> {
    crate::commands::adjustment::set_image_levels_lut(&mut engine.inner, lut).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "clearImageLevels")]
pub fn clear_image_levels(engine: &mut Engine) {
    crate::commands::adjustment::clear_image_levels(&mut engine.inner)
}

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
    crate::commands::adjustment::set_group_adjustments(&mut engine.inner, group_id, child_ids_json, exposure, contrast, highlights, shadows, whites, blacks, saturation, vibrance, vignette).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "removeGroupAdjustment")]
pub fn remove_group_adjustment(engine: &mut Engine, group_id: &str) {
    crate::commands::adjustment::remove_group_adjustment(&mut engine.inner, group_id)
}

#[wasm_bindgen(js_name = "setGroupCurvesLut")]
pub fn set_group_curves_lut(engine: &mut Engine, group_id: &str, lut: &[u8]) -> Result<(), JsError> {
    crate::commands::adjustment::set_group_curves_lut(&mut engine.inner, group_id, lut).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "setGroupLevelsLut")]
pub fn set_group_levels_lut(engine: &mut Engine, group_id: &str, lut: &[u8]) -> Result<(), JsError> {
    crate::commands::adjustment::set_group_levels_lut(&mut engine.inner, group_id, lut).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "clearGroupAdjustments")]
pub fn clear_group_adjustments(engine: &mut Engine) {
    crate::commands::adjustment::clear_group_adjustments(&mut engine.inner)
}

#[wasm_bindgen(js_name = "setGroupInvert")]
pub fn set_group_invert(engine: &mut Engine, group_id: &str, enabled: bool) -> Result<(), JsError> {
    crate::commands::adjustment::set_group_invert(&mut engine.inner, group_id, enabled).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "setGroupHueSaturation")]
pub fn set_group_hue_saturation(
    engine: &mut Engine,
    group_id: &str,
    hue: f32,
    saturation: f32,
    lightness: f32,
) -> Result<(), JsError> {
    crate::commands::adjustment::set_group_hue_saturation(&mut engine.inner, group_id, hue, saturation, lightness).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "setGroupColorBalance")]
pub fn set_group_color_balance(
    engine: &mut Engine,
    group_id: &str,
    sh_r: f32,
    sh_g: f32,
    sh_b: f32,
    mt_r: f32,
    mt_g: f32,
    mt_b: f32,
    hi_r: f32,
    hi_g: f32,
    hi_b: f32,
) -> Result<(), JsError> {
    crate::commands::adjustment::set_group_color_balance(&mut engine.inner, group_id, sh_r, sh_g, sh_b, mt_r, mt_g, mt_b, hi_r, hi_g, hi_b).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "setGroupColorGrading")]
pub fn set_group_color_grading(engine: &mut Engine, group_id: &str, values: &[f32]) -> Result<(), JsError> {
    crate::commands::adjustment::set_group_color_grading(&mut engine.inner, group_id, values).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "setGroupPhotoFilter")]
pub fn set_group_photo_filter(
    engine: &mut Engine,
    group_id: &str,
    r: f32,
    g: f32,
    b: f32,
    density: f32,
    preserve_luminosity: bool,
) -> Result<(), JsError> {
    crate::commands::adjustment::set_group_photo_filter(&mut engine.inner, group_id, r, g, b, density, preserve_luminosity).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "setGroupBlackWhite")]
pub fn set_group_black_white(
    engine: &mut Engine,
    group_id: &str,
    reds: f32,
    yellows: f32,
    greens: f32,
    cyans: f32,
    blues: f32,
    magentas: f32,
) -> Result<(), JsError> {
    crate::commands::adjustment::set_group_black_white(&mut engine.inner, group_id, reds, yellows, greens, cyans, blues, magentas).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "setGroupChannelMixer")]
pub fn set_group_channel_mixer(
    engine: &mut Engine,
    group_id: &str,
    rr: f32,
    rg: f32,
    rb: f32,
    rc: f32,
    gr: f32,
    gg: f32,
    gb: f32,
    gc: f32,
    br: f32,
    bg: f32,
    bb: f32,
    bc: f32,
) -> Result<(), JsError> {
    crate::commands::adjustment::set_group_channel_mixer(&mut engine.inner, group_id, rr, rg, rb, rc, gr, gg, gb, gc, br, bg, bb, bc).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "setGroupGradientMapLut")]
pub fn set_group_gradient_map_lut(engine: &mut Engine, group_id: &str, lut: &[u8]) -> Result<(), JsError> {
    crate::commands::adjustment::set_group_gradient_map_lut(&mut engine.inner, group_id, lut).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "setMaskEditLayer")]
pub fn set_mask_edit_layer(engine: &mut Engine, layer_id: &str) {
    crate::commands::adjustment::set_mask_edit_layer(&mut engine.inner, layer_id)
}

#[wasm_bindgen(js_name = "clearMaskEditLayer")]
pub fn clear_mask_edit_layer(engine: &mut Engine) {
    crate::commands::adjustment::clear_mask_edit_layer(&mut engine.inner)
}
