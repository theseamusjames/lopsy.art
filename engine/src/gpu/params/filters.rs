use crate::gpu::uniforms::{uniforms, Vec4Array};

uniforms! {
    /// `filters/posterize.wgsl`
    pub struct PosterizeParams {
        pub levels: f32,
    }
}

uniforms! {
    /// `filters/threshold.wgsl`
    pub struct ThresholdParams {
        pub level: f32,
    }
}

uniforms! {
    /// `filters/hue_sat.wgsl`
    pub struct HueSatParams {
        pub hue: f32,
        pub saturation: f32,
        pub lightness: f32,
    }
}

uniforms! {
    /// `filters/solarize.wgsl`
    pub struct SolarizeParams {
        pub threshold: f32,
    }
}

uniforms! {
    /// `filters/sharpen.wgsl`
    pub struct SharpenParams {
        pub amount: f32,
        pub threshold: f32,
    }
}

uniforms! {
    /// `filters/motion_blur.wgsl`
    pub struct MotionBlurParams {
        pub angle: f32,
        pub distance: i32,
    }
}

uniforms! {
    /// `filters/radial_blur.wgsl`
    pub struct RadialBlurParams {
        pub center: [f32; 2],
        pub amount: i32,
    }
}

uniforms! {
    /// `filters/cel_shading.wgsl`
    pub struct CelShadingParams {
        pub levels: i32,
        pub edge_strength: f32,
    }
}

uniforms! {
    /// `filters/pixelate.wgsl`
    pub struct PixelateParams {
        pub block_size: i32,
    }
}

uniforms! {
    /// `filters/pixelate_blocks.wgsl`
    pub struct PixelateBlocksParams {
        pub block_size: i32,
    }
}

uniforms! {
    /// `filters/halftone.wgsl`
    pub struct HalftoneParams {
        pub dot_size: f32,
        pub angle: f32,
        pub contrast: f32,
        pub density: f32,
    }
}

uniforms! {
    /// `filters/kaleidoscope.wgsl`
    pub struct KaleidoscopeParams {
        pub segments: f32,
        pub rotation: f32,
        pub size: [f32; 2],
        pub center: [f32; 2],
    }
}

uniforms! {
    /// `filters/oil_paint.wgsl`
    pub struct OilPaintParams {
        pub radius: f32,
        pub sharpness: f32,
    }
}

uniforms! {
    /// `filters/chromatic_aberration.wgsl`
    pub struct ChromaticAberrationParams {
        pub amount: f32,
        pub angle: f32,
    }
}

uniforms! {
    /// `filters/pixel_stretch.wgsl`
    pub struct PixelStretchParams {
        pub amount: f32,
        pub bands: f32,
        pub seed: f32,
        pub rgb_split: f32,
    }
}

uniforms! {
    /// `filters/lens_distortion.wgsl`
    pub struct LensDistortionParams {
        pub strength: f32,
        pub zoom: f32,
        pub fringing: f32,
        pub center: [f32; 2],
        pub radius_scale: f32,
    }
}

uniforms! {
    /// `filters/tilt_shift_blur.wgsl`
    pub struct TiltShiftBlurParams {
        pub focus_position: f32,
        pub focus_width: f32,
        pub blur_radius: f32,
        pub angle: f32,
    }
}

uniforms! {
    /// `filters/emboss.wgsl`
    pub struct EmbossParams {
        pub angle: f32,
        pub strength: f32,
        pub emboss_type: f32,
    }
}

uniforms! {
    /// `filters/voronoi.wgsl`
    pub struct VoronoiParams {
        pub cell_count: f32,
        pub edge_width: f32,
        pub edge_r: f32,
        pub edge_g: f32,
        pub edge_b: f32,
        pub seed: f32,
    }
}

uniforms! {
    /// `filters/surface_blur.wgsl`
    pub struct SurfaceBlurParams {
        pub radius: i32,
        pub threshold: f32,
    }
}

uniforms! {
    /// `filters/selection_mask_blend.wgsl`
    pub struct SelectionMaskBlendParams {
        pub doc_size: [f32; 2],
        pub layer_offset: [f32; 2],
        pub layer_size: [f32; 2],
    }
}

uniforms! {
    /// `filters/noise.wgsl`
    pub struct NoiseParams {
        pub amount: f32,
        /// 0 or 1.
        pub monochrome: i32,
        /// 0 or 1.
        pub gaussian: i32,
        pub seed: f32,
    }
}

uniforms! {
    /// `filters/clouds.wgsl`
    pub struct CloudsParams {
        pub scale: f32,
        pub seed: f32,
    }
}

uniforms! {
    /// `filters/smoke.wgsl`
    pub struct SmokeParams {
        pub scale: f32,
        pub seed: f32,
        pub turbulence: f32,
    }
}

uniforms! {
    /// `filters/pattern_fill.wgsl`
    pub struct PatternFillParams {
        pub layer_size: [f32; 2],
        pub pattern_size: [f32; 2],
        pub scale: f32,
        pub stagger: [f32; 2],
        pub origin: [f32; 2],
    }
}

uniforms! {
    /// `filters/mesh_warp.wgsl`
    pub struct MeshWarpParams {
        pub grid_size: [f32; 2],
        pub bounds_min: [f32; 2],
        pub bounds_max: [f32; 2],
    }
}

uniforms! {
    /// `filters/liquify_warp.wgsl`
    pub struct LiquifyWarpParams {
        pub max_disp: f32,
        pub texel_size: [f32; 2],
    }
}

uniforms! {
    /// `filters/liquify_dab.wgsl`
    pub struct LiquifyDabParams {
        pub center: [f32; 2],
        pub radius: f32,
        pub pressure: f32,
        pub drag: [f32; 2],
        pub mode: i32,
        pub size: [f32; 2],
    }
}

uniforms! {
    /// `filters/bloom_threshold.wgsl`
    pub struct BloomThresholdParams {
        pub threshold: f32,
        pub soft_knee: f32,
    }
}

uniforms! {
    /// `filters/bloom_combine.wgsl`
    pub struct BloomCombineParams {
        pub intensity: f32,
    }
}

uniforms! {
    /// `filters/fibers.wgsl`
    pub struct FibersParams {
        pub variance: f32,
        pub strength: f32,
        pub seed: f32,
    }
}

uniforms! {
    /// `filters/sunburst.wgsl`
    pub struct SunburstParams {
        pub size: [f32; 2],
        pub center: [f32; 2],
        pub reach: f32,
        pub rays: f32,
        pub rotation: f32,
        pub length: f32,
        pub width: f32,
        pub taper: f32,
        pub fade: f32,
        pub softness: f32,
        pub jitter: f32,
        pub seed: f32,
        pub ray_color: [f32; 4],
        pub fill_gaps: i32,
        pub gap_color: [f32; 3],
    }
}

uniforms! {
    /// `filters/color_lut.wgsl`
    pub struct ColorLutParams {
        pub lut_size: f32,
        pub intensity: f32,
    }
}

uniforms! {
    /// `filters/texture.wgsl`
    pub struct TextureParams {
        pub kind: i32,
        pub blend: i32,
        pub amount: f32,
        pub size: f32,
        pub stretch: f32,
        pub angle: f32,
        pub octaves: f32,
        pub contrast: f32,
        /// 0 or 1.
        pub colored: i32,
        pub seed: u32,
    }
}

uniforms! {
    /// `filters/gaussian_blur.wgsl`
    pub struct GaussianBlurParams {
        pub direction: [f32; 2],
        /// 64 weights, four to a vector.
        pub weights: Vec4Array<16>,
        pub radius: i32,
    }
}

uniforms! {
    /// `filters/box_blur.wgsl`
    pub struct BoxBlurParams {
        pub direction: [f32; 2],
        pub radius: i32,
        pub step: i32,
    }
}

uniforms! {
    /// `filters/vignette.wgsl`
    pub struct VignetteParams {
        pub amount: f32,
        pub doc_color_mode: i32,
    }
}

uniforms! {
    /// `filters/adjustments.wgsl`
    pub struct AdjustmentsParams {
        pub brightness: f32,
        pub contrast: f32,
        pub exposure: f32,
        pub highlights: f32,
        pub shadows: f32,
        pub whites: f32,
        pub blacks: f32,
        pub saturation: f32,
        pub vibrance: f32,
        pub has_levels: f32,
        pub has_curves: f32,
        pub hue_shift: f32,
        pub hsl_saturation: f32,
        pub lightness: f32,
        pub cb_shadows: [f32; 3],
        pub cb_midtones: [f32; 3],
        pub cb_highlights: [f32; 3],
        pub pf_color: [f32; 3],
        pub pf_density: f32,
        pub pf_luminosity: f32,
        pub bw_reds: f32,
        pub bw_yellows: f32,
        pub bw_greens: f32,
        pub bw_cyans: f32,
        pub bw_blues: f32,
        pub bw_magentas: f32,
        pub bw_enabled: f32,
        pub cm_rr: f32,
        pub cm_rg: f32,
        pub cm_rb: f32,
        pub cm_rc: f32,
        pub cm_gr: f32,
        pub cm_gg: f32,
        pub cm_gb: f32,
        pub cm_gc: f32,
        pub cm_br: f32,
        pub cm_bg: f32,
        pub cm_bb: f32,
        pub cm_bc: f32,
        pub cm_enabled: f32,
        pub invert: f32,
        pub has_gradient_map: f32,
        pub cg_enabled: f32,
        pub cg_shadows: [f32; 4],
        pub cg_midtones: [f32; 4],
        pub cg_highlights: [f32; 4],
        pub cg_global: [f32; 4],
        pub cg_exponent: f32,
        pub cg_width: f32,
        pub has_cg_lut: f32,
        pub doc_color_mode: i32,
        pub keep_over_white: f32,
    }
}
