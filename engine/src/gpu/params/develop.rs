//! Uniform structs of the develop shaders (`gpu/shaders/develop/`).

use crate::gpu::uniforms::{uniforms, Mat3, Vec4Array};

uniforms! {
    /// `develop/raw_develop.wgsl`
    pub struct RawDevelopParams {
        pub cam_to_rgb: Mat3,
        pub wb_ratio: [f32; 3],
        pub exposure_gain: f32,
        pub saturation: f32,
        pub highlight_desat: i32,
        pub curve_size: i32,
        pub curve_width: i32,
    }
}

uniforms! {
    /// `develop/color_mixer.wgsl`
    pub struct ColorMixerParams {
        pub values: Vec4Array<6>,
    }
}

uniforms! {
    /// `develop/blur_axis.wgsl`
    pub struct BlurAxisParams {
        pub dir: [f32; 2],
        pub sigma: f32,
    }
}

uniforms! {
    /// `develop/noise_reduce.wgsl`
    pub struct NoiseReduceParams {
        pub luminance: f32,
        pub color: f32,
        pub range_sigma: f32,
    }
}

uniforms! {
    /// `develop/detail_sharpen.wgsl`
    pub struct DetailSharpenParams {
        pub amount: f32,
        pub edges: f32,
        pub mask_view: i32,
    }
}

uniforms! {
    /// `develop/local_contrast.wgsl`
    pub struct LocalContrastParams {
        pub large_amount: f32,
        pub small_amount: f32,
        pub haze_amount: f32,
    }
}

uniforms! {
    /// `develop/areas.wgsl`
    pub struct AreasParams {
        pub areas: Vec4Array<32>,
        pub count: i32,
        pub mode: i32,
        pub overlay: i32,
    }
}

uniforms! {
    /// `develop/clip_warning.wgsl`
    pub struct ClipWarningParams {
        pub shadows: i32,
        pub highlights: i32,
    }
}
