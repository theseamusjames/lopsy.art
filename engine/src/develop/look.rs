//! The look pass on the GPU (`gpu/shaders/develop/look.wgsl`): Saturation,
//! Vibrance, Color by hue, colour grading and curves on rendered linear
//! Rec. 2020, with the working space only. `lopsy_core::look` is the maths
//! and its CPU reference. The document's look also blends each area's
//! Saturation and its layer's Vibrance through the area's mask; an area's
//! layer runs the pass again with its own Color by hue, grade and curves
//! over a copy of the image (`compositor::apply_area_layers`).

use lopsy_core::areas::{MAX_AREAS, STRIDE};
use lopsy_core::color_mixer::{BAND_HUES, HUE_SHIFT_MAX_DEG, LUM_FULL_CHROMA, LUM_SHIFT_MAX};
use lopsy_core::look::{oklab_matrices, LookSettings, CURVE_ENTRIES, VIBRANCE_CHROMA, VIBRANCE_STRENGTH};
use lopsy_core::scene_tone::AreaTone;
use lopsy_core::working_space::{luma, Gamut};

use crate::develop::tone::mat3;
use crate::develop::CURVE_WIDTH;
use crate::engine::EngineInner;
use crate::gpu::params::develop::LookParams;
use crate::gpu::pass::Pass;
use crate::gpu::shader::ShaderProgram;
use crate::gpu::texture_pool::TextureHandle;
use crate::gpu::uniforms::Vec4Array;

/// A set of curves on the GPU: the four tables in the R, G, B and A
/// channels of one texture (master, red, green, blue), entry `i` at texel
/// `(i % CURVE_WIDTH, i / CURVE_WIDTH)`, and which of them are not the
/// identity.
#[derive(Clone, Copy, Debug)]
pub struct CurvesState {
    pub texture: TextureHandle,
    pub on: [bool; 4],
}

/// What an area's layer adds to the develop chain with the working space
/// (`setDevelopAreaLook`): Whites and Blacks for the tone map and Vibrance
/// for the look, both blended through the area's mask in the document's
/// own passes, and its Color by hue and grade (`settings`, its Saturation
/// unused) for its own run of the look pass.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct AreaLook {
    pub tone: AreaTone,
    pub settings: LookSettings,
}

impl AreaLook {
    /// Whether the area's own run of the look pass changes anything.
    pub fn runs_look(&self) -> bool {
        self.settings.has_mixer() || self.settings.grading.is_some()
    }
}

/// The four tables as the texture's RGBA f32 texels: 256 × 16.
pub fn curve_texels(tables: &[f32]) -> Vec<f32> {
    let mut texels = Vec::with_capacity(CURVE_ENTRIES * 4);
    for i in 0..CURVE_ENTRIES {
        for k in 0..4 {
            texels.push(tables[k * CURVE_ENTRIES + i]);
        }
    }
    texels
}

/// The texture's height.
pub const CURVE_ROWS: u32 = (CURVE_ENTRIES as u32) / CURVE_WIDTH;

/// Each area's layer's Vibrance, by the area's index.
fn area_vibrance(engine: &EngineInner) -> [f32; MAX_AREAS] {
    std::array::from_fn(|i| {
        engine.area_layers.get(i).and_then(Option::as_ref).and_then(|l| l.look.as_ref()).map_or(0.0, |l| l.settings.vibrance)
    })
}

/// What one run of the look pass is given.
pub struct LookRun<'a> {
    pub settings: LookSettings,
    pub curves: Option<CurvesState>,
    /// The areas' floats, for their Saturation and their layers' Vibrance;
    /// empty for an area layer's own run.
    pub areas: &'a [f32],
    pub area_vibrance: [f32; MAX_AREAS],
}

impl LookRun<'_> {
    fn color_on(&self) -> bool {
        let s = &self.settings;
        let areas = self.areas.chunks_exact(STRIDE).enumerate().any(|(i, a)| a[15] != 0.0 || self.area_vibrance[i] != 0.0);
        s.vibrance != 0.0 || s.saturation != 0.0 || s.has_mixer() || areas
    }

    /// Whether the pass changes anything.
    pub fn draws(&self) -> bool {
        self.color_on() || self.settings.grading.is_some() || self.curves.is_some_and(|c| c.on.iter().any(|&o| o))
    }
}

/// The document's own run: its look, its curves, its areas.
pub fn document_run(engine: &EngineInner) -> LookRun<'_> {
    LookRun {
        settings: engine.develop_look.unwrap_or_default(),
        curves: engine.develop_curves,
        areas: engine.areas.as_deref().unwrap_or(&[]),
        area_vibrance: area_vibrance(engine),
    }
}

/// An area layer's own run: its Color by hue, grade and curves, no areas.
pub fn area_run(look: Option<AreaLook>, curves: Option<CurvesState>) -> LookRun<'static> {
    let settings = look.map_or_else(LookSettings::default, |l| LookSettings { vibrance: 0.0, saturation: 0.0, ..l.settings });
    LookRun { settings, curves, areas: &[], area_vibrance: [0.0; MAX_AREAS] }
}

pub fn params(run: &LookRun) -> LookParams {
    let m = oklab_matrices();
    let s = &run.settings;
    let curves_on = run.curves.map_or([false; 4], |c| c.on);
    LookParams {
        lms_from_rgb: mat3(m.lms_from_rgb),
        rgb_from_lms: mat3(m.rgb_from_lms),
        lab_from_lms: mat3(m.lab_from_lms),
        lms_from_lab: mat3(m.lms_from_lab),
        luma: luma(Gamut::Rec2020),
        color_on: i32::from(run.color_on()),
        vibrance: s.vibrance,
        saturation: s.saturation,
        vib_consts: [VIBRANCE_STRENGTH, VIBRANCE_CHROMA],
        mixer_on: i32::from(s.has_mixer()),
        mixer: Vec4Array::from_floats(&s.mixer),
        band_hues: Vec4Array::from_floats(&BAND_HUES),
        mixer_consts: [HUE_SHIFT_MAX_DEG, LUM_SHIFT_MAX, LUM_FULL_CHROMA, 0.0],
        grade_on: i32::from(s.grading.is_some()),
        grade: Vec4Array::from_floats(&s.grading.unwrap_or([0.0; 18])),
        curve_on: curves_on.map(|o| if o { 1.0 } else { 0.0 }),
        curve_width: CURVE_WIDTH as i32,
        curve_size: CURVE_ENTRIES as i32,
        areas: Vec4Array::from_floats(run.areas),
        area_count: (run.areas.len() / STRIDE) as i32,
        area_vibrance: Vec4Array::from_floats(&run.area_vibrance),
    }
}

/// The look pass over `source`, with `program` from `engine.shaders.look()`.
/// Without curves the curves sampler points at unit 0, the source, so it
/// cannot alias the render target. Returns the pass and how many texture
/// units it bound.
pub fn pass<'a>(
    engine: &'a EngineInner,
    program: &'a ShaderProgram<LookParams>,
    source: TextureHandle,
    run: &LookRun,
) -> (Pass<'a, LookParams>, u32) {
    let lut = run.curves.map(|c| c.texture).filter(|&h| engine.gpu().has_texture(h));
    let mut uniforms = params(run);
    if lut.is_none() {
        uniforms.curve_on = [0.0; 4];
    }
    let pass = engine.pass(program, uniforms).texture("u_tex", source);
    match lut {
        Some(lut) => (pass.texture("u_curves", lut), 2),
        None => (pass.sampler_unit("u_curves", 0), 1),
    }
}
