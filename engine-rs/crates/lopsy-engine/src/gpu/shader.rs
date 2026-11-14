use std::cell::RefCell;
use std::collections::HashMap;
use std::marker::PhantomData;
use std::rc::Rc;
use web_sys::{WebGl2RenderingContext, WebGlProgram, WebGlShader, WebGlUniformLocation};

use crate::gpu::params;
use crate::gpu::uniforms::{flatten_params_block, glsl_name, Field, UniformSink, UniformType, Uniforms};

pub const FULLSCREEN_QUAD_VERT: &str = r#"#version 300 es
precision highp float;
out vec2 v_uv;
void main() {
    float x = float((gl_VertexID & 1) << 2) - 1.0;
    float y = float((gl_VertexID & 2) << 1) - 1.0;
    v_uv = vec2(x * 0.5 + 0.5, y * 0.5 + 0.5);
    gl_Position = vec4(x, y, 0.0, 1.0);
}
"#;

/// A fragment shader written in WGSL (`shaders/<path>.wgsl`) and translated
/// to GLSL ES 3.00 by the build script: see `lopsy-shaderc`.
macro_rules! translated {
    ($path:literal) => {
        include_str!(concat!(env!("OUT_DIR"), "/shaders/", $path, ".glsl"))
    };
}

// Core shaders
pub const BLIT_FRAG: &str = translated!("blit");
pub const THUMBNAIL_BOX_FRAG: &str = include_str!("shaders/thumbnail_box.glsl");
pub const BLEND_FRAG: &str = include_str!("shaders/blend.glsl");
/// Shared GLSL helpers spliced into fragment sources where a
/// `//#include hsl` line appears (see `preprocess_frag`).
pub const HSL_COMMON: &str = include_str!("shaders/hsl_common.glsl");
/// Premultiplied bilinear sampling of straight-alpha textures, spliced in
/// where `//#include premul_sample` appears.
pub const PREMUL_SAMPLE: &str = include_str!("shaders/premul_sample.glsl");
/// Encoded-CIELAB <-> sRGB conversions, spliced in where `//#include lab`
/// appears.
pub const LAB_COMMON: &str = include_str!("shaders/lab_common.glsl");
pub const BLIT_RESAMPLE_FRAG: &str = translated!("blit_resample");
pub const COMPOSITE_FRAG: &str = include_str!("shaders/composite.glsl");
pub const FINAL_BLIT_FRAG: &str = include_str!("shaders/final_blit.glsl");
pub const FLIP_FRAG: &str = translated!("flip");
pub const CLIPBOARD_COPY_FRAG: &str = include_str!("shaders/clipboard_copy.glsl");
pub const CLIPBOARD_CLEAR_FRAG: &str = include_str!("shaders/clipboard_clear.glsl");
pub const SELECTION_FILL_FRAG: &str = include_str!("shaders/selection_fill.glsl");
pub const ROTATE90_FRAG: &str = translated!("rotate90");
pub const BLIT_REGION_FRAG: &str = translated!("blit_region");
pub const MASK_EXPAND_FRAG: &str = translated!("mask_expand");
pub const MASK_REMAP_FRAG: &str = include_str!("shaders/mask_remap.glsl");
pub const QUICK_MASK_TRANSLATE_FRAG: &str = include_str!("shaders/quick_mask_translate.glsl");
pub const TRANSFORM_AFFINE_FRAG: &str = include_str!("shaders/transform_affine.glsl");
pub const TRANSFORM_PERSPECTIVE_FRAG: &str = include_str!("shaders/transform_perspective.glsl");

// Effects
pub const GLOW_FRAG: &str = include_str!("shaders/effects/glow.glsl");
pub const SHADOW_FRAG: &str = include_str!("shaders/effects/shadow.glsl");
pub const LAYER_MASK_APPLY_FRAG: &str = include_str!("shaders/effects/layer_mask_apply.glsl");
pub const SEPARABLE_EDT_FRAG: &str = include_str!("shaders/effects/separable_edt.glsl");
pub const STROKE_APPLY_FRAG: &str = include_str!("shaders/effects/stroke_apply.glsl");
pub const COLOR_OVERLAY_FRAG: &str = translated!("effects/color_overlay");

// Filters
pub const GAUSSIAN_BLUR_FRAG: &str = include_str!("shaders/filters/gaussian_blur.glsl");
pub const BOX_BLUR_FRAG: &str = include_str!("shaders/filters/box_blur.glsl");
pub const ADJUSTMENTS_FRAG: &str = include_str!("shaders/filters/adjustments.glsl");
pub const HUE_SAT_FRAG: &str = include_str!("shaders/filters/hue_sat.glsl");
pub const INVERT_FRAG: &str = translated!("filters/invert");
pub const MASK_LUMINANCE_FRAG: &str = translated!("filters/mask_luminance");
pub const POSTERIZE_FRAG: &str = translated!("filters/posterize");
pub const THRESHOLD_FRAG: &str = translated!("filters/threshold");
pub const NOISE_FRAG: &str = include_str!("shaders/filters/noise.glsl");
pub const SHARPEN_FRAG: &str = translated!("filters/sharpen");
pub const VIGNETTE_FRAG: &str = include_str!("shaders/filters/vignette.glsl");
pub const MOTION_BLUR_FRAG: &str = include_str!("shaders/filters/motion_blur.glsl");
pub const RADIAL_BLUR_FRAG: &str = include_str!("shaders/filters/radial_blur.glsl");
pub const FIND_EDGES_FRAG: &str = include_str!("shaders/filters/find_edges.glsl");
pub const CEL_SHADING_FRAG: &str = include_str!("shaders/filters/cel_shading.glsl");
pub const CLOUDS_FRAG: &str = include_str!("shaders/filters/clouds.glsl");
pub const SMOKE_FRAG: &str = include_str!("shaders/filters/smoke.glsl");
pub const PIXELATE_FRAG: &str = translated!("filters/pixelate");
pub const PIXELATE_BLOCKS_FRAG: &str = include_str!("shaders/filters/pixelate_blocks.glsl");
pub const HALFTONE_FRAG: &str = include_str!("shaders/filters/halftone.glsl");
pub const SOLARIZE_FRAG: &str = translated!("filters/solarize");
pub const KALEIDOSCOPE_FRAG: &str = include_str!("shaders/filters/kaleidoscope.glsl");
pub const OIL_PAINT_FRAG: &str = include_str!("shaders/filters/oil_paint.glsl");
pub const CHROMATIC_ABERRATION_FRAG: &str = translated!("filters/chromatic_aberration");
pub const PIXEL_STRETCH_FRAG: &str = include_str!("shaders/filters/pixel_stretch.glsl");
pub const LENS_DISTORTION_FRAG: &str = include_str!("shaders/filters/lens_distortion.glsl");
pub const PATTERN_FILL_FRAG: &str = include_str!("shaders/filters/pattern_fill.glsl");
pub const MESH_WARP_FRAG: &str = include_str!("shaders/filters/mesh_warp.glsl");
pub const LIQUIFY_WARP_FRAG: &str = include_str!("shaders/filters/liquify_warp.glsl");
pub const BLOOM_THRESHOLD_FRAG: &str = translated!("filters/bloom_threshold");
pub const BLOOM_COMBINE_FRAG: &str = include_str!("shaders/filters/bloom_combine.glsl");
pub const TILT_SHIFT_BLUR_FRAG: &str = include_str!("shaders/filters/tilt_shift_blur.glsl");
pub const EMBOSS_FRAG: &str = include_str!("shaders/filters/emboss.glsl");
pub const VORONOI_FRAG: &str = include_str!("shaders/filters/voronoi.glsl");
pub const SELECTION_MASK_BLEND_FRAG: &str = translated!("filters/selection_mask_blend");
pub const SURFACE_BLUR_FRAG: &str = include_str!("shaders/filters/surface_blur.glsl");
pub const LIQUIFY_DAB_FRAG: &str = include_str!("shaders/filters/liquify_dab.glsl");
pub const FIBERS_FRAG: &str = include_str!("shaders/filters/fibers.glsl");
pub const SUNBURST_FRAG: &str = include_str!("shaders/filters/sunburst.glsl");
pub const COLOR_LUT_FRAG: &str = include_str!("shaders/filters/color_lut.glsl");
pub const TEXTURE_FRAG: &str = include_str!("shaders/filters/texture.glsl");

// Brush (assembled from header + variant + footer at compile_all time)
const BRUSH_DAB_CIRCLE_FRAG: &str = concat!(
    include_str!("shaders/brush/brush_dab_header.glsl"),
    include_str!("shaders/brush/brush_dab_circle.glsl"),
    include_str!("shaders/brush/brush_dab_footer.glsl"),
);
const BRUSH_DAB_ALPHA_FRAG: &str = concat!(
    include_str!("shaders/brush/brush_dab_header.glsl"),
    include_str!("shaders/brush/brush_dab_alpha.glsl"),
    include_str!("shaders/brush/brush_dab_footer.glsl"),
);
const BRUSH_DAB_COLOR_FRAG: &str = concat!(
    include_str!("shaders/brush/brush_dab_header.glsl"),
    include_str!("shaders/brush/brush_dab_color.glsl"),
    include_str!("shaders/brush/brush_dab_footer.glsl"),
);
pub const ERASER_DAB_FRAG: &str = include_str!("shaders/brush/eraser_dab.glsl");
pub const PENCIL_DAB_FRAG: &str = include_str!("shaders/brush/pencil_dab.glsl");
pub const QUICK_MASK_DAB_FRAG: &str = include_str!("shaders/brush/quick_mask_dab.glsl");
pub const CONTENT_BOUNDS_REDUCE_FRAG: &str = include_str!("shaders/content_bounds_reduce.glsl");
pub const DODGE_BURN_FRAG: &str = include_str!("shaders/brush/dodge_burn.glsl");
pub const DODGE_BURN_DAB_FRAG: &str = include_str!("shaders/brush/dodge_burn_dab.glsl");
pub const SMUDGE_DAB_FRAG: &str = include_str!("shaders/brush/smudge_dab.glsl");
pub const CLONE_STAMP_FRAG: &str = include_str!("shaders/brush/clone_stamp.glsl");
pub const HEALING_DAB_FRAG: &str = include_str!("shaders/brush/healing_dab.glsl");
pub const HEALING_MEAN_FRAG: &str = include_str!("shaders/brush/healing_mean.glsl");
pub const OPACITY_CLAMP_FRAG: &str = include_str!("shaders/brush/opacity_clamp.glsl");
pub const SPONGE_FRAG: &str = include_str!("shaders/brush/sponge.glsl");
pub const STAMP_PREVIEW_FRAG: &str = include_str!("shaders/brush/stamp_preview.glsl");

// Gradient
pub const GRADIENT_LINEAR_FRAG: &str = include_str!("shaders/gradient/gradient_linear.glsl");
pub const GRADIENT_RADIAL_FRAG: &str = include_str!("shaders/gradient/gradient_radial.glsl");

// Shape
pub const SHAPE_FILL_FRAG: &str = include_str!("shaders/shape/shape_fill.glsl");
pub const FLOOD_FILL_APPLY_FRAG: &str = include_str!("shaders/shape/flood_fill_apply.glsl");
pub const BUCKET_FILL_COLOR_MATCH_FRAG: &str = include_str!("shaders/shape/bucket_fill_color_match.glsl");

// Selection
pub const MARCHING_ANTS_FRAG: &str = include_str!("shaders/selection/marching_ants.glsl");

// Color
pub const COLOR_CONVERT_FRAG: &str = translated!("color/color_convert");
pub const TONEMAP_FRAG: &str = include_str!("shaders/color/tonemap.glsl");

// Text
pub const TEXT_GLYPH_FRAG: &str = include_str!("shaders/text/text_glyph.glsl");

/// Declares the typed shaders: each source tagged with the uniform struct
/// its passes are created with. A test checks every struct against its
/// source's `Params` block.
macro_rules! typed_shaders {
    ($($name:ident: $params:ty = $frag:expr;)*) => {
        $(pub const $name: Shader<$params> = Shader::new($frag);)*

        #[cfg(test)]
        fn typed_shader_checks() -> Vec<(&'static str, Result<(), String>)> {
            vec![$((
                stringify!($name),
                crate::gpu::uniforms::check::struct_matches_source::<$params>(&preprocess_frag($name.frag)),
            )),*]
        }
    };
}

typed_shaders! {
    BLIT: () = BLIT_FRAG;
    INVERT: () = INVERT_FRAG;
    POSTERIZE: params::filters::PosterizeParams = POSTERIZE_FRAG;
    THRESHOLD: params::filters::ThresholdParams = THRESHOLD_FRAG;
    BLIT_RESAMPLE: () = BLIT_RESAMPLE_FRAG;
    BLIT_REGION: params::core::BlitRegionParams = BLIT_REGION_FRAG;
    FLIP: params::core::FlipParams = FLIP_FRAG;
    ROTATE90: params::core::Rotate90Params = ROTATE90_FRAG;
    MASK_EXPAND: () = MASK_EXPAND_FRAG;
    MASK_REMAP: params::core::MaskRemapParams = MASK_REMAP_FRAG;
    QUICK_MASK_TRANSLATE: params::core::QuickMaskTranslateParams = QUICK_MASK_TRANSLATE_FRAG;
    THUMBNAIL_BOX: params::core::ThumbnailBoxParams = THUMBNAIL_BOX_FRAG;
    CLIPBOARD_COPY: params::core::ClipboardCopyParams = CLIPBOARD_COPY_FRAG;
    CLIPBOARD_CLEAR: params::core::ClipboardClearParams = CLIPBOARD_CLEAR_FRAG;
    SELECTION_FILL: params::core::SelectionFillParams = SELECTION_FILL_FRAG;
    CONTENT_BOUNDS_REDUCE: params::core::ContentBoundsReduceParams = CONTENT_BOUNDS_REDUCE_FRAG;
    LAYER_MASK_APPLY: params::effects::LayerMaskApplyParams = LAYER_MASK_APPLY_FRAG;
    TRANSFORM_AFFINE: params::core::TransformAffineParams = TRANSFORM_AFFINE_FRAG;
    TRANSFORM_PERSPECTIVE: params::core::TransformPerspectiveParams = TRANSFORM_PERSPECTIVE_FRAG;
    HUE_SAT: params::filters::HueSatParams = HUE_SAT_FRAG;
    SOLARIZE: params::filters::SolarizeParams = SOLARIZE_FRAG;
    SHARPEN: params::filters::SharpenParams = SHARPEN_FRAG;
    MOTION_BLUR: params::filters::MotionBlurParams = MOTION_BLUR_FRAG;
    RADIAL_BLUR: params::filters::RadialBlurParams = RADIAL_BLUR_FRAG;
    FIND_EDGES: () = FIND_EDGES_FRAG;
    CEL_SHADING: params::filters::CelShadingParams = CEL_SHADING_FRAG;
    PIXELATE: params::filters::PixelateParams = PIXELATE_FRAG;
    PIXELATE_BLOCKS: params::filters::PixelateBlocksParams = PIXELATE_BLOCKS_FRAG;
    HALFTONE: params::filters::HalftoneParams = HALFTONE_FRAG;
    KALEIDOSCOPE: params::filters::KaleidoscopeParams = KALEIDOSCOPE_FRAG;
    OIL_PAINT: params::filters::OilPaintParams = OIL_PAINT_FRAG;
    CHROMATIC_ABERRATION: params::filters::ChromaticAberrationParams = CHROMATIC_ABERRATION_FRAG;
    PIXEL_STRETCH: params::filters::PixelStretchParams = PIXEL_STRETCH_FRAG;
    LENS_DISTORTION: params::filters::LensDistortionParams = LENS_DISTORTION_FRAG;
    TILT_SHIFT_BLUR: params::filters::TiltShiftBlurParams = TILT_SHIFT_BLUR_FRAG;
    EMBOSS: params::filters::EmbossParams = EMBOSS_FRAG;
    VORONOI: params::filters::VoronoiParams = VORONOI_FRAG;
    SURFACE_BLUR: params::filters::SurfaceBlurParams = SURFACE_BLUR_FRAG;
    SELECTION_MASK_BLEND: params::filters::SelectionMaskBlendParams = SELECTION_MASK_BLEND_FRAG;
    NOISE: params::filters::NoiseParams = NOISE_FRAG;
    CLOUDS: params::filters::CloudsParams = CLOUDS_FRAG;
    SMOKE: params::filters::SmokeParams = SMOKE_FRAG;
    PATTERN_FILL: params::filters::PatternFillParams = PATTERN_FILL_FRAG;
    MESH_WARP: params::filters::MeshWarpParams = MESH_WARP_FRAG;
    LIQUIFY_WARP: params::filters::LiquifyWarpParams = LIQUIFY_WARP_FRAG;
    LIQUIFY_DAB: params::filters::LiquifyDabParams = LIQUIFY_DAB_FRAG;
    BLOOM_THRESHOLD: params::filters::BloomThresholdParams = BLOOM_THRESHOLD_FRAG;
    BLOOM_COMBINE: params::filters::BloomCombineParams = BLOOM_COMBINE_FRAG;
    FIBERS: params::filters::FibersParams = FIBERS_FRAG;
    SUNBURST: params::filters::SunburstParams = SUNBURST_FRAG;
    COLOR_LUT: params::filters::ColorLutParams = COLOR_LUT_FRAG;
    TEXTURE: params::filters::TextureParams = TEXTURE_FRAG;
    MASK_LUMINANCE: () = MASK_LUMINANCE_FRAG;
    GAUSSIAN_BLUR: params::filters::GaussianBlurParams = GAUSSIAN_BLUR_FRAG;
    BOX_BLUR: params::filters::BoxBlurParams = BOX_BLUR_FRAG;
    COLOR_CONVERT: params::color::ColorConvertParams = COLOR_CONVERT_FRAG;
    TONEMAP: params::color::TonemapParams = TONEMAP_FRAG;
    GRADIENT_LINEAR: params::gradient::GradientLinearParams = GRADIENT_LINEAR_FRAG;
    GRADIENT_RADIAL: params::gradient::GradientRadialParams = GRADIENT_RADIAL_FRAG;
    SHAPE_FILL: params::shape::ShapeFillParams = SHAPE_FILL_FRAG;
    FLOOD_FILL_APPLY: params::shape::FloodFillApplyParams = FLOOD_FILL_APPLY_FRAG;
    BUCKET_FILL_COLOR_MATCH: params::shape::BucketFillColorMatchParams = BUCKET_FILL_COLOR_MATCH_FRAG;
    MARCHING_ANTS: params::selection::MarchingAntsParams = MARCHING_ANTS_FRAG;
    TEXT_GLYPH: params::text::TextGlyphParams = TEXT_GLYPH_FRAG;
    ERASER_DAB: params::brush::EraserDabParams = ERASER_DAB_FRAG;
    PENCIL_DAB: params::brush::PencilDabParams = PENCIL_DAB_FRAG;
    QUICK_MASK_DAB: params::brush::QuickMaskDabParams = QUICK_MASK_DAB_FRAG;
    DODGE_BURN: params::brush::CoverageApplyParams = DODGE_BURN_FRAG;
    DODGE_BURN_DAB: params::brush::DodgeBurnDabParams = DODGE_BURN_DAB_FRAG;
    SMUDGE_DAB: params::brush::SmudgeDabParams = SMUDGE_DAB_FRAG;
    CLONE_STAMP: params::brush::CloneStampParams = CLONE_STAMP_FRAG;
    HEALING_DAB: params::brush::HealingDabParams = HEALING_DAB_FRAG;
    HEALING_MEAN: params::brush::HealingMeanParams = HEALING_MEAN_FRAG;
    OPACITY_CLAMP: params::brush::OpacityClampParams = OPACITY_CLAMP_FRAG;
    SPONGE: params::brush::CoverageApplyParams = SPONGE_FRAG;
    STAMP_PREVIEW: params::brush::StampPreviewParams = STAMP_PREVIEW_FRAG;
    BRUSH_DAB_CIRCLE: params::brush::BrushDabParams = BRUSH_DAB_CIRCLE_FRAG;
    BRUSH_DAB_ALPHA: params::brush::BrushDabParams = BRUSH_DAB_ALPHA_FRAG;
    BRUSH_DAB_COLOR: params::brush::BrushDabParams = BRUSH_DAB_COLOR_FRAG;
    GLOW: params::effects::GlowParams = GLOW_FRAG;
    SHADOW: params::effects::ShadowParams = SHADOW_FRAG;
    SEPARABLE_EDT: params::effects::SeparableEdtParams = SEPARABLE_EDT_FRAG;
    STROKE_APPLY: params::effects::StrokeApplyParams = STROKE_APPLY_FRAG;
    COLOR_OVERLAY: params::effects::ColorOverlayParams = COLOR_OVERLAY_FRAG;
    VIGNETTE: params::filters::VignetteParams = VIGNETTE_FRAG;
    ADJUSTMENTS: params::filters::AdjustmentsParams = ADJUSTMENTS_FRAG;
    COMPOSITE: params::composite::CompositeParams = COMPOSITE_FRAG;
    FINAL_BLIT: params::composite::FinalBlitParams = FINAL_BLIT_FRAG;
    BLEND: params::composite::BlendParams = BLEND_FRAG;
}

/// A fragment shader's source, tagged with the uniform struct it takes.
pub struct Shader<P> {
    pub frag: &'static str,
    params: PhantomData<fn(P)>,
}

impl<P> Shader<P> {
    pub const fn new(frag: &'static str) -> Self {
        Self { frag, params: PhantomData }
    }
}

/// A linked program. `P` is the uniform struct its passes are created with.
pub struct ShaderProgram<P> {
    linked: LinkedProgram,
    marker: PhantomData<fn(P)>,
}

/// The part of a [`ShaderProgram`] that does not depend on its uniform
/// struct. Everything that works on a program takes this, so that code is
/// compiled once and not once per shader.
pub(in crate::gpu) struct LinkedProgram {
    pub(in crate::gpu) program: WebGlProgram,
    uniforms: RefCell<HashMap<String, Option<WebGlUniformLocation>>>,
    params: RefCell<Option<ParamState>>,
}

/// Where a typed program's `Params` members live, and the values they hold.
struct ParamState {
    /// One per field of the uniform struct; `None` where the compiler
    /// dropped a member the shader variant does not read.
    locations: Vec<Option<WebGlUniformLocation>>,
    /// The bits last uploaded, field after field.
    values: Vec<u32>,
    is_uploaded: bool,
}

/// Sets the members whose value differs from what the program holds.
struct ParamUpload<'a> {
    gl: &'a WebGl2RenderingContext,
    state: &'a mut ParamState,
    field: usize,
    offset: usize,
}

impl ParamUpload<'_> {
    /// Records `bits` as the next field's value. Returns the field's
    /// location if the value has to be sent.
    fn store(&mut self, bits: impl ExactSizeIterator<Item = u32> + Clone) -> Option<&WebGlUniformLocation> {
        let held = &mut self.state.values[self.offset..self.offset + bits.len()];
        let field = self.field;
        self.field += 1;
        self.offset += bits.len();
        if self.state.is_uploaded && held.iter().copied().eq(bits.clone()) {
            return None;
        }
        for (slot, value) in held.iter_mut().zip(bits) {
            *slot = value;
        }
        self.state.locations[field].as_ref()
    }
}

impl UniformSink for ParamUpload<'_> {
    fn floats(&mut self, ty: UniformType, values: &[f32]) {
        let gl = self.gl;
        let Some(location) = self.store(values.iter().map(|v| v.to_bits())) else { return };
        let location = Some(location);
        match ty {
            UniformType::Float => gl.uniform1f(location, values[0]),
            UniformType::Vec2 => gl.uniform2f(location, values[0], values[1]),
            UniformType::Vec3 => gl.uniform3f(location, values[0], values[1], values[2]),
            UniformType::Vec4 => gl.uniform4f(location, values[0], values[1], values[2], values[3]),
            UniformType::Mat2 => gl.uniform_matrix2fv_with_f32_array(location, false, values),
            UniformType::Mat3 => gl.uniform_matrix3fv_with_f32_array(location, false, values),
            UniformType::FloatArray(_) => gl.uniform1fv_with_f32_array(location, values),
            UniformType::Vec4Array(_) => gl.uniform4fv_with_f32_array(location, values),
            UniformType::Int | UniformType::Uint | UniformType::Bool | UniformType::IVec2 => {}
        }
    }

    fn ints(&mut self, ty: UniformType, values: &[i32]) {
        let gl = self.gl;
        let Some(location) = self.store(values.iter().map(|v| *v as u32)) else { return };
        let location = Some(location);
        match ty {
            UniformType::Int | UniformType::Bool => gl.uniform1i(location, values[0]),
            UniformType::Uint => gl.uniform1ui(location, values[0] as u32),
            UniformType::IVec2 => gl.uniform2i(location, values[0], values[1]),
            _ => {}
        }
    }
}

impl LinkedProgram {
    fn new(program: WebGlProgram) -> Self {
        Self { program, uniforms: RefCell::new(HashMap::new()), params: RefCell::new(None) }
    }

    /// Calls `set` with the location of uniform `name`, if the program has
    /// one. Locations are cached, and handed out by reference: cloning one
    /// is a round trip into JS and back, which at a dozen uniforms a pass
    /// was a large part of what a pass cost on the CPU.
    pub(in crate::gpu) fn with_location(&self, gl: &WebGl2RenderingContext, name: &str, set: impl FnOnce(&WebGlUniformLocation)) {
        if !self.uniforms.borrow().contains_key(name) {
            let location = gl.get_uniform_location(&self.program, name);
            self.uniforms.borrow_mut().insert(name.to_string(), location);
        }
        if let Some(Some(location)) = self.uniforms.borrow().get(name) {
            set(location);
        }
    }

    /// The location of uniform `name`, cloned for a caller that keeps it.
    pub(in crate::gpu) fn location(&self, gl: &WebGl2RenderingContext, name: &str) -> Option<WebGlUniformLocation> {
        let mut location = None;
        self.with_location(gl, name, |found| location = Some(found.clone()));
        location
    }

    /// Makes the program's `Params` members hold the struct that `put`
    /// hands over, whose fields are `fields`. The program must be current.
    /// A member is only sent when its value changed: uniforms belong to the
    /// program and keep their value between passes, and they are written
    /// nowhere else.
    fn upload(&self, gl: &WebGl2RenderingContext, fields: &'static [Field], put: &dyn Fn(&mut ParamUpload)) {
        if fields.is_empty() {
            return;
        }
        let mut state = self.params.borrow_mut();
        let state = state.get_or_insert_with(|| ParamState {
            locations: fields
                .iter()
                .map(|field| gl.get_uniform_location(&self.program, &glsl_name(field.name)))
                .collect(),
            values: vec![0; fields.iter().map(|field| field.ty.components()).sum()],
            is_uploaded: false,
        });
        put(&mut ParamUpload { gl, state, field: 0, offset: 0 });
        state.is_uploaded = true;
    }
}

impl<P> ShaderProgram<P> {
    pub(in crate::gpu) fn linked(&self) -> &LinkedProgram {
        &self.linked
    }
}

/// Uploads `params` as `program`'s uniforms. `P` is the struct the program
/// was compiled for; see [`LinkedProgram::upload`].
pub(in crate::gpu) fn upload_params<P: Uniforms>(program: &LinkedProgram, gl: &WebGl2RenderingContext, params: &P) {
    program.upload(gl, P::FIELDS, &|sink| params.put(sink));
}

pub fn compile_shader(
    gl: &WebGl2RenderingContext,
    source: &str,
    shader_type: u32,
) -> Result<WebGlShader, String> {
    let shader = gl.create_shader(shader_type).ok_or("Failed to create shader")?;
    gl.shader_source(&shader, source);
    gl.compile_shader(&shader);

    if gl.get_shader_parameter(&shader, WebGl2RenderingContext::COMPILE_STATUS)
        .as_bool()
        .unwrap_or(false)
    {
        Ok(shader)
    } else {
        let log = gl.get_shader_info_log(&shader).unwrap_or_default();
        gl.delete_shader(Some(&shader));
        Err(format!("Shader compile error: {log}"))
    }
}

pub fn link_program(
    gl: &WebGl2RenderingContext,
    vert: &WebGlShader,
    frag: &WebGlShader,
) -> Result<WebGlProgram, String> {
    let program = gl.create_program().ok_or("Failed to create program")?;
    gl.attach_shader(&program, vert);
    gl.attach_shader(&program, frag);
    gl.link_program(&program);

    if gl.get_program_parameter(&program, WebGl2RenderingContext::LINK_STATUS)
        .as_bool()
        .unwrap_or(false)
    {
        Ok(program)
    } else {
        let log = gl.get_program_info_log(&program).unwrap_or_default();
        gl.delete_program(Some(&program));
        Err(format!("Program link error: {log}"))
    }
}

/// Minimal include preprocessor: splices shared helper blocks into a
/// fragment source. GLSL ES has no #include; this keeps the RGB<->HSL
/// math in one file instead of three diverging copies.
fn preprocess_frag(src: &str) -> String {
    src.replace("//#include hsl", HSL_COMMON)
        .replace("//#include premul_sample", PREMUL_SAMPLE)
        .replace("//#include lab", LAB_COMMON)
}

/// Injects `#define NAME VALUE` lines into a GLSL source. The `#version`
/// directive must stay on the first line, so the defines are spliced in
/// immediately after it (or prepended when there is no `#version`).
fn inject_defines(src: &str, defines: &[(&str, &str)]) -> String {
    if defines.is_empty() {
        return src.to_string();
    }
    let mut block = String::new();
    for (name, value) in defines {
        block.push_str("#define ");
        block.push_str(name);
        block.push(' ');
        block.push_str(value);
        block.push('\n');
    }
    match src.find('\n') {
        Some(pos) if src.starts_with("#version") => {
            format!("{}\n{}{}", &src[..pos], block, &src[pos + 1..])
        }
        _ => format!("{block}{src}"),
    }
}

/// Compiles a shader that takes the uniform struct `P`.
pub fn compile<P: Uniforms>(
    gl: &WebGl2RenderingContext,
    vert_src: &str,
    shader: &Shader<P>,
) -> Result<ShaderProgram<P>, String> {
    compile_with_defines(gl, vert_src, shader, &[])
}

/// [`compile`], with compile-time `#define`s injected into the fragment
/// source, for building specialized variants of one GLSL file.
pub fn compile_with_defines<P: Uniforms>(
    gl: &WebGl2RenderingContext,
    vert_src: &str,
    shader: &Shader<P>,
    defines: &[(&str, &str)],
) -> Result<ShaderProgram<P>, String> {
    Ok(ShaderProgram { linked: link(gl, vert_src, shader.frag, defines)?, marker: PhantomData })
}

fn link(
    gl: &WebGl2RenderingContext,
    vert_src: &str,
    frag_src: &str,
    defines: &[(&str, &str)],
) -> Result<LinkedProgram, String> {
    let frag_src = flatten_params_block(&inject_defines(&preprocess_frag(frag_src), defines));
    let vert = compile_shader(gl, vert_src, WebGl2RenderingContext::VERTEX_SHADER)?;
    let frag = compile_shader(gl, &frag_src, WebGl2RenderingContext::FRAGMENT_SHADER)?;
    let program = link_program(gl, &vert, &frag)?;
    gl.delete_shader(Some(&vert));
    gl.delete_shader(Some(&frag));
    Ok(LinkedProgram::new(program))
}

pub struct ShaderPrograms {
    // Core
    pub blit: ShaderProgram<()>,
    pub thumbnail_box: ShaderProgram<params::core::ThumbnailBoxParams>,
    pub blit_resample: ShaderProgram<()>,
    /// Blend program specialized for Normal mode (BLEND_MODE 0). Compiled at
    /// startup since nearly every composite pass uses it; the other modes are
    /// compiled lazily via `blend_for_mode`.
    pub blend_normal: Rc<ShaderProgram<params::composite::BlendParams>>,
    /// Lazily compiled blend program variants, keyed by blend mode. Each
    /// variant is its own `ShaderProgram` with its own uniform-location
    /// cache — locations must never be shared across program variants.
    blend_variants: RefCell<HashMap<i32, Rc<ShaderProgram<params::composite::BlendParams>>>>,
    /// For compiling a blend variant the first time a document uses its mode.
    gl: WebGl2RenderingContext,
    pub composite: ShaderProgram<params::composite::CompositeParams>,
    pub final_blit: ShaderProgram<params::composite::FinalBlitParams>,
    pub flip: ShaderProgram<params::core::FlipParams>,
    pub clipboard_copy: ShaderProgram<params::core::ClipboardCopyParams>,
    pub layer_mask_apply: ShaderProgram<params::effects::LayerMaskApplyParams>,
    pub clipboard_clear: ShaderProgram<params::core::ClipboardClearParams>,
    pub selection_fill: ShaderProgram<params::core::SelectionFillParams>,
    pub rotate90: ShaderProgram<params::core::Rotate90Params>,
    pub blit_region: ShaderProgram<params::core::BlitRegionParams>,
    pub mask_expand: ShaderProgram<()>,
    pub mask_remap: ShaderProgram<params::core::MaskRemapParams>,
    pub quick_mask_translate: ShaderProgram<params::core::QuickMaskTranslateParams>,
    pub transform_affine: ShaderProgram<params::core::TransformAffineParams>,
    pub transform_perspective: ShaderProgram<params::core::TransformPerspectiveParams>,
    // Effects
    pub glow: ShaderProgram<params::effects::GlowParams>,
    pub shadow: ShaderProgram<params::effects::ShadowParams>,
    pub separable_edt: ShaderProgram<params::effects::SeparableEdtParams>,
    pub stroke_apply: ShaderProgram<params::effects::StrokeApplyParams>,
    pub color_overlay: ShaderProgram<params::effects::ColorOverlayParams>,
    // Filters
    pub gaussian_blur: ShaderProgram<params::filters::GaussianBlurParams>,
    pub box_blur: ShaderProgram<params::filters::BoxBlurParams>,
    pub adjustments: ShaderProgram<params::filters::AdjustmentsParams>,
    pub hue_sat: ShaderProgram<params::filters::HueSatParams>,
    pub invert: ShaderProgram<()>,
    pub posterize: ShaderProgram<params::filters::PosterizeParams>,
    pub threshold: ShaderProgram<params::filters::ThresholdParams>,
    pub noise: ShaderProgram<params::filters::NoiseParams>,
    pub sharpen: ShaderProgram<params::filters::SharpenParams>,
    pub vignette: ShaderProgram<params::filters::VignetteParams>,
    pub motion_blur: ShaderProgram<params::filters::MotionBlurParams>,
    pub radial_blur: ShaderProgram<params::filters::RadialBlurParams>,
    pub find_edges: ShaderProgram<()>,
    pub cel_shading: ShaderProgram<params::filters::CelShadingParams>,
    pub clouds: ShaderProgram<params::filters::CloudsParams>,
    pub smoke: ShaderProgram<params::filters::SmokeParams>,
    pub pixelate: ShaderProgram<params::filters::PixelateParams>,
    pub pixelate_blocks: ShaderProgram<params::filters::PixelateBlocksParams>,
    pub halftone: ShaderProgram<params::filters::HalftoneParams>,
    pub solarize: ShaderProgram<params::filters::SolarizeParams>,
    pub kaleidoscope: ShaderProgram<params::filters::KaleidoscopeParams>,
    pub oil_paint: ShaderProgram<params::filters::OilPaintParams>,
    pub chromatic_aberration: ShaderProgram<params::filters::ChromaticAberrationParams>,
    pub pixel_stretch: ShaderProgram<params::filters::PixelStretchParams>,
    pub lens_distortion: ShaderProgram<params::filters::LensDistortionParams>,
    pub pattern_fill: ShaderProgram<params::filters::PatternFillParams>,
    pub mesh_warp: ShaderProgram<params::filters::MeshWarpParams>,
    pub liquify_warp: ShaderProgram<params::filters::LiquifyWarpParams>,
    pub bloom_threshold: ShaderProgram<params::filters::BloomThresholdParams>,
    pub bloom_combine: ShaderProgram<params::filters::BloomCombineParams>,
    pub tilt_shift_blur: ShaderProgram<params::filters::TiltShiftBlurParams>,
    pub emboss: ShaderProgram<params::filters::EmbossParams>,
    pub voronoi: ShaderProgram<params::filters::VoronoiParams>,
    pub selection_mask_blend: ShaderProgram<params::filters::SelectionMaskBlendParams>,
    pub surface_blur: ShaderProgram<params::filters::SurfaceBlurParams>,
    pub fibers: ShaderProgram<params::filters::FibersParams>,
    pub sunburst: ShaderProgram<params::filters::SunburstParams>,
    pub color_lut: ShaderProgram<params::filters::ColorLutParams>,
    pub texture: ShaderProgram<params::filters::TextureParams>,
    // Brush — these use fullscreen quad vert for now (dab positioning via uniforms)
    pub brush_dab_circle: ShaderProgram<params::brush::BrushDabParams>,
    pub brush_dab_alpha: ShaderProgram<params::brush::BrushDabParams>,
    pub brush_dab_color: ShaderProgram<params::brush::BrushDabParams>,
    pub eraser_dab: ShaderProgram<params::brush::EraserDabParams>,
    pub pencil_dab: ShaderProgram<params::brush::PencilDabParams>,
    pub quick_mask_dab: ShaderProgram<params::brush::QuickMaskDabParams>,
    pub content_bounds_reduce: ShaderProgram<params::core::ContentBoundsReduceParams>,
    pub dodge_burn: ShaderProgram<params::brush::CoverageApplyParams>,
    pub dodge_burn_dab: ShaderProgram<params::brush::DodgeBurnDabParams>,
    pub smudge_dab: ShaderProgram<params::brush::SmudgeDabParams>,
    pub clone_stamp: ShaderProgram<params::brush::CloneStampParams>,
    pub healing_dab: ShaderProgram<params::brush::HealingDabParams>,
    pub healing_mean: ShaderProgram<params::brush::HealingMeanParams>,
    pub opacity_clamp: ShaderProgram<params::brush::OpacityClampParams>,
    pub sponge: ShaderProgram<params::brush::CoverageApplyParams>,
    pub stamp_preview: ShaderProgram<params::brush::StampPreviewParams>,
    // Gradient
    pub gradient_linear: ShaderProgram<params::gradient::GradientLinearParams>,
    pub gradient_radial: ShaderProgram<params::gradient::GradientRadialParams>,
    // Shape
    pub shape_fill: ShaderProgram<params::shape::ShapeFillParams>,
    pub flood_fill_apply: ShaderProgram<params::shape::FloodFillApplyParams>,
    pub bucket_fill_color_match: ShaderProgram<params::shape::BucketFillColorMatchParams>,
    // Selection
    pub marching_ants: ShaderProgram<params::selection::MarchingAntsParams>,
    // Color
    pub color_convert: ShaderProgram<params::color::ColorConvertParams>,
    pub tonemap: ShaderProgram<params::color::TonemapParams>,
    pub mask_luminance: ShaderProgram<()>,
    pub liquify_dab: ShaderProgram<params::filters::LiquifyDabParams>,
    // Text
    pub text_glyph: ShaderProgram<params::text::TextGlyphParams>,
}

/// Compiles the blend shader specialized for a single blend mode.
fn compile_blend_variant(
    gl: &WebGl2RenderingContext,
    mode: i32,
) -> Result<ShaderProgram<params::composite::BlendParams>, String> {
    compile_with_defines(gl, FULLSCREEN_QUAD_VERT, &BLEND, &[("BLEND_MODE", &mode.to_string())])
}

impl ShaderPrograms {
    /// Returns the blend program specialized for `mode`, compiling and
    /// caching it on first use. Compiling all variants at startup would
    /// jank initial load, and most documents only ever use a few modes.
    /// Unknown modes fall back to Normal, matching the old uniform-driven
    /// shader's final `return s;` fallback.
    pub fn blend_for_mode(&self, mode: i32) -> Result<Rc<ShaderProgram<params::composite::BlendParams>>, String> {
        let max_mode = lopsy_core::color::BlendMode::ALL.len() as i32 - 1;
        let mode = if (0..=max_mode).contains(&mode) { mode } else { 0 };
        if let Some(program) = self.blend_variants.borrow().get(&mode) {
            return Ok(Rc::clone(program));
        }
        let program = Rc::new(compile_blend_variant(&self.gl, mode)?);
        self.blend_variants.borrow_mut().insert(mode, Rc::clone(&program));
        Ok(program)
    }

    pub fn compile_all(ctx: &crate::gpu::context::GpuContext) -> Result<Self, String> {
        let gl = &ctx.gl;
        let v = FULLSCREEN_QUAD_VERT;

        // Normal mode is seeded eagerly: it was compiled at startup before
        // specialization too, so this keeps startup cost unchanged while
        // letting fixed Normal-mode passes grab it infallibly.
        let blend_normal = Rc::new(compile_blend_variant(gl, 0)?);
        let blend_variants = RefCell::new(HashMap::from([(0, Rc::clone(&blend_normal))]));

        Ok(Self {
            // Core
            blit: compile(gl, v, &BLIT)?,
            thumbnail_box: compile(gl, v, &THUMBNAIL_BOX)?,
            blit_resample: compile(gl, v, &BLIT_RESAMPLE)?,
            blend_normal,
            blend_variants,
            gl: gl.clone(),
            composite: compile(gl, v, &COMPOSITE)?,
            final_blit: compile(gl, v, &FINAL_BLIT)?,
            flip: compile(gl, v, &FLIP)?,
            clipboard_copy: compile(gl, v, &CLIPBOARD_COPY)?,
            layer_mask_apply: compile(gl, v, &LAYER_MASK_APPLY)?,
            clipboard_clear: compile(gl, v, &CLIPBOARD_CLEAR)?,
            selection_fill: compile(gl, v, &SELECTION_FILL)?,
            rotate90: compile(gl, v, &ROTATE90)?,
            blit_region: compile(gl, v, &BLIT_REGION)?,
            mask_expand: compile(gl, v, &MASK_EXPAND)?,
            mask_remap: compile(gl, v, &MASK_REMAP)?,
            quick_mask_translate: compile(gl, v, &QUICK_MASK_TRANSLATE)?,
            transform_affine: compile(gl, v, &TRANSFORM_AFFINE)?,
            transform_perspective: compile(gl, v, &TRANSFORM_PERSPECTIVE)?,
            // Effects
            glow: compile(gl, v, &GLOW)?,
            shadow: compile(gl, v, &SHADOW)?,
            separable_edt: compile(gl, v, &SEPARABLE_EDT)?,
            stroke_apply: compile(gl, v, &STROKE_APPLY)?,
            color_overlay: compile(gl, v, &COLOR_OVERLAY)?,
            // Filters
            gaussian_blur: compile(gl, v, &GAUSSIAN_BLUR)?,
            box_blur: compile(gl, v, &BOX_BLUR)?,
            adjustments: compile(gl, v, &ADJUSTMENTS)?,
            hue_sat: compile(gl, v, &HUE_SAT)?,
            invert: compile(gl, v, &INVERT)?,
            posterize: compile(gl, v, &POSTERIZE)?,
            threshold: compile(gl, v, &THRESHOLD)?,
            noise: compile(gl, v, &NOISE)?,
            sharpen: compile(gl, v, &SHARPEN)?,
            vignette: compile(gl, v, &VIGNETTE)?,
            motion_blur: compile(gl, v, &MOTION_BLUR)?,
            radial_blur: compile(gl, v, &RADIAL_BLUR)?,
            find_edges: compile(gl, v, &FIND_EDGES)?,
            cel_shading: compile(gl, v, &CEL_SHADING)?,
            clouds: compile(gl, v, &CLOUDS)?,
            smoke: compile(gl, v, &SMOKE)?,
            pixelate: compile(gl, v, &PIXELATE)?,
            pixelate_blocks: compile(gl, v, &PIXELATE_BLOCKS)?,
            halftone: compile(gl, v, &HALFTONE)?,
            solarize: compile(gl, v, &SOLARIZE)?,
            kaleidoscope: compile(gl, v, &KALEIDOSCOPE)?,
            oil_paint: compile(gl, v, &OIL_PAINT)?,
            chromatic_aberration: compile(gl, v, &CHROMATIC_ABERRATION)?,
            pixel_stretch: compile(gl, v, &PIXEL_STRETCH)?,
            lens_distortion: compile(gl, v, &LENS_DISTORTION)?,
            pattern_fill: compile(gl, v, &PATTERN_FILL)?,
            mesh_warp: compile(gl, v, &MESH_WARP)?,
            liquify_warp: compile(gl, v, &LIQUIFY_WARP)?,
            bloom_threshold: compile(gl, v, &BLOOM_THRESHOLD)?,
            bloom_combine: compile(gl, v, &BLOOM_COMBINE)?,
            tilt_shift_blur: compile(gl, v, &TILT_SHIFT_BLUR)?,
            emboss: compile(gl, v, &EMBOSS)?,
            voronoi: compile(gl, v, &VORONOI)?,
            selection_mask_blend: compile(gl, v, &SELECTION_MASK_BLEND)?,
            surface_blur: compile(gl, v, &SURFACE_BLUR)?,
            fibers: compile(gl, v, &FIBERS)?,
            sunburst: compile(gl, v, &SUNBURST)?,
            color_lut: compile(gl, v, &COLOR_LUT)?,
            texture: compile(gl, v, &TEXTURE)?,
            // Brush — assembled from header + variant body + footer
            brush_dab_circle: compile(gl, v, &BRUSH_DAB_CIRCLE)?,
            brush_dab_alpha: compile(gl, v, &BRUSH_DAB_ALPHA)?,
            brush_dab_color: compile(gl, v, &BRUSH_DAB_COLOR)?,
            eraser_dab: compile(gl, v, &ERASER_DAB)?,
            pencil_dab: compile(gl, v, &PENCIL_DAB)?,
            quick_mask_dab: compile(gl, v, &QUICK_MASK_DAB)?,
            content_bounds_reduce: compile(gl, v, &CONTENT_BOUNDS_REDUCE)?,
            dodge_burn: compile(gl, v, &DODGE_BURN)?,
            dodge_burn_dab: compile(gl, v, &DODGE_BURN_DAB)?,
            smudge_dab: compile(gl, v, &SMUDGE_DAB)?,
            clone_stamp: compile(gl, v, &CLONE_STAMP)?,
            healing_dab: compile(gl, v, &HEALING_DAB)?,
            healing_mean: compile(gl, v, &HEALING_MEAN)?,
            opacity_clamp: compile(gl, v, &OPACITY_CLAMP)?,
            sponge: compile(gl, v, &SPONGE)?,
            stamp_preview: compile(gl, v, &STAMP_PREVIEW)?,
            // Gradient
            gradient_linear: compile(gl, v, &GRADIENT_LINEAR)?,
            gradient_radial: compile(gl, v, &GRADIENT_RADIAL)?,
            // Shape
            shape_fill: compile(gl, v, &SHAPE_FILL)?,
            flood_fill_apply: compile(gl, v, &FLOOD_FILL_APPLY)?,
            bucket_fill_color_match: compile(gl, v, &BUCKET_FILL_COLOR_MATCH)?,
            // Selection
            marching_ants: compile(gl, v, &MARCHING_ANTS)?,
            // Color
            color_convert: compile(gl, v, &COLOR_CONVERT)?,
            tonemap: compile(gl, v, &TONEMAP)?,
            mask_luminance: compile(gl, v, &MASK_LUMINANCE)?,
            liquify_dab: compile(gl, v, &LIQUIFY_DAB)?,
            // Text
            text_glyph: compile(gl, v, &TEXT_GLYPH)?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{
        inject_defines, preprocess_frag, typed_shader_checks, ADJUSTMENTS_FRAG, BLEND_FRAG, BLIT_RESAMPLE_FRAG, FINAL_BLIT_FRAG,
        OIL_PAINT_FRAG, SMUDGE_DAB_FRAG, VIGNETTE_FRAG, TRANSFORM_AFFINE_FRAG, TRANSFORM_PERSPECTIVE_FRAG, VORONOI_FRAG,
        TEXTURE_FRAG,
    };

    #[test]
    fn injects_defines_after_version_directive() {
        let src = "#version 300 es\nprecision highp float;\nvoid main() {}\n";
        let out = inject_defines(src, &[("BLEND_MODE", "7")]);
        assert_eq!(
            out,
            "#version 300 es\n#define BLEND_MODE 7\nprecision highp float;\nvoid main() {}\n"
        );
    }

    #[test]
    fn injects_multiple_defines_in_order() {
        let src = "#version 300 es\nvoid main() {}\n";
        let out = inject_defines(src, &[("A", "1"), ("B", "2")]);
        assert_eq!(out, "#version 300 es\n#define A 1\n#define B 2\nvoid main() {}\n");
    }

    #[test]
    fn prepends_defines_when_no_version_directive() {
        let src = "precision highp float;\nvoid main() {}\n";
        let out = inject_defines(src, &[("BLEND_MODE", "3")]);
        assert_eq!(out, "#define BLEND_MODE 3\nprecision highp float;\nvoid main() {}\n");
    }

    #[test]
    fn empty_defines_returns_source_unchanged() {
        let src = "#version 300 es\nvoid main() {}\n";
        assert_eq!(inject_defines(src, &[]), src);
    }

    #[test]
    fn resampling_shaders_filter_in_premultiplied_space() {
        for src in [
            TRANSFORM_AFFINE_FRAG,
            TRANSFORM_PERSPECTIVE_FRAG,
            BLIT_RESAMPLE_FRAG,
            SMUDGE_DAB_FRAG,
        ] {
            let out = preprocess_frag(src);
            assert!(!out.contains("//#include"), "unresolved include");
            assert!(out.contains("vec4 samplePremulBilinear("));
            assert!(!out.contains("texture(u_floatTex"), "straight-alpha hardware filtering");
        }
    }

    #[test]
    fn tonal_passes_work_on_decoded_lab() {
        // Adjustments and the vignette scale channel values, which only means
        // "darker" on sRGB; on encoded Lab it drags a/b toward blue (#1365).
        for src in [ADJUSTMENTS_FRAG, VIGNETTE_FRAG] {
            let out = preprocess_frag(src);
            assert!(out.contains("vec3 srgbToLab(vec3 srgb)"), "lab helpers not spliced in");
            assert!(out.contains("int u_docColorMode;"));
            assert!(out.contains("c.rgb = labToSrgb(c.rgb)"));
            assert!(out.contains("c.rgb = srgbToLab(c.rgb)"));
        }
        let blit = preprocess_frag(FINAL_BLIT_FRAG);
        assert!(blit.contains("vec3 labToSrgb(vec3 encoded)"));
    }

    #[test]
    fn blend_modes_work_on_decoded_lab() {
        // Multiply/Screen/… on encoded Lab turned a grey Multiply blue (#1372).
        let out = preprocess_frag(BLEND_FRAG);
        assert!(out.contains("vec3 srgbToLab(vec3 srgb)"), "lab helpers not spliced in");
        assert!(out.contains("int u_docColorMode;"));
        assert!(out.contains("srgbToLab(blendMode(labToSrgb(src.rgb), labToSrgb(backdrop.rgb)))"));
    }

    #[test]
    fn photo_filter_runs_after_black_and_white() {
        let bw = ADJUSTMENTS_FRAG
            .find("if (u_bwEnabled > 0.5)")
            .expect("Black & White block");
        let pf = ADJUSTMENTS_FRAG
            .find("if (u_pfDensity > 0.001)")
            .expect("Photo Filter block");
        assert!(
            bw < pf,
            "Black & White rebuilds RGB from a grey, so a Photo Filter before it loses its tint"
        );
    }

    #[test]
    fn voronoi_seeds_use_an_exact_integer_hash() {
        let code: String = VORONOI_FRAG
            .lines()
            .filter(|l| !l.trim_start().starts_with("//"))
            .collect();
        assert!(
            !code.contains("sin("),
            "a sin()-based hash is not reproducible across backends (Metal fast-math)"
        );
        assert!(VORONOI_FRAG.contains("uvec2 pcg2d(uvec2 v)"));
        assert!(
            VORONOI_FRAG.contains("if (x == 0 && y == 0) {"),
            "the nearest seed must be skipped by cell index, not by a recomputed position"
        );
        assert!(
            !VORONOI_FRAG.contains("dot(between, between) <"),
            "position-equality self-skip relies on bit-identical float recomputation"
        );
    }

    #[test]
    fn oil_paint_clamps_variance_before_pow() {
        assert!(
            OIL_PAINT_FRAG.contains("vec3 v = max(var_sum[i] / count[i] - m * m, vec3(0.0));"),
            "negative variance reaches pow() and turns flat colours black on Metal"
        );
    }

    #[test]
    fn texture_is_deterministic_and_alpha_preserving() {
        let code: String = TEXTURE_FRAG
            .lines()
            .filter(|l| !l.trim_start().starts_with("//"))
            .collect::<Vec<_>>()
            .join("\n");
        assert!(
            !code.contains("fract(sin"),
            "a sin()-based hash is not reproducible across backends (Metal fast-math)"
        );
        assert!(code.contains("uvec3 pcg3d(uvec3 v)"));
        assert!(code.contains("uint u_seed;"));
        assert!(
            code.contains("c & ivec2(0x7FFFFFFF)"),
            "negative lattice cells must be masked before the int -> uint conversion"
        );
        assert!(
            code.contains("fragColor = vec4(clamp(c.rgb + t * (u_amount * 0.6), 0.0, 1.0), c.a);"),
            "texture modulates existing pixels and keeps their alpha"
        );
        // Kind indices must match lopsy_core::filters::texture::TextureKind.
        for (kind, func) in [(1, "ridged("), (2, "canvasWeave("), (3, "fbm("), (4, "cells(")] {
            assert!(
                code.contains(&format!("if (u_kind == {kind}) return {func}")),
                "kind {kind} does not dispatch to {func}"
            );
        }
    }

    #[test]
    fn every_typed_shader_declares_its_uniform_struct_as_its_params_block() {
        let failures: Vec<String> = typed_shader_checks()
            .into_iter()
            .filter_map(|(name, result)| result.err().map(|why| format!("{name}: {why}")))
            .collect();
        assert!(failures.is_empty(), "{}", failures.join("\n"));
    }
}
