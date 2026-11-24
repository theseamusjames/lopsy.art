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
        pub scene_only: i32,
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
    /// `develop/area_layer.wgsl`
    pub struct AreaLayerParams {
        pub area: Vec4Array<4>,
    }
}

uniforms! {
    /// `develop/clip_warning.wgsl`
    pub struct ClipWarningParams {
        pub shadows: i32,
        pub highlights: i32,
        pub margin: f32,
    }
}

uniforms! {
    /// `develop/finish.wgsl`
    pub struct FinishParams {
        pub vignette: [f32; 4],
        pub grain: [f32; 4],
        pub doc_size: [f32; 2],
        pub seed: u32,
    }
}

uniforms! {
    /// `develop/working_space.wgsl`
    pub struct WorkingSpaceParams {
        pub matrix: Mat3,
        pub mode: i32,
    }
}

uniforms! {
    /// `develop/tone.wgsl`
    pub struct ToneParams {
        pub to_srgb: Mat3,
        pub from_srgb: Mat3,
        pub luma: [f32; 3],
        pub saturation: f32,
        pub highlight_desat: i32,
        pub curve_size: i32,
        pub curve_width: i32,
        pub curve_top: f32,
        pub curve_slope: f32,
        pub shoulder_headroom: f32,
        pub scene_on: i32,
        pub exposure: f32,
        pub temperature: f32,
        pub tint: f32,
        pub tone: [f32; 4],
        pub blacks: f32,
        pub wb_stops: [f32; 2],
        pub tone_consts: [f32; 4],
        pub knots: Vec4Array<2>,
        pub rows: Vec4Array<12>,
        pub areas: Vec4Array<32>,
        pub area_count: i32,
        pub area_tone: Vec4Array<8>,
    }
}

uniforms! {
    /// `develop/look.wgsl`
    pub struct LookParams {
        pub lms_from_rgb: Mat3,
        pub rgb_from_lms: Mat3,
        pub lab_from_lms: Mat3,
        pub lms_from_lab: Mat3,
        pub luma: [f32; 3],
        pub color_on: i32,
        pub vibrance: f32,
        pub saturation: f32,
        pub vib_consts: [f32; 2],
        pub mixer_on: i32,
        pub mixer: Vec4Array<6>,
        pub band_hues: Vec4Array<2>,
        pub mixer_consts: [f32; 4],
        pub grade_on: i32,
        pub grade: Vec4Array<5>,
        pub curve_on: [f32; 4],
        pub curve_width: i32,
        pub curve_size: i32,
        pub areas: Vec4Array<32>,
        pub area_count: i32,
        pub area_vibrance: Vec4Array<2>,
    }
}

uniforms! {
    /// `develop/output.wgsl`
    pub struct OutputParams {
        pub to_target: Mat3,
        pub luma: [f32; 3],
        pub target_luma: [f32; 3],
        pub peak: f32,
        pub knee: f32,
        pub gamut_threshold: f32,
        pub transfer: i32,
        pub gamma: f32,
        pub dither: f32,
    }
}
