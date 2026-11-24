//! The tone pass on the GPU (`gpu/shaders/develop/tone.wgsl`): scene linear
//! Rec. 2020 to rendered linear Rec. 2020. First tone on scene data
//! (`lopsy_core::scene_tone`: the photo's and the areas' exposure, white
//! balance, Contrast, Highlights, Shadows, Whites and Blacks), then the RAW
//! develop settings' saturation, highlight desaturation and base curve
//! (`lopsy_core::tone`). It runs only with the working space: always on a
//! RAW document, and on one that is not RAW when tone on scene data has
//! something to do (there it has no profile part, so rendered equals scene
//! apart from the sliders).

use lopsy_core::areas::{MAX_AREAS, STRIDE};
use lopsy_core::scene_tone::{
    shader_tables, AreaTone, CONTRAST_STOPS, MIDDLE_GREY, MIN_SLOPE, TONE_FLOOR, WB_TEMPERATURE_STOPS, WB_TINT_STOPS,
};
use lopsy_core::tone::{curve_top, SHOULDER_HEADROOM};
use lopsy_core::working_space::{conversion, luma, Gamut};

use crate::develop::{RawDevelopState, CURVE_WIDTH};
use crate::engine::EngineInner;
use crate::gpu::params::develop::ToneParams;
use crate::gpu::pass::Pass;
use crate::gpu::shader::ShaderProgram;
use crate::gpu::texture_pool::TextureHandle;
use crate::gpu::uniforms::{Mat3, Vec4Array};

/// A row-major matrix as the shader's column-major `mat3x3`.
pub(crate) fn mat3(m: [f32; 9]) -> Mat3 {
    Mat3([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]])
}

/// Each area's layer's Whites and Blacks, by the area's index, for the
/// tone map (0 where an area has no layer).
pub fn area_tone(engine: &EngineInner) -> [AreaTone; MAX_AREAS] {
    std::array::from_fn(|i| {
        engine.area_layers.get(i).and_then(Option::as_ref).and_then(|l| l.look.as_ref()).map_or_else(AreaTone::default, |l| l.tone)
    })
}

/// Whether tone on scene data changes anything: the photo's sliders, or
/// any area (an area whose values are all 0 changes nothing, pixel by pixel).
pub fn scene_is_active(engine: &EngineInner) -> bool {
    engine.working_space.is_some()
        && (engine.develop_tone.is_some_and(|t| !t.is_identity()) || engine.areas.as_ref().is_some_and(|a| a.len() >= STRIDE))
}

/// The tone shader's uniforms for `raw` (the profile's part; `None` for a
/// photo that is not RAW) and the engine's tone on scene data.
pub fn params(engine: &EngineInner, raw: Option<&RawDevelopState>) -> ToneParams {
    let (saturation, highlight_desat, curve, curve_size) = match raw {
        Some(state) => {
            let s = &state.settings;
            let curve = s.base_curve.as_deref().filter(|c| c.len() >= 2 && state.curve_texture.is_some() && state.curve_size >= 2);
            (s.saturation, s.highlight_desaturation, curve, state.curve_size)
        }
        None => (1.0, false, None, 0),
    };
    let (top, slope) = curve.map_or((1.0, 0.0), curve_top);
    let sliders = engine.develop_tone.unwrap_or_default();
    let tone = sliders.tone();
    let areas = engine.areas.as_deref().filter(|_| engine.working_space.is_some()).unwrap_or(&[]);
    let (knots, rows) = shader_tables();
    let area_tone: Vec<f32> = area_tone(engine).iter().flat_map(|t| [t.whites, t.blacks, 0.0, 0.0]).collect();
    ToneParams {
        to_srgb: mat3(conversion(Gamut::Rec2020, Gamut::Srgb)),
        from_srgb: mat3(conversion(Gamut::Srgb, Gamut::Rec2020)),
        luma: luma(Gamut::Rec2020),
        saturation,
        highlight_desat: i32::from(highlight_desat),
        curve_size: if curve.is_some() { curve_size as i32 } else { 0 },
        curve_width: CURVE_WIDTH as i32,
        curve_top: top,
        curve_slope: slope,
        shoulder_headroom: SHOULDER_HEADROOM,
        scene_on: i32::from(scene_is_active(engine)),
        exposure: sliders.exposure,
        temperature: sliders.temperature,
        tint: sliders.tint,
        tone: [tone[0], tone[1], tone[2], tone[3]],
        blacks: tone[4],
        wb_stops: [WB_TEMPERATURE_STOPS, WB_TINT_STOPS],
        tone_consts: [CONTRAST_STOPS, MIN_SLOPE, TONE_FLOOR, MIDDLE_GREY],
        knots: Vec4Array::from_floats(&knots),
        rows: Vec4Array::from_floats(&rows),
        areas: Vec4Array::from_floats(areas),
        area_count: (areas.len() / STRIDE) as i32,
        area_tone: Vec4Array::from_floats(&area_tone),
    }
}

/// The tone pass over `source` for a RAW document with `state`, with
/// `program` from `engine.shaders.tone()`. Returns the pass and how many
/// texture units it bound.
pub fn pass<'a>(
    engine: &'a EngineInner,
    program: &'a ShaderProgram<ToneParams>,
    source: TextureHandle,
    state: &RawDevelopState,
) -> (Pass<'a, ToneParams>, u32) {
    pass_for(engine, program, source, Some(state))
}

/// The tone pass over `source`, the profile's part from `raw` (`None` for
/// a photo that is not RAW). Without a curve, the LUT sampler points at
/// unit 0, the source, so it cannot alias the render target.
pub fn pass_for<'a>(
    engine: &'a EngineInner,
    program: &'a ShaderProgram<ToneParams>,
    source: TextureHandle,
    raw: Option<&RawDevelopState>,
) -> (Pass<'a, ToneParams>, u32) {
    let pass = engine.pass(program, params(engine, raw)).texture("u_tex", source);
    match raw.and_then(|s| s.curve_texture).filter(|&h| engine.gpu().has_texture(h)) {
        Some(lut) => (pass.texture("u_curveLut", lut), 2),
        None => (pass.sampler_unit("u_curveLut", 0), 1),
    }
}
