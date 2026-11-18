//! Uniform structs of the develop shaders (`gpu/shaders/develop/`).

use crate::gpu::uniforms::{uniforms, Mat3};

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
