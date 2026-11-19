use std::borrow::Cow;
use std::cell::RefCell;
use std::collections::HashMap;
use std::marker::PhantomData;
use std::rc::Rc;

use crate::gpu::backend::program::{LinkedProgram, Linker};
use crate::gpu::params;
use crate::gpu::uniforms::Uniforms;

/// A fragment shader written in WGSL (`shaders/<path>.wgsl`), as the
/// backend compiles it. The build script (see `lopsy-shaderc`) translates
/// it to GLSL ES 3.00 for WebGL; wgpu takes the WGSL with its includes
/// spliced in.
#[cfg(not(feature = "wgpu"))]
macro_rules! translated {
    ($path:literal) => {
        include_str!(concat!(env!("OUT_DIR"), "/shaders/", $path, ".glsl"))
    };
}
#[cfg(feature = "wgpu")]
macro_rules! translated {
    ($path:literal) => {
        include_str!(concat!(env!("OUT_DIR"), "/shaders/", $path, ".wgsl"))
    };
}

// Core shaders
pub const BLIT_FRAG: &str = translated!("blit");
pub const COPY_EXACT_FRAG: &str = translated!("copy_exact");
pub const THUMBNAIL_BOX_FRAG: &str = translated!("thumbnail_box");
/// The generated GLSL of a shader that is built once per value of a define
/// (`lopsy_shaderc::VARIANT_SETS`). Variant 0 is stored whole. The others
/// are mostly the same text, so what they all start and end with is stored
/// once and each keeps only its middle.
pub struct VariantSources {
    first: &'static str,
    prefix: &'static str,
    middles: &'static [&'static str],
    suffix: &'static str,
}

impl VariantSources {
    pub fn count(&self) -> usize {
        1 + self.middles.len()
    }

    /// The source of variant `index`, which must be below `count()`.
    pub fn source(&self, index: usize) -> Cow<'static, str> {
        match index {
            0 => Cow::Borrowed(self.first),
            n => Cow::Owned([self.prefix, self.middles[n - 1], self.suffix].concat()),
        }
    }
}

/// `blend.wgsl`, one variant per blend mode in `BlendMode::ALL` order.
pub const BLEND_SOURCES: VariantSources = include!(concat!(env!("OUT_DIR"), "/shaders/blend.variants.rs"));
pub const BLEND_FRAG: &str = BLEND_SOURCES.first;
pub const BLIT_RESAMPLE_FRAG: &str = translated!("blit_resample");
pub const COMPOSITE_FRAG: &str = translated!("composite");
pub const FINAL_BLIT_FRAG: &str = translated!("final_blit");
pub const FLIP_FRAG: &str = translated!("flip");
pub const CLIPBOARD_COPY_FRAG: &str = translated!("clipboard_copy");
pub const CLIPBOARD_CLEAR_FRAG: &str = translated!("clipboard_clear");
pub const SELECTION_FILL_FRAG: &str = translated!("selection_fill");
pub const FRAME_FILL_FRAG: &str = translated!("frame_fill");
pub const ROTATE90_FRAG: &str = translated!("rotate90");
pub const BLIT_REGION_FRAG: &str = translated!("blit_region");
pub const MASK_EXPAND_FRAG: &str = translated!("mask_expand");
pub const MASK_REMAP_FRAG: &str = translated!("mask_remap");
pub const QUICK_MASK_TRANSLATE_FRAG: &str = translated!("quick_mask_translate");
pub const TRANSFORM_AFFINE_FRAG: &str = translated!("transform_affine");
pub const TRANSFORM_PERSPECTIVE_FRAG: &str = translated!("transform_perspective");

// Effects
pub const GLOW_FRAG: &str = translated!("effects/glow");
pub const SHADOW_FRAG: &str = translated!("effects/shadow");
pub const LAYER_MASK_APPLY_FRAG: &str = translated!("effects/layer_mask_apply");
pub const SEPARABLE_EDT_FRAG: &str = translated!("effects/separable_edt");
pub const STROKE_APPLY_FRAG: &str = translated!("effects/stroke_apply");

// Filters
pub const GAUSSIAN_BLUR_FRAG: &str = translated!("filters/gaussian_blur");
pub const BOX_BLUR_FRAG: &str = translated!("filters/box_blur");
pub const ADJUSTMENTS_FRAG: &str = translated!("filters/adjustments");
pub const HUE_SAT_FRAG: &str = translated!("filters/hue_sat");
pub const INVERT_FRAG: &str = translated!("filters/invert");
pub const MASK_LUMINANCE_FRAG: &str = translated!("filters/mask_luminance");
pub const POSTERIZE_FRAG: &str = translated!("filters/posterize");
pub const THRESHOLD_FRAG: &str = translated!("filters/threshold");
pub const NOISE_FRAG: &str = translated!("filters/noise");
pub const SHARPEN_FRAG: &str = translated!("filters/sharpen");
pub const VIGNETTE_FRAG: &str = translated!("filters/vignette");
pub const MOTION_BLUR_FRAG: &str = translated!("filters/motion_blur");
pub const RADIAL_BLUR_FRAG: &str = translated!("filters/radial_blur");
pub const FIND_EDGES_FRAG: &str = translated!("filters/find_edges");
pub const CEL_SHADING_FRAG: &str = translated!("filters/cel_shading");
pub const CLOUDS_FRAG: &str = translated!("filters/clouds");
pub const SMOKE_FRAG: &str = translated!("filters/smoke");
pub const PIXELATE_FRAG: &str = translated!("filters/pixelate");
pub const PIXELATE_BLOCKS_FRAG: &str = translated!("filters/pixelate_blocks");
pub const HALFTONE_FRAG: &str = translated!("filters/halftone");
pub const SOLARIZE_FRAG: &str = translated!("filters/solarize");
pub const KALEIDOSCOPE_FRAG: &str = translated!("filters/kaleidoscope");
pub const OIL_PAINT_FRAG: &str = translated!("filters/oil_paint");
pub const CHROMATIC_ABERRATION_FRAG: &str = translated!("filters/chromatic_aberration");
pub const PIXEL_STRETCH_FRAG: &str = translated!("filters/pixel_stretch");
pub const LENS_DISTORTION_FRAG: &str = translated!("filters/lens_distortion");
pub const PATTERN_FILL_FRAG: &str = translated!("filters/pattern_fill");
pub const MESH_WARP_FRAG: &str = translated!("filters/mesh_warp");
pub const LIQUIFY_WARP_FRAG: &str = translated!("filters/liquify_warp");
pub const BLOOM_THRESHOLD_FRAG: &str = translated!("filters/bloom_threshold");
pub const BLOOM_COMBINE_FRAG: &str = translated!("filters/bloom_combine");
pub const TILT_SHIFT_BLUR_FRAG: &str = translated!("filters/tilt_shift_blur");
pub const EMBOSS_FRAG: &str = translated!("filters/emboss");
pub const VORONOI_FRAG: &str = translated!("filters/voronoi");
pub const SELECTION_MASK_BLEND_FRAG: &str = translated!("filters/selection_mask_blend");
pub const SURFACE_BLUR_FRAG: &str = translated!("filters/surface_blur");
pub const LIQUIFY_DAB_FRAG: &str = translated!("filters/liquify_dab");
pub const FIBERS_FRAG: &str = translated!("filters/fibers");
pub const SUNBURST_FRAG: &str = translated!("filters/sunburst");
pub const COLOR_LUT_FRAG: &str = translated!("filters/color_lut");
pub const TEXTURE_FRAG: &str = translated!("filters/texture");

// Brush: each file is the shared header include, its own computeDab and
// the shared footer include.
const BRUSH_DAB_CIRCLE_FRAG: &str = translated!("brush/brush_dab_circle");
const BRUSH_DAB_ALPHA_FRAG: &str = translated!("brush/brush_dab_alpha");
const BRUSH_DAB_COLOR_FRAG: &str = translated!("brush/brush_dab_color");
pub const ERASER_DAB_FRAG: &str = translated!("brush/eraser_dab");
pub const PENCIL_DAB_FRAG: &str = translated!("brush/pencil_dab");
pub const QUICK_MASK_DAB_FRAG: &str = translated!("brush/quick_mask_dab");
pub const CONTENT_BOUNDS_REDUCE_FRAG: &str = translated!("content_bounds_reduce");
pub const DODGE_BURN_FRAG: &str = translated!("brush/dodge_burn");
pub const DODGE_BURN_DAB_FRAG: &str = translated!("brush/dodge_burn_dab");
pub const SMUDGE_DAB_FRAG: &str = translated!("brush/smudge_dab");
pub const CLONE_STAMP_FRAG: &str = translated!("brush/clone_stamp");
pub const HEALING_DAB_FRAG: &str = translated!("brush/healing_dab");
pub const HEALING_MEAN_FRAG: &str = translated!("brush/healing_mean");
pub const SPONGE_FRAG: &str = translated!("brush/sponge");
pub const STAMP_PREVIEW_FRAG: &str = translated!("brush/stamp_preview");

// Gradient
pub const GRADIENT_LINEAR_FRAG: &str = translated!("gradient/gradient_linear");
pub const GRADIENT_RADIAL_FRAG: &str = translated!("gradient/gradient_radial");

// Shape
pub const SHAPE_FILL_FRAG: &str = translated!("shape/shape_fill");
pub const FLOOD_FILL_APPLY_FRAG: &str = translated!("shape/flood_fill_apply");
pub const BUCKET_FILL_COLOR_MATCH_FRAG: &str = translated!("shape/bucket_fill_color_match");

// Color
pub const COLOR_CONVERT_FRAG: &str = translated!("color/color_convert");

// Develop
pub const RAW_DEVELOP_FRAG: &str = translated!("develop/raw_develop");
pub const COLOR_MIXER_FRAG: &str = translated!("develop/color_mixer");
pub const AREAS_FRAG: &str = translated!("develop/areas");
pub const CLIP_WARNING_FRAG: &str = translated!("develop/clip_warning");
pub const FINISH_FRAG: &str = translated!("develop/finish");
pub const BLUR_AXIS_FRAG: &str = translated!("develop/blur_axis");
pub const NOISE_REDUCE_FRAG: &str = translated!("develop/noise_reduce");
pub const DETAIL_SHARPEN_FRAG: &str = translated!("develop/detail_sharpen");
pub const LOCAL_CONTRAST_FRAG: &str = translated!("develop/local_contrast");

/// Declares the typed shaders: each source tagged with the uniform struct
/// its passes are created with. A test checks every struct against its
/// source's `Params` block.
macro_rules! typed_shaders {
    ($($name:ident: $params:ty = $frag:expr;)*) => {
        $(pub const $name: Shader<$params> = Shader::new($frag);)*

        #[cfg(all(test, not(feature = "wgpu")))]
        fn typed_shader_checks() -> Vec<(&'static str, Result<(), String>)> {
            vec![$((
                stringify!($name),
                crate::gpu::uniforms::check::struct_matches_source::<$params>($name.frag),
            )),*]
        }

        #[cfg(all(test, feature = "wgpu"))]
        fn typed_shader_checks() -> Vec<(&'static str, Result<(), String>)> {
            vec![$((
                stringify!($name),
                crate::gpu::backend::program::check::struct_matches_source::<$params>($name.frag),
            )),*]
        }
    };
}

typed_shaders! {
    BLIT: () = BLIT_FRAG;
    COPY_EXACT: () = COPY_EXACT_FRAG;
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
    FRAME_FILL: params::core::FrameFillParams = FRAME_FILL_FRAG;
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
    RAW_DEVELOP: params::develop::RawDevelopParams = RAW_DEVELOP_FRAG;
    COLOR_MIXER: params::develop::ColorMixerParams = COLOR_MIXER_FRAG;
    AREAS: params::develop::AreasParams = AREAS_FRAG;
    CLIP_WARNING: params::develop::ClipWarningParams = CLIP_WARNING_FRAG;
    FINISH: params::develop::FinishParams = FINISH_FRAG;
    BLUR_AXIS: params::develop::BlurAxisParams = BLUR_AXIS_FRAG;
    NOISE_REDUCE: params::develop::NoiseReduceParams = NOISE_REDUCE_FRAG;
    DETAIL_SHARPEN: params::develop::DetailSharpenParams = DETAIL_SHARPEN_FRAG;
    LOCAL_CONTRAST: params::develop::LocalContrastParams = LOCAL_CONTRAST_FRAG;
    GRADIENT_LINEAR: params::gradient::GradientLinearParams = GRADIENT_LINEAR_FRAG;
    GRADIENT_RADIAL: params::gradient::GradientRadialParams = GRADIENT_RADIAL_FRAG;
    SHAPE_FILL: params::shape::ShapeFillParams = SHAPE_FILL_FRAG;
    FLOOD_FILL_APPLY: params::shape::FloodFillApplyParams = FLOOD_FILL_APPLY_FRAG;
    BUCKET_FILL_COLOR_MATCH: params::shape::BucketFillColorMatchParams = BUCKET_FILL_COLOR_MATCH_FRAG;
    ERASER_DAB: params::brush::EraserDabParams = ERASER_DAB_FRAG;
    PENCIL_DAB: params::brush::PencilDabParams = PENCIL_DAB_FRAG;
    QUICK_MASK_DAB: params::brush::QuickMaskDabParams = QUICK_MASK_DAB_FRAG;
    DODGE_BURN: params::brush::CoverageApplyParams = DODGE_BURN_FRAG;
    DODGE_BURN_DAB: params::brush::DodgeBurnDabParams = DODGE_BURN_DAB_FRAG;
    SMUDGE_DAB: params::brush::SmudgeDabParams = SMUDGE_DAB_FRAG;
    CLONE_STAMP: params::brush::CloneStampParams = CLONE_STAMP_FRAG;
    HEALING_DAB: params::brush::HealingDabParams = HEALING_DAB_FRAG;
    HEALING_MEAN: params::brush::HealingMeanParams = HEALING_MEAN_FRAG;
    SPONGE: params::brush::CoverageApplyParams = SPONGE_FRAG;
    STAMP_PREVIEW: params::brush::StampPreviewParams = STAMP_PREVIEW_FRAG;
    BRUSH_DAB_CIRCLE: params::brush::BrushDabParams = BRUSH_DAB_CIRCLE_FRAG;
    BRUSH_DAB_ALPHA: params::brush::BrushDabParams = BRUSH_DAB_ALPHA_FRAG;
    BRUSH_DAB_COLOR: params::brush::BrushDabParams = BRUSH_DAB_COLOR_FRAG;
    GLOW: params::effects::GlowParams = GLOW_FRAG;
    SHADOW: params::effects::ShadowParams = SHADOW_FRAG;
    SEPARABLE_EDT: params::effects::SeparableEdtParams = SEPARABLE_EDT_FRAG;
    STROKE_APPLY: params::effects::StrokeApplyParams = STROKE_APPLY_FRAG;
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

impl<P> ShaderProgram<P> {
    pub(in crate::gpu) fn linked(&self) -> &LinkedProgram {
        &self.linked
    }
}

/// The program in `slot`, compiling it with `make` the first time. A failed
/// compile is not cached, so a later call tries again.
fn lazily<P>(
    slot: &RefCell<Option<Rc<ShaderProgram<P>>>>,
    make: impl FnOnce() -> Result<ShaderProgram<P>, String>,
) -> Result<Rc<ShaderProgram<P>>, String> {
    if let Some(program) = slot.borrow().as_ref() {
        return Ok(Rc::clone(program));
    }
    let program = Rc::new(make()?);
    *slot.borrow_mut() = Some(Rc::clone(&program));
    Ok(program)
}

/// Compiles a shader that takes the uniform struct `P`.
fn compile<P: Uniforms>(linker: &Linker, shader: &Shader<P>) -> Result<ShaderProgram<P>, String> {
    Ok(ShaderProgram { linked: linker.link(shader.frag)?, marker: PhantomData })
}

pub struct ShaderPrograms {
    // Core
    pub blit: ShaderProgram<()>,
    /// Texel-for-texel copy between textures of one size; never filters.
    pub copy_exact: ShaderProgram<()>,
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
    linker: Linker,
    pub composite: ShaderProgram<params::composite::CompositeParams>,
    pub final_blit: ShaderProgram<params::composite::FinalBlitParams>,
    pub flip: ShaderProgram<params::core::FlipParams>,
    pub clipboard_copy: ShaderProgram<params::core::ClipboardCopyParams>,
    pub layer_mask_apply: ShaderProgram<params::effects::LayerMaskApplyParams>,
    pub clipboard_clear: ShaderProgram<params::core::ClipboardClearParams>,
    pub selection_fill: ShaderProgram<params::core::SelectionFillParams>,
    pub frame_fill: ShaderProgram<params::core::FrameFillParams>,
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
    // Color
    pub color_convert: ShaderProgram<params::color::ColorConvertParams>,
    // Develop
    /// The Photonamous develop passes, compiled on first use (`raw_develop()`,
    /// `color_mixer()`) so a Lopsy session never links them.
    raw_develop: RefCell<Option<Rc<ShaderProgram<params::develop::RawDevelopParams>>>>,
    color_mixer: RefCell<Option<Rc<ShaderProgram<params::develop::ColorMixerParams>>>>,
    areas: RefCell<Option<Rc<ShaderProgram<params::develop::AreasParams>>>>,
    clip_warning: RefCell<Option<Rc<ShaderProgram<params::develop::ClipWarningParams>>>>,
    finish: RefCell<Option<Rc<ShaderProgram<params::develop::FinishParams>>>>,
    blur_axis: RefCell<Option<Rc<ShaderProgram<params::develop::BlurAxisParams>>>>,
    noise_reduce: RefCell<Option<Rc<ShaderProgram<params::develop::NoiseReduceParams>>>>,
    detail_sharpen: RefCell<Option<Rc<ShaderProgram<params::develop::DetailSharpenParams>>>>,
    local_contrast: RefCell<Option<Rc<ShaderProgram<params::develop::LocalContrastParams>>>>,
    pub mask_luminance: ShaderProgram<()>,
    pub liquify_dab: ShaderProgram<params::filters::LiquifyDabParams>,
    // Text
}

/// Compiles the blend shader specialized for a single blend mode.
fn compile_blend_variant(
    linker: &Linker,
    mode: i32,
) -> Result<ShaderProgram<params::composite::BlendParams>, String> {
    let source = BLEND_SOURCES.source(mode as usize);
    Ok(ShaderProgram { linked: linker.link(&source)?, marker: PhantomData })
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
        let program = Rc::new(compile_blend_variant(&self.linker, mode)?);
        self.blend_variants.borrow_mut().insert(mode, Rc::clone(&program));
        Ok(program)
    }

    /// `develop/raw_develop.wgsl`, compiled the first time it is asked for.
    pub fn raw_develop(&self) -> Result<Rc<ShaderProgram<params::develop::RawDevelopParams>>, String> {
        lazily(&self.raw_develop, || compile(&self.linker, &RAW_DEVELOP))
    }

    /// `develop/color_mixer.wgsl`, compiled the first time it is asked for.
    pub fn color_mixer(&self) -> Result<Rc<ShaderProgram<params::develop::ColorMixerParams>>, String> {
        lazily(&self.color_mixer, || compile(&self.linker, &COLOR_MIXER))
    }

    /// `develop/areas.wgsl`, compiled the first time it is asked for.
    pub fn areas(&self) -> Result<Rc<ShaderProgram<params::develop::AreasParams>>, String> {
        lazily(&self.areas, || compile(&self.linker, &AREAS))
    }

    /// `develop/clip_warning.wgsl`, compiled the first time it is asked for.
    pub fn clip_warning(&self) -> Result<Rc<ShaderProgram<params::develop::ClipWarningParams>>, String> {
        lazily(&self.clip_warning, || compile(&self.linker, &CLIP_WARNING))
    }

    /// `develop/finish.wgsl`, compiled the first time it is asked for.
    pub fn finish(&self) -> Result<Rc<ShaderProgram<params::develop::FinishParams>>, String> {
        lazily(&self.finish, || compile(&self.linker, &FINISH))
    }

    /// `develop/blur_axis.wgsl`, compiled the first time it is asked for.
    pub fn blur_axis(&self) -> Result<Rc<ShaderProgram<params::develop::BlurAxisParams>>, String> {
        lazily(&self.blur_axis, || compile(&self.linker, &BLUR_AXIS))
    }

    /// `develop/noise_reduce.wgsl`, compiled the first time it is asked for.
    pub fn noise_reduce(&self) -> Result<Rc<ShaderProgram<params::develop::NoiseReduceParams>>, String> {
        lazily(&self.noise_reduce, || compile(&self.linker, &NOISE_REDUCE))
    }

    /// `develop/detail_sharpen.wgsl`, compiled the first time it is asked for.
    pub fn detail_sharpen(&self) -> Result<Rc<ShaderProgram<params::develop::DetailSharpenParams>>, String> {
        lazily(&self.detail_sharpen, || compile(&self.linker, &DETAIL_SHARPEN))
    }

    /// `develop/local_contrast.wgsl`, compiled the first time it is asked for.
    pub fn local_contrast(&self) -> Result<Rc<ShaderProgram<params::develop::LocalContrastParams>>, String> {
        lazily(&self.local_contrast, || compile(&self.linker, &LOCAL_CONTRAST))
    }

    pub fn compile_all(ctx: &crate::gpu::context::GpuContext) -> Result<Self, String> {
        let linker = &ctx.linker();

        // Normal mode is seeded eagerly: it was compiled at startup before
        // specialization too, so this keeps startup cost unchanged while
        // letting fixed Normal-mode passes grab it infallibly.
        let blend_normal = Rc::new(compile_blend_variant(linker, 0)?);
        let blend_variants = RefCell::new(HashMap::from([(0, Rc::clone(&blend_normal))]));

        Ok(Self {
            // Core
            blit: compile(linker, &BLIT)?,
            copy_exact: compile(linker, &COPY_EXACT)?,
            thumbnail_box: compile(linker, &THUMBNAIL_BOX)?,
            blit_resample: compile(linker, &BLIT_RESAMPLE)?,
            blend_normal,
            blend_variants,
            linker: linker.clone(),
            composite: compile(linker, &COMPOSITE)?,
            final_blit: compile(linker, &FINAL_BLIT)?,
            flip: compile(linker, &FLIP)?,
            clipboard_copy: compile(linker, &CLIPBOARD_COPY)?,
            layer_mask_apply: compile(linker, &LAYER_MASK_APPLY)?,
            clipboard_clear: compile(linker, &CLIPBOARD_CLEAR)?,
            selection_fill: compile(linker, &SELECTION_FILL)?,
            frame_fill: compile(linker, &FRAME_FILL)?,
            rotate90: compile(linker, &ROTATE90)?,
            blit_region: compile(linker, &BLIT_REGION)?,
            mask_expand: compile(linker, &MASK_EXPAND)?,
            mask_remap: compile(linker, &MASK_REMAP)?,
            quick_mask_translate: compile(linker, &QUICK_MASK_TRANSLATE)?,
            transform_affine: compile(linker, &TRANSFORM_AFFINE)?,
            transform_perspective: compile(linker, &TRANSFORM_PERSPECTIVE)?,
            // Effects
            glow: compile(linker, &GLOW)?,
            shadow: compile(linker, &SHADOW)?,
            separable_edt: compile(linker, &SEPARABLE_EDT)?,
            stroke_apply: compile(linker, &STROKE_APPLY)?,
            // Filters
            gaussian_blur: compile(linker, &GAUSSIAN_BLUR)?,
            box_blur: compile(linker, &BOX_BLUR)?,
            adjustments: compile(linker, &ADJUSTMENTS)?,
            hue_sat: compile(linker, &HUE_SAT)?,
            invert: compile(linker, &INVERT)?,
            posterize: compile(linker, &POSTERIZE)?,
            threshold: compile(linker, &THRESHOLD)?,
            noise: compile(linker, &NOISE)?,
            sharpen: compile(linker, &SHARPEN)?,
            vignette: compile(linker, &VIGNETTE)?,
            motion_blur: compile(linker, &MOTION_BLUR)?,
            radial_blur: compile(linker, &RADIAL_BLUR)?,
            find_edges: compile(linker, &FIND_EDGES)?,
            cel_shading: compile(linker, &CEL_SHADING)?,
            clouds: compile(linker, &CLOUDS)?,
            smoke: compile(linker, &SMOKE)?,
            pixelate: compile(linker, &PIXELATE)?,
            pixelate_blocks: compile(linker, &PIXELATE_BLOCKS)?,
            halftone: compile(linker, &HALFTONE)?,
            solarize: compile(linker, &SOLARIZE)?,
            kaleidoscope: compile(linker, &KALEIDOSCOPE)?,
            oil_paint: compile(linker, &OIL_PAINT)?,
            chromatic_aberration: compile(linker, &CHROMATIC_ABERRATION)?,
            pixel_stretch: compile(linker, &PIXEL_STRETCH)?,
            lens_distortion: compile(linker, &LENS_DISTORTION)?,
            pattern_fill: compile(linker, &PATTERN_FILL)?,
            mesh_warp: compile(linker, &MESH_WARP)?,
            liquify_warp: compile(linker, &LIQUIFY_WARP)?,
            bloom_threshold: compile(linker, &BLOOM_THRESHOLD)?,
            bloom_combine: compile(linker, &BLOOM_COMBINE)?,
            tilt_shift_blur: compile(linker, &TILT_SHIFT_BLUR)?,
            emboss: compile(linker, &EMBOSS)?,
            voronoi: compile(linker, &VORONOI)?,
            selection_mask_blend: compile(linker, &SELECTION_MASK_BLEND)?,
            surface_blur: compile(linker, &SURFACE_BLUR)?,
            fibers: compile(linker, &FIBERS)?,
            sunburst: compile(linker, &SUNBURST)?,
            color_lut: compile(linker, &COLOR_LUT)?,
            texture: compile(linker, &TEXTURE)?,
            // Brush — assembled from header + variant body + footer
            brush_dab_circle: compile(linker, &BRUSH_DAB_CIRCLE)?,
            brush_dab_alpha: compile(linker, &BRUSH_DAB_ALPHA)?,
            brush_dab_color: compile(linker, &BRUSH_DAB_COLOR)?,
            eraser_dab: compile(linker, &ERASER_DAB)?,
            pencil_dab: compile(linker, &PENCIL_DAB)?,
            quick_mask_dab: compile(linker, &QUICK_MASK_DAB)?,
            content_bounds_reduce: compile(linker, &CONTENT_BOUNDS_REDUCE)?,
            dodge_burn: compile(linker, &DODGE_BURN)?,
            dodge_burn_dab: compile(linker, &DODGE_BURN_DAB)?,
            smudge_dab: compile(linker, &SMUDGE_DAB)?,
            clone_stamp: compile(linker, &CLONE_STAMP)?,
            healing_dab: compile(linker, &HEALING_DAB)?,
            healing_mean: compile(linker, &HEALING_MEAN)?,
            sponge: compile(linker, &SPONGE)?,
            stamp_preview: compile(linker, &STAMP_PREVIEW)?,
            // Gradient
            gradient_linear: compile(linker, &GRADIENT_LINEAR)?,
            gradient_radial: compile(linker, &GRADIENT_RADIAL)?,
            // Shape
            shape_fill: compile(linker, &SHAPE_FILL)?,
            flood_fill_apply: compile(linker, &FLOOD_FILL_APPLY)?,
            bucket_fill_color_match: compile(linker, &BUCKET_FILL_COLOR_MATCH)?,
            // Selection
            // Color
            color_convert: compile(linker, &COLOR_CONVERT)?,
            raw_develop: RefCell::new(None),
            color_mixer: RefCell::new(None),
            areas: RefCell::new(None),
            clip_warning: RefCell::new(None),
            finish: RefCell::new(None),
            blur_axis: RefCell::new(None),
            noise_reduce: RefCell::new(None),
            detail_sharpen: RefCell::new(None),
            local_contrast: RefCell::new(None),
            mask_luminance: compile(linker, &MASK_LUMINANCE)?,
            liquify_dab: compile(linker, &LIQUIFY_DAB)?,
            // Text
        })
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn tonal_passes_work_on_decoded_lab() {
        // Adjustments and the vignette scale channel values, which only means
        // "darker" on sRGB; on encoded Lab it drags a/b toward blue (#1365).
        for src in [
            include_str!("shaders/filters/adjustments.wgsl"),
            include_str!("shaders/filters/vignette.wgsl"),
        ] {
            assert!(src.contains("//#include lab"), "lab helpers not spliced in");
            assert!(src.contains("u_docColorMode: i32,"));
            assert!(src.contains("rgb = labToSrgb(rgb)"));
            assert!(src.contains("rgb = srgbToLab(rgb)"));
        }
        let blit = include_str!("shaders/final_blit.wgsl");
        assert!(blit.contains("//#include lab"), "lab helpers not spliced in");
        assert!(blit.contains("labToSrgb(color.rgb)"));
    }

    #[test]
    fn blend_modes_work_on_decoded_lab() {
        // Multiply/Screen/… on encoded Lab turned a grey Multiply blue (#1372).
        let source = include_str!("shaders/blend.wgsl");
        assert!(source.contains("//#include lab"), "lab helpers not spliced in");
        assert!(source.contains("u_docColorMode: i32,"));
        assert!(source.contains("srgbToLab(blendMode(labToSrgb(srcRGB), labToSrgb(backdrop.rgb)))"));
    }

    #[test]
    fn photo_filter_runs_after_black_and_white() {
        let source = include_str!("shaders/filters/adjustments.wgsl");
        let bw = source
            .find("if (params.u_bwEnabled > 0.5)")
            .expect("Black & White block");
        let pf = source
            .find("if (params.u_pfDensity > 0.001)")
            .expect("Photo Filter block");
        assert!(
            bw < pf,
            "Black & White rebuilds RGB from a grey, so a Photo Filter before it loses its tint"
        );
    }

    #[test]
    fn voronoi_seeds_use_an_exact_integer_hash() {
        let source = include_str!("shaders/filters/voronoi.wgsl");
        let code: String = source
            .lines()
            .filter(|l| !l.trim_start().starts_with("//"))
            .collect();
        assert!(
            !code.contains("sin("),
            "a sin()-based hash is not reproducible across backends (Metal fast-math)"
        );
        assert!(source.contains("fn pcg2d(value: vec2<u32>) -> vec2<u32>"));
        assert!(
            source.contains("if (x == 0 && y == 0) {"),
            "the nearest seed must be skipped by cell index, not by a recomputed position"
        );
        assert!(
            !source.contains("dot(between, between) <"),
            "position-equality self-skip relies on bit-identical float recomputation"
        );
    }

    #[test]
    fn oil_paint_clamps_variance_before_pow() {
        assert!(
            include_str!("shaders/filters/oil_paint.wgsl")
                .contains("let v = max(varSum[i] / count[i] - m * m, vec3<f32>(0.0));"),
            "negative variance reaches pow() and turns flat colours black on Metal"
        );
    }

    #[test]
    fn texture_is_deterministic_and_alpha_preserving() {
        let code: String = include_str!("shaders/filters/texture.wgsl")
            .lines()
            .filter(|l| !l.trim_start().starts_with("//"))
            .collect::<Vec<_>>()
            .join("\n");
        assert!(
            !code.contains("fract(sin"),
            "a sin()-based hash is not reproducible across backends (Metal fast-math)"
        );
        assert!(code.contains("fn pcg3d(value: vec3<u32>) -> vec3<u32>"));
        assert!(code.contains("u_seed: u32,"));
        assert!(
            code.contains("c & vec2<i32>(0x7FFFFFFF)"),
            "negative lattice cells must be masked before the int -> uint conversion"
        );
        assert!(
            code.contains("clamp(c.rgb + t * (params.u_amount * 0.6), vec3<f32>(0.0), vec3<f32>(1.0)), c.a);"),
            "texture modulates existing pixels and keeps their alpha"
        );
        // Kind indices must match lopsy_core::filters::texture::TextureKind.
        for (kind, func) in [(1, "ridged("), (2, "canvasWeave("), (3, "fbm("), (4, "cells(")] {
            assert!(
                code.contains(&format!("if (params.u_kind == {kind}) {{ return {func}")),
                "kind {kind} does not dispatch to {func}"
            );
        }
    }

    /// What the generated GLSL holds. The wgpu build embeds WGSL in its
    /// place, so these are for the WebGL build.
    #[cfg(not(feature = "wgpu"))]
    mod generated_glsl {
        use super::super::*;

        #[test]
        fn only_normal_skips_the_blend_function() {
            // Normal is a plain lerp: it must not decode Lab or read the backdrop.
            assert!(!BLEND_SOURCES.source(0).contains("blendMode("));
            for mode in 1..BLEND_SOURCES.count() {
                assert!(BLEND_SOURCES.source(mode).contains("vec3 blendMode("), "mode {mode}");
            }
        }

        #[test]
        fn resampling_shaders_filter_in_premultiplied_space() {
            for src in [
                TRANSFORM_AFFINE_FRAG,
                TRANSFORM_PERSPECTIVE_FRAG,
                BLIT_RESAMPLE_FRAG,
                SMUDGE_DAB_FRAG,
            ] {
                assert!(src.contains("vec4 samplePremulBilinear("));
                assert!(!src.contains("texture(u_floatTex"), "straight-alpha hardware filtering");
            }
        }

        #[test]
        fn every_blend_mode_has_a_variant_that_takes_the_blend_uniforms() {
            assert_eq!(BLEND_SOURCES.count(), lopsy_core::color::BlendMode::ALL.len());
            for mode in 0..BLEND_SOURCES.count() {
                let check = crate::gpu::uniforms::check::struct_matches_source::<crate::gpu::params::composite::BlendParams>;
                assert_eq!(check(&BLEND_SOURCES.source(mode)), Ok(()), "mode {mode}");
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
    /// The wgpu build uploads a uniform struct as the bytes of the shader's
    /// `Params`, so the Rust packing must land every field where naga put
    /// the member.
    #[cfg(feature = "wgpu")]
    mod wgsl_layout {
        use super::super::*;
        use crate::gpu::backend::program::check::struct_matches_source;

        #[test]
        fn every_blend_mode_has_a_variant_that_takes_the_blend_uniforms() {
            assert_eq!(BLEND_SOURCES.count(), lopsy_core::color::BlendMode::ALL.len());
            for mode in 0..BLEND_SOURCES.count() {
                let check = struct_matches_source::<crate::gpu::params::composite::BlendParams>;
                assert_eq!(check(&BLEND_SOURCES.source(mode)), Ok(()), "mode {mode}");
            }
        }

        #[test]
        fn every_typed_shader_packs_its_uniform_struct_as_its_params_bytes() {
            let failures: Vec<String> = typed_shader_checks()
                .into_iter()
                .filter_map(|(name, result)| result.err().map(|why| format!("{name}: {why}")))
                .collect();
            assert!(failures.is_empty(), "{}", failures.join("\n"));
        }
    }
}
