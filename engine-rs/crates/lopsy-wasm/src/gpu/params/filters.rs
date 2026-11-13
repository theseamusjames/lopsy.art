use crate::gpu::uniforms::uniforms;

uniforms! {
    /// `filters/posterize.glsl`
    pub struct PosterizeParams {
        pub levels: f32,
    }
}

uniforms! {
    /// `filters/threshold.glsl`
    pub struct ThresholdParams {
        pub level: f32,
    }
}

uniforms! {
    /// `filters/hue_sat.glsl`
    pub struct HueSatParams {
        pub hue: f32,
        pub saturation: f32,
        pub lightness: f32,
    }
}

uniforms! {
    /// `filters/solarize.glsl`
    pub struct SolarizeParams {
        pub threshold: f32,
    }
}

uniforms! {
    /// `filters/sharpen.glsl`
    pub struct SharpenParams {
        pub amount: f32,
        pub threshold: f32,
    }
}

uniforms! {
    /// `filters/motion_blur.glsl`
    pub struct MotionBlurParams {
        pub angle: f32,
        pub distance: i32,
    }
}

uniforms! {
    /// `filters/radial_blur.glsl`
    pub struct RadialBlurParams {
        pub center: [f32; 2],
        pub amount: i32,
    }
}

uniforms! {
    /// `filters/cel_shading.glsl`
    pub struct CelShadingParams {
        pub levels: i32,
        pub edge_strength: f32,
    }
}

uniforms! {
    /// `filters/pixelate.glsl`
    pub struct PixelateParams {
        pub block_size: i32,
    }
}

uniforms! {
    /// `filters/pixelate_blocks.glsl`
    pub struct PixelateBlocksParams {
        pub block_size: i32,
    }
}

uniforms! {
    /// `filters/halftone.glsl`
    pub struct HalftoneParams {
        pub dot_size: f32,
        pub angle: f32,
        pub contrast: f32,
        pub density: f32,
    }
}

uniforms! {
    /// `filters/kaleidoscope.glsl`
    pub struct KaleidoscopeParams {
        pub segments: f32,
        pub rotation: f32,
        pub size: [f32; 2],
        pub center: [f32; 2],
    }
}

uniforms! {
    /// `filters/oil_paint.glsl`
    pub struct OilPaintParams {
        pub radius: f32,
        pub sharpness: f32,
    }
}

uniforms! {
    /// `filters/chromatic_aberration.glsl`
    pub struct ChromaticAberrationParams {
        pub amount: f32,
        pub angle: f32,
    }
}

uniforms! {
    /// `filters/pixel_stretch.glsl`
    pub struct PixelStretchParams {
        pub amount: f32,
        pub bands: f32,
        pub seed: f32,
        pub rgb_split: f32,
    }
}

uniforms! {
    /// `filters/lens_distortion.glsl`
    pub struct LensDistortionParams {
        pub strength: f32,
        pub zoom: f32,
        pub fringing: f32,
        pub center: [f32; 2],
        pub radius_scale: f32,
    }
}

uniforms! {
    /// `filters/tilt_shift_blur.glsl`
    pub struct TiltShiftBlurParams {
        pub focus_position: f32,
        pub focus_width: f32,
        pub blur_radius: f32,
        pub angle: f32,
    }
}

uniforms! {
    /// `filters/emboss.glsl`
    pub struct EmbossParams {
        pub angle: f32,
        pub strength: f32,
        pub emboss_type: f32,
    }
}

uniforms! {
    /// `filters/voronoi.glsl`
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
    /// `filters/surface_blur.glsl`
    pub struct SurfaceBlurParams {
        pub radius: i32,
        pub threshold: f32,
    }
}

uniforms! {
    /// `filters/selection_mask_blend.glsl`
    pub struct SelectionMaskBlendParams {
        pub doc_size: [f32; 2],
        pub layer_offset: [f32; 2],
        pub layer_size: [f32; 2],
    }
}
